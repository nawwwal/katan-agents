import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { assertSeatLive, clientIdentity, createRoom, enforceRateLimit, getRoomView, joinRoom, onRoomChange, playRoomAction, releaseRateLimit, RoomError, roomStoreHealth, startRoom } from './room-service.js'
import { parseClientRoomMessage } from '../src/game/room.js'
import type { ServerRoomMessage } from '../src/game/room.js'
import { handleHostedMcp } from './hosted-mcp.js'

const MAX_BODY_BYTES = 32 * 1024

/**
 * Sockets from one address that never prove they hold a seat. This is the flood
 * the limit exists to stop, and it is the only thing an address should be
 * charged for: a seat that says hello gets its unit back, so a human host and
 * four local agent seats on one machine no longer spend each other's budget.
 */
const ANONYMOUS_SOCKETS_PER_MINUTE = 40

/**
 * Reconnects for one seat, keyed on the credential this server minted for it.
 * A storm is now charged to the seat causing it and cannot reach the seat
 * beside it. The shipped client backs off to roughly six attempts a minute, so
 * this is several times the worst a well-behaved seat can do.
 */
const SEAT_RECONNECTS_PER_MINUTE = 30

/**
 * How often the server checks that a socket is still answering. A connection
 * whose peer vanished without a close frame otherwise sits here forever looking
 * healthy, which is the server half of a room that reads live after it died.
 */
const HEARTBEAT_MS = 20_000

type Connection = {
  code?: string
  token?: string
  identity: string
  /** True while this socket is still counted against its address budget. */
  anonymous: boolean
  /** Cleared before every heartbeat, set by the peer's pong. */
  responsive: boolean
  rateCheck: Promise<RoomError | undefined>
  queue: Promise<void>
}

const json = (response: http.ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

const fail = (response: http.ServerResponse, error: unknown) => {
  const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'The room could not handle that. Try again.', 500)
  json(response, roomError.status, { error: { code: roomError.code, message: roomError.message } })
}

const readJson = (request: http.IncomingMessage) => new Promise<Record<string, unknown>>((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  request.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      reject(new RoomError('payload_too_large', 'The request is too large.', 413))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      resolve(value as Record<string, unknown>)
    } catch {
      reject(new RoomError('invalid_json', 'Send a JSON object.', 400))
    }
  })
  request.on('error', reject)
})

const bearer = (request: http.IncomingMessage) => {
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : ''
}

const send = (socket: WebSocket, message: ServerRoomMessage) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/**
 * Says why, then hangs up, in that order. Every refusal a player can hit goes
 * through here, because being dropped without a reason is indistinguishable
 * from the game being broken. Closing waits for the write rather than trusting
 * it to have already gone out.
 */
const refuse = (socket: WebSocket, error: RoomError, closeCode: number, reason: string) => {
  const message: ServerRoomMessage = { type: 'error', error: { code: error.code, message: error.message } }
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message), () => socket.close(closeCode, reason))
}

export const createRealtimeServer = () => {
  const connections = new Map<WebSocket, Connection>()
  let stopRoomEvents: (() => void) | undefined

  const broadcastRoom = async (code?: string) => {
    await Promise.all([...connections].flatMap(([socket, connection]) => {
      if (!connection.code || (code && connection.code !== code) || !connection.token || socket.readyState !== WebSocket.OPEN) return []
      return [getRoomView(connection.code, connection.token).then((room) => send(socket, { type: 'snapshot', room })).catch(() => socket.close(4003, 'Seat expired'))]
    }))
  }

  const syncRoomEvents = () => {
    const hasAuthenticatedConnection = [...connections.values()].some((connection) => connection.code && connection.token)
    if (hasAuthenticatedConnection && !stopRoomEvents) stopRoomEvents = onRoomChange((code) => { void broadcastRoom(code) })
    else if (!hasAuthenticatedConnection && stopRoomEvents) {
      stopRoomEvents()
      stopRoomEvents = undefined
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://local')
    if (url.pathname === '/api/mcp') return handleHostedMcp(request, response)
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const health = roomStoreHealth()
      return json(response, health.ok ? 200 : 503, health)
    }
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      try {
        await enforceRateLimit('create', clientIdentity(request), 12, 60)
        const body = await readJson(request)
        return json(response, 201, { data: await createRoom({ name: body.name, seatsTotal: body.seatsTotal, boardSeed: body.boardSeed, boardOptions: body.boardOptions }) })
      } catch (error) {
        return fail(response, error)
      }
    }
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]+)\/seats$/i)
    if (request.method === 'POST' && joinMatch) {
      try {
        await enforceRateLimit('join', clientIdentity(request), 48, 60)
        const body = await readJson(request)
        return json(response, 201, { data: await joinRoom({
          code: joinMatch[1],
          name: body.name,
          controller: body.controller,
          joinId: body.joinId,
          playerKey: body.playerKey,
        }) })
      } catch (error) {
        return fail(response, error)
      }
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]+)$/i)
    if (request.method === 'GET' && roomMatch) {
      try {
        return json(response, 200, { data: await getRoomView(roomMatch[1], bearer(request)) })
      } catch (error) {
        return fail(response, error)
      }
    }
    return json(response, 404, { error: { code: 'not_found', message: 'Route not found.' } })
  })

  const webSockets = new WebSocketServer({ server, maxPayload: 64 * 1024 })

  // A peer that disappears without a close frame leaves a socket that looks open
  // from here forever. Ask, and drop the ones that stop answering.
  const heartbeat = setInterval(() => {
    for (const [socket, connection] of connections) {
      if (!connection.responsive) {
        socket.terminate()
        continue
      }
      connection.responsive = false
      try { socket.ping() } catch { socket.terminate() }
    }
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
  server.on('close', () => clearInterval(heartbeat))

  webSockets.on('connection', (socket, request) => {
    const identity = clientIdentity(request)
    const connection: Connection = {
      identity,
      anonymous: true,
      responsive: true,
      rateCheck: enforceRateLimit('socket', identity, ANONYMOUS_SOCKETS_PER_MINUTE, 60)
        .then(() => undefined)
        .catch((error) => error instanceof RoomError ? error : new RoomError('rate_limited', 'Too many connection attempts from this device. This clears itself within 60 seconds.', 429)),
      queue: Promise.resolve(),
    }
    connections.set(socket, connection)
    socket.on('pong', () => { connection.responsive = true })
    void connection.rateCheck.then((roomError) => {
      if (roomError) refuse(socket, roomError, 4008, 'Rate limited')
    })
    const authenticationTimeout = setTimeout(() => {
      if (!connection.code) socket.close(4001, 'Authentication timeout')
    }, 5_000)
    socket.on('message', (data) => {
      connection.responsive = true
      connection.queue = connection.queue.then(async () => {
        const roomError = await connection.rateCheck
        if (roomError) return refuse(socket, roomError, 4008, 'Rate limited')
        let input: unknown
        try {
          input = JSON.parse(data.toString())
        } catch {
          return send(socket, { type: 'error', error: { code: 'invalid_json', message: 'Send a JSON message.' } })
        }
        const message = parseClientRoomMessage(input)
        if (!message) return send(socket, { type: 'error', error: { code: 'invalid_message', message: 'Send a valid room message.' } })
        if (!connection.code || !connection.token) {
          if (message.type !== 'hello') {
            return refuse(socket, new RoomError('hello_required', 'Authenticate the seat first.', 401), 4001, 'Hello required')
          }
          try {
            const room = await getRoomView(message.code, message.token)
            // This socket holds a credential this server minted, so it was never
            // the anonymous traffic the address budget stands guard against. It
            // answers to its own seat budget from here.
            if (connection.anonymous) {
              connection.anonymous = false
              await releaseRateLimit('socket', connection.identity)
            }
            await enforceRateLimit('seat', `${room.code}:${message.token}`, SEAT_RECONNECTS_PER_MINUTE, 60)
            connection.code = room.code
            connection.token = message.token
            clearTimeout(authenticationTimeout)
            syncRoomEvents()
            return send(socket, { type: 'snapshot', room })
          } catch (error) {
            const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'Could not take that seat.', 500)
            const throttled = roomError.code === 'rate_limited'
            return refuse(socket, roomError, throttled ? 4008 : 4003, throttled ? 'Rate limited' : 'Invalid seat')
          }
        }
        if (message.type === 'hello') return send(socket, { type: 'error', error: { code: 'already_authenticated', message: 'This socket already owns a seat.' } })
        // The heartbeat is the client's only way to tell a quiet room from a room
        // that is gone, so it answers for the seat rather than for the socket.
        if (message.type === 'ping') {
          try {
            await assertSeatLive(connection.code, connection.token)
          } catch (error) {
            const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'The room could not be reached.', 500)
            return refuse(socket, roomError, 4003, 'Room gone')
          }
          return send(socket, { type: 'pong' })
        }
        try {
          if (message.type === 'start') await startRoom(connection.code, connection.token)
          else if (message.type === 'action') await playRoomAction(connection.code, connection.token, message.expectedRevision, message.action)
          else throw new RoomError('invalid_message', 'Unknown room message.')
          send(socket, { type: 'ack', requestId: message.requestId })
        } catch (error) {
          const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'The room could not run that. Your game is safe.', 500)
          send(socket, { type: 'error', requestId: 'requestId' in message ? message.requestId : undefined, error: { code: roomError.code, message: roomError.message } })
          if (roomError.code === 'stale_revision') {
            const room = await getRoomView(connection.code, connection.token)
            send(socket, { type: 'snapshot', room })
          }
        }
      }).catch(() => socket.close(1011, 'Room command failed'))
    })
    socket.on('close', () => {
      clearTimeout(authenticationTimeout)
      connections.delete(socket)
      syncRoomEvents()
    })
    socket.on('error', () => socket.close())
  })
  return server
}
