import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { Redis } from 'ioredis'
import { applyAction, createGame, currentActorId, getPlayerView } from '../src/game/engine.js'
import { parsePlayerAction } from '../src/game/room.js'
import type { Controller, GameState } from '../src/game/types.js'
import type { RoomCredentials, RoomSeat, RoomStatus, RoomView } from '../src/game/room.js'

const ROOM_TTL_SECONDS = 24 * 60 * 60
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const ROOM_EVENTS = 'katan:room-events'
const INSTANCE_ID = randomUUID()
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
}) : null
const redisRequired = Boolean(process.env.VERCEL) && !redis

type StoredSeat = RoomSeat & { tokenHash: string }
type StoredRoom = {
  v: 1
  code: string
  status: RoomStatus
  seatsTotal: 3 | 4
  seats: StoredSeat[]
  game?: GameState
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
    if (!room) throw new RoomError('room_not_found', 'That room does not exist or has expired.', 404)
    const result = update(room)
    room.updatedAt = nextUpdatedAt(room)
    localRooms.set(normalized, cloneRoom(room))
    publishLocal(normalized)
    return result
  }
  if (!redis) return withLocalLock(normalized, localTask)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await getStoredRoom(normalized)
    if (!room) throw new RoomError('room_not_found', 'That room does not exist or has expired.', 404)
    const observedUpdatedAt = room.updatedAt
    const result = update(room)
    room.updatedAt = nextUpdatedAt(room)
    const committed = await commitRedisRoom(observedUpdatedAt, room)
    if (committed === 1) {
      publishLocal(normalized)
      return result
    }
    if (committed === -1) throw new RoomError('room_not_found', 'That room does not exist or has expired.', 404)
    await new Promise((resolve) => setTimeout(resolve, 4 + randomInt(8)))
  }
  throw new RoomError('room_busy', 'The room changed too quickly. Read the latest state and try again.', 409)
}

const roomView = (room: StoredRoom, token: string): RoomView => {
  const viewer = seatForToken(room, token)
  if (!viewer) throw new RoomError('invalid_seat_token', 'This seat token is invalid.', 403)
  return {
    v: 1,
    code: room.code,
    status: room.status,
    seatsTotal: room.seatsTotal,
    seats: room.seats.map(({ tokenHash: _tokenHash, ...seat }) => seat),
    viewerPlayerId: viewer.id,
    isHost: viewer.isHost,
    updatedAt: room.updatedAt,
    game: room.game ? getPlayerView(room.game, viewer.id) : undefined,
  }
}

const RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`

export const enforceRateLimit = async (scope: 'create' | 'join' | 'socket', identity: string, limit: number, windowSeconds: number) => {
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
  if (count > limit) throw new RoomError('rate_limited', 'Too many room requests. Wait a moment and try again.', 429)
}

export const roomStoreHealth = () => ({
  ok: !redisRequired,
  storage: redis ? 'redis' as const : 'memory' as const,
  ...(redisRequired ? { error: 'REDIS_URL is required on Vercel.' } : {}),
})

export const createRoom = async (input: { name: unknown; seatsTotal: unknown }) => {
  const name = cleanName(input.name)
  const seatsTotal = input.seatsTotal
  if (!name) throw new RoomError('invalid_name', 'Enter a player name.')
  if (seatsTotal !== 3 && seatsTotal !== 4) throw new RoomError('invalid_seat_count', 'Choose a three or four player room.')
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
      gameNumber: 0,
      createdAt: now,
      updatedAt: now,
    }
    if (await createStoredRoom(room)) {
      const credentials: RoomCredentials = { code, token, playerId: 'p0' }
      return { credentials, room: roomView(room, token) }
    }
  }
  throw new RoomError('room_code_unavailable', 'Could not reserve a room code. Try again.', 503)
}

export const joinRoom = async (input: { code: string; name: unknown; controller: unknown }) => {
  const name = cleanName(input.name)
  const controller = input.controller
  if (!name) throw new RoomError('invalid_name', 'Enter a player name.')
  if (controller !== 'human' && controller !== 'agent') throw new RoomError('invalid_controller', 'Choose a human or agent seat.')
  const token = freshToken()
  let playerId = ''
  await mutateRoom(input.code, (room) => {
    if (room.status !== 'lobby') throw new RoomError('room_started', 'That game has already started.', 409)
    if (room.seats.length >= room.seatsTotal) throw new RoomError('room_full', 'That room is full.', 409)
    playerId = `p${room.seats.length}`
    room.seats.push({ id: playerId, name, controller: controller as Controller, isHost: false, tokenHash: hashToken(token) })
  })
  const room = await getStoredRoom(input.code)
  if (!room) throw new RoomError('room_not_found', 'That room does not exist or has expired.', 404)
  const credentials: RoomCredentials = { code: room.code, token, playerId }
  return { credentials, room: roomView(room, token) }
}

export const getRoomView = async (code: string, token: string) => {
  const room = await getStoredRoom(code)
  if (!room) throw new RoomError('room_not_found', 'That room does not exist or has expired.', 404)
  return roomView(room, token)
}

export const startRoom = async (code: string, token: string) => mutateRoom(code, (room) => {
  const viewer = seatForToken(room, token)
  if (!viewer?.isHost) throw new RoomError('host_only', 'Only the room host can start the game.', 403)
  if (room.status === 'playing') throw new RoomError('room_started', 'The game is already running.', 409)
  if (room.seats.length !== room.seatsTotal) throw new RoomError('room_not_ready', 'Fill every seat before starting.', 409)
  room.game = createGame({
    seed: freshSeed(),
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
  if (!viewer) throw new RoomError('invalid_seat_token', 'This seat token is invalid.', 403)
  if (room.status !== 'playing' || !room.game) throw new RoomError('room_not_playing', 'This game is not running.', 409)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== room.game.revision) throw new RoomError('stale_revision', 'The room advanced before that action arrived.', 409)
  if (currentActorId(room.game) !== viewer.id) throw new RoomError('not_your_turn', 'Another seat must act first.', 409)
  const action = parsePlayerAction(getPlayerView(room.game, viewer.id), input)
  if (!action) throw new RoomError('illegal_action', 'That action is not legal in the current position.', 422)
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
  const client = redis.duplicate()
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

export const closeRoomStore = async () => {
  stopStream()
  if (redis) await redis.quit()
}
