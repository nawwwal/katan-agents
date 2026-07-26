import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { Redis } from 'ioredis'
import { applyAction, createGame, currentActorId, getPlayerView } from '../src/game/engine.js'
import { parsePlayerAction } from '../src/game/room.js'
import { parseBoardOptions, parseBoardSeed } from '../src/game/board.js'
import type { BoardOptions, Controller, GameState } from '../src/game/types.js'
import type { RoomCredentials, RoomSeat, RoomStatus, RoomView } from '../src/game/room.js'

const ROOM_TTL_SECONDS = 24 * 60 * 60
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const ROOM_EVENTS = 'katan:room-events'
const INSTANCE_ID = randomUUID()
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 5_000,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
}) : null
const redisRequired = Boolean(process.env.VERCEL) && !redis

type StoredSeat = RoomSeat & { tokenHash: string; joinIdHash?: string }
type StoredRoom = {
  v: 1
  code: string
  status: RoomStatus
  seatsTotal: 3 | 4
  seats: StoredSeat[]
  game?: GameState
  /** The board the host chose while creating the room, replayed into the first game. */
  boardSeed?: number
  boardOptions: BoardOptions
  gameNumber: number
  createdAt: number
  updatedAt: number
}

export class RoomError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message)
  }
}

const localRooms = new Map<string, StoredRoom>()
const localLocks = new Map<string, Promise<void>>()
const localRateLimits = new Map<string, { count: number; expiresAt: number }>()
const listeners = new Set<(code?: string) => void>()
let streamClient: Redis | undefined
let streaming = false
let streamGeneration = 0

const roomKey = (code: string) => `katan:room:${code}`
const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z2-9]/g, '')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const freshToken = () => randomBytes(32).toString('base64url')
const freshCode = () => Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('')
const freshSeed = () => randomBytes(4).readUInt32BE(0)
const secureRandom = () => randomInt(0x1_0000_0000) / 0x1_0000_0000
const nextUpdatedAt = (room: StoredRoom) => Math.max(Date.now(), room.updatedAt + 1)
const cleanName = (name: unknown) => typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 22) : ''
const cleanJoinId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : ''
const cleanPlayerKey = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value) ? value : ''
const cloneRoom = (room: StoredRoom) => structuredClone(room)
const assertRoomStore = () => {
  if (redisRequired) throw new RoomError('redis_required', 'REDIS_URL is required when Katan runs on Vercel.', 503)
}

const tokenMatches = (seat: StoredSeat, token: string) => {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(seat.tokenHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const seatForToken = (room: StoredRoom, token: string) => room.seats.find((seat) => tokenMatches(seat, token))

const publishLocal = (code?: string) => {
  for (const listener of listeners) listener(code)
}

const parseRoom = (value: string | null) => value ? JSON.parse(value) as StoredRoom : undefined

const getStoredRoom = async (code: string) => {
  assertRoomStore()
  const normalized = normalizeCode(code)
  const room = redis ? parseRoom(await redis.get(roomKey(normalized))) : localRooms.get(normalized)
  return room ? cloneRoom(room) : undefined
}

const createStoredRoom = async (room: StoredRoom) => {
  assertRoomStore()
  if (!redis) {
    if (localRooms.has(room.code)) return false
    localRooms.set(room.code, cloneRoom(room))
    publishLocal(room.code)
    return true
  }
  const created = await redis.set(roomKey(room.code), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS, 'NX')
  if (!created) return false
  await redis.xadd(ROOM_EVENTS, 'MAXLEN', '~', 2_000, '*', 'room', room.code, 'origin', INSTANCE_ID)
  publishLocal(room.code)
  return true
}

const withLocalLock = async <T>(code: string, task: () => Promise<T>) => {
  const previous = localLocks.get(code) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  localLocks.set(code, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (localLocks.get(code) === queued) localLocks.delete(code)
  }
}

const COMMIT_ROOM = `
local current = redis.call('GET', KEYS[1])
if not current then return -1 end
local decoded = cjson.decode(current)
if decoded.updatedAt ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('XADD', KEYS[2], 'MAXLEN', '~', 2000, '*', 'room', ARGV[4], 'origin', ARGV[5])
return 1
`

const commitRedisRoom = async (observedUpdatedAt: number, room: StoredRoom) => Number(await redis!.eval(
  COMMIT_ROOM,
  2,
  roomKey(room.code),
  ROOM_EVENTS,
  String(observedUpdatedAt),
  JSON.stringify(room),
  String(ROOM_TTL_SECONDS),
  room.code,
  INSTANCE_ID,
))

const mutateRoom = async <T>(code: string, update: (room: StoredRoom) => T) => {
  const normalized = normalizeCode(code)
  const localTask = async () => {
    const room = await getStoredRoom(normalized)
    if (!room) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
    const result = update(room)
    room.updatedAt = nextUpdatedAt(room)
    localRooms.set(normalized, cloneRoom(room))
    publishLocal(normalized)
    return result
  }
  if (!redis) return withLocalLock(normalized, localTask)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await getStoredRoom(normalized)
    if (!room) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
    const observedUpdatedAt = room.updatedAt
    const result = update(room)
    room.updatedAt = nextUpdatedAt(room)
    const committed = await commitRedisRoom(observedUpdatedAt, room)
    if (committed === 1) {
      publishLocal(normalized)
      return result
    }
    if (committed === -1) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
    await new Promise((resolve) => setTimeout(resolve, 4 + randomInt(8)))
  }
  throw new RoomError('room_busy', 'The room moved while that was in flight. Try again.', 409)
}

const roomView = (room: StoredRoom, token: string): RoomView => {
  const viewer = seatForToken(room, token)
  if (!viewer) throw new RoomError('invalid_seat_token', 'This seat is no longer yours. Rejoin with the room code.', 403)
  return {
    v: 1,
    code: room.code,
    status: room.status,
    seatsTotal: room.seatsTotal,
    seats: room.seats.map(({ tokenHash: _tokenHash, joinIdHash: _joinIdHash, ...seat }) => seat),
    viewerPlayerId: viewer.id,
    isHost: viewer.isHost,
    updatedAt: room.updatedAt,
    boardSeed: room.boardSeed,
    boardOptions: parseBoardOptions(room.boardOptions),
    game: room.game ? getPlayerView(room.game, viewer.id) : undefined,
  }
}

const RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`

export const enforceRateLimit = async (scope: 'create' | 'join' | 'socket' | 'mcp', identity: string, limit: number, windowSeconds: number) => {
  assertRoomStore()
  const identityHash = createHash('sha256').update(identity || 'unknown').digest('hex').slice(0, 24)
  const key = `katan:rate:${scope}:${identityHash}`
  let count: number
  if (redis) count = Number(await redis.eval(RATE_LIMIT, 1, key, String(windowSeconds)))
  else {
    const now = Date.now()
    const current = localRateLimits.get(key)
    const next = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + windowSeconds * 1_000 }
      : { ...current, count: current.count + 1 }
    localRateLimits.set(key, next)
    count = next.count
    if (localRateLimits.size > 1_000) {
      for (const [candidate, value] of localRateLimits) if (value.expiresAt <= now) localRateLimits.delete(candidate)
    }
  }
  if (count > limit) throw new RoomError('rate_limited', 'Too many requests. Wait a few seconds and try again.', 429)
}

export const roomStoreHealth = () => ({
  ok: !redisRequired,
  storage: redis ? 'redis' as const : 'memory' as const,
  ...(redisRequired ? { error: 'REDIS_URL is required on Vercel.' } : {}),
})

export const createRoom = async (input: { name: unknown; seatsTotal: unknown; boardSeed?: unknown; boardOptions?: unknown }) => {
  const name = cleanName(input.name)
  const seatsTotal = input.seatsTotal
  if (!name) throw new RoomError('invalid_name', 'Enter a player name.')
  if (seatsTotal !== 3 && seatsTotal !== 4) throw new RoomError('invalid_seat_count', 'Tables seat three or four.')
  if (input.boardSeed !== undefined && parseBoardSeed(input.boardSeed) === undefined) throw new RoomError('invalid_board_seed', 'An island number is a whole number from 0 to 4,294,967,295.')
  const boardSeed = parseBoardSeed(input.boardSeed)
  const boardOptions = parseBoardOptions(input.boardOptions)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = freshCode()
    const token = freshToken()
    const now = Date.now()
    const room: StoredRoom = {
      v: 1,
      code,
      status: 'lobby',
      seatsTotal,
      seats: [{ id: 'p0', name, controller: 'human', isHost: true, tokenHash: hashToken(token) }],
      boardSeed,
      boardOptions,
      gameNumber: 0,
      createdAt: now,
      updatedAt: now,
    }
    if (await createStoredRoom(room)) {
      const credentials: RoomCredentials = { code, token, playerId: 'p0' }
      return { credentials, room: roomView(room, token) }
    }
  }
  throw new RoomError('room_code_unavailable', 'Could not reserve a code. Try again.', 503)
}

export const joinRoom = async (input: { code: string; name: unknown; controller: unknown; joinId?: unknown; playerKey?: unknown }) => {
  const name = cleanName(input.name)
  const controller = input.controller
  if (!name) throw new RoomError('invalid_name', 'Enter a player name.')
  if (controller !== 'human' && controller !== 'agent') throw new RoomError('invalid_controller', 'Choose a human or agent seat.')
  const suppliedJoinId = input.joinId !== undefined
  const suppliedPlayerKey = input.playerKey !== undefined
  if (suppliedJoinId !== suppliedPlayerKey) throw new RoomError('invalid_join_recovery', 'joinId and playerKey must be supplied together.', 400)
  if ((suppliedJoinId || suppliedPlayerKey) && controller !== 'agent') throw new RoomError('invalid_join_recovery', 'Only a local agent runner may propose a recoverable seat credential.', 400)
  const joinId = suppliedJoinId ? cleanJoinId(input.joinId) : ''
  const proposedPlayerKey = suppliedPlayerKey ? cleanPlayerKey(input.playerKey) : ''
  if (suppliedJoinId && !joinId) throw new RoomError('invalid_join_id', 'joinId must be a 16–128 character URL-safe identifier.', 400)
  if (suppliedPlayerKey && !proposedPlayerKey) throw new RoomError('invalid_player_key', 'playerKey must be at least 32 random bytes encoded as base64url.', 400)
  const token = proposedPlayerKey || freshToken()
  const joinIdHash = joinId ? hashToken(`join:${joinId}`) : undefined
  let playerId = ''
  let reused = false

  const recoverSeat = (room: StoredRoom) => {
    if (!joinIdHash) return false
    const byJoinId = room.seats.find((seat) => seat.joinIdHash === joinIdHash)
    const byToken = room.seats.find((seat) => tokenMatches(seat, token))
    if (!byJoinId && !byToken) return false
    if (!byJoinId || !byToken || byJoinId.id !== byToken.id) throw new RoomError('join_id_conflict', 'That recovery identity is already bound to another seat credential.', 409)
    if (byJoinId.controller !== controller || byJoinId.name !== name) throw new RoomError('join_id_conflict', 'That recovery identity belongs to a different seat.', 409)
    playerId = byJoinId.id
    reused = true
    return true
  }

  if (joinIdHash) {
    const current = await getStoredRoom(input.code)
    if (!current) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
    if (recoverSeat(current)) {
      const credentials: RoomCredentials = { code: current.code, token, playerId }
      return { credentials, room: roomView(current, token), reused }
    }
  }

  await mutateRoom(input.code, (room) => {
    if (recoverSeat(room)) return
    if (room.status !== 'lobby') throw new RoomError('room_started', 'That game already started. Ask the host to open a new room.', 409)
    if (room.seats.length >= room.seatsTotal) throw new RoomError('room_full', 'Every seat in that room is taken.', 409)
    playerId = `p${room.seats.length}`
    room.seats.push({ id: playerId, name, controller: controller as Controller, isHost: false, tokenHash: hashToken(token), joinIdHash })
  })
  const room = await getStoredRoom(input.code)
  if (!room) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
  const credentials: RoomCredentials = { code: room.code, token, playerId }
  return { credentials, room: roomView(room, token), reused }
}

export const getRoomView = async (code: string, token: string) => {
  const room = await getStoredRoom(code)
  if (!room) throw new RoomError('room_not_found', 'No room with that code. Check the six characters, or ask the host for a fresh code.', 404)
  return roomView(room, token)
}

export const startRoom = async (code: string, token: string) => mutateRoom(code, (room) => {
  const viewer = seatForToken(room, token)
  if (!viewer?.isHost) throw new RoomError('host_only', 'Only the host can start. They are looking at the same lobby you are.', 403)
  if (room.status === 'playing') throw new RoomError('room_started', 'The game is already running.', 409)
  if (room.seats.length !== room.seatsTotal) {
    const open = room.seatsTotal - room.seats.length
    throw new RoomError('room_not_ready', `${open} seat${open === 1 ? '' : 's'} still open. Send the invite link, or the agent command from the lobby.`, 409)
  }
  // The host previewed one island, so the first game plays it. A rematch keeps their board
  // options and rolls a new seed rather than dealing the same island twice.
  const seed = room.gameNumber === 0 && room.boardSeed !== undefined ? room.boardSeed : freshSeed()
  room.game = createGame({
    seed,
    boardOptions: room.boardOptions,
    privateRandomSeed: freshSeed(),
    random: secureRandom,
    controllers: room.seats.map((seat) => seat.controller),
    names: room.seats.map((seat) => seat.name),
  })
  room.gameNumber += 1
  room.status = 'playing'
})

export const playRoomAction = async (code: string, token: string, expectedRevision: number, input: unknown) => mutateRoom(code, (room) => {
  const viewer = seatForToken(room, token)
  if (!viewer) throw new RoomError('invalid_seat_token', 'This seat is no longer yours. Rejoin with the room code.', 403)
  if (room.status !== 'playing' || !room.game) throw new RoomError('room_not_playing', 'That game is not running.', 409)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== room.game.revision) throw new RoomError('stale_revision', 'Someone moved first. Your view has caught up, so try again.', 409)
  if (currentActorId(room.game) !== viewer.id) throw new RoomError('not_your_turn', 'It is not your turn yet.', 409)
  const action = parsePlayerAction(getPlayerView(room.game, viewer.id), input)
  if (!action) throw new RoomError('illegal_action', 'That move is not legal here.', 422)
  const result = applyAction(room.game, action, secureRandom)
  if (result.ok === false) throw new RoomError('illegal_action', result.message, 422)
  room.game = result.state
  if (room.game.phase === 'game-over') room.status = 'finished'
})

const fields = (flat: string[]) => Object.fromEntries(Array.from({ length: Math.floor(flat.length / 2) }, (_, index) => [flat[index * 2], flat[index * 2 + 1]]))

const startStream = async () => {
  if (!redis || streaming) return
  streaming = true
  const generation = ++streamGeneration
  const client = redis.duplicate({
    maxRetriesPerRequest: null,
    commandTimeout: undefined,
    blockingTimeout: 6_000,
  })
  streamClient = client
  let cursor: string | undefined
  let resyncAfterError = false
  let readyOnce = false
  client.on('ready', () => {
    if (readyOnce && streaming && generation === streamGeneration) resyncAfterError = true
    readyOnce = true
  })
  client.on('reconnecting', () => {
    if (streaming && generation === streamGeneration) resyncAfterError = true
  })
  while (streaming && generation === streamGeneration) {
    try {
      if (cursor === undefined) {
        cursor = (await client.xrevrange(ROOM_EVENTS, '+', '-', 'COUNT', 1))[0]?.[0] ?? '0-0'
        publishLocal()
      }
      const response = await client.xread('BLOCK', 5_000, 'STREAMS', ROOM_EVENTS, cursor) as Array<[string, Array<[string, string[]]>]> | null
      if (resyncAfterError) {
        resyncAfterError = false
        publishLocal()
      }
      if (response) {
        for (const [, entries] of response) {
          for (const [id, flat] of entries) {
            cursor = id
            const event = fields(flat)
            if (event.origin !== INSTANCE_ID && event.room) publishLocal(event.room)
          }
        }
      }
    } catch {
      if (streaming && generation === streamGeneration) {
        resyncAfterError = true
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }
  if (streamClient === client) streamClient = undefined
  client.disconnect()
}

const stopStream = () => {
  streaming = false
  streamGeneration += 1
  streamClient?.disconnect()
  streamClient = undefined
}

export const onRoomChange = (listener: (code?: string) => void) => {
  listeners.add(listener)
  if (listeners.size === 1) void startStream()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) stopStream()
  }
}

export const waitForRoomChange = async (code: string, token: string, afterUpdatedAt: number, timeoutMs: number) => {
  const current = await getRoomView(code, token)
  if (current.updatedAt > afterUpdatedAt) return { room: current, timedOut: false }

  return new Promise<{ room: RoomView; timedOut: boolean }>((resolve, reject) => {
    let settled = false
    let reading = false
    const finish = (room: RoomView, timedOut: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      resolve({ room, timedOut })
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      reject(error)
    }
    const read = async () => {
      if (settled || reading) return
      reading = true
      try {
        const room = await getRoomView(code, token)
        if (room.updatedAt > afterUpdatedAt) finish(room, false)
      } catch (error) {
        fail(error)
      } finally {
        reading = false
      }
    }
    const unsubscribe = onRoomChange((changedCode) => {
      if (!changedCode || changedCode === current.code) void read()
    })
    const timeout = setTimeout(() => {
      void getRoomView(code, token)
        .then((room) => finish(room, room.updatedAt <= afterUpdatedAt))
        .catch(fail)
    }, Math.max(1, timeoutMs))
    void read()
  })
}

export const closeRoomStore = async () => {
  stopStream()
  if (redis) await redis.quit()
}
