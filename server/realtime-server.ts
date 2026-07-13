import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { createRoom, enforceRateLimit, getRoomView, joinRoom, onRoomChange, playRoomAction, RoomError, roomStoreHealth, startRoom } from './room-service'
import { parseClientRoomMessage } from '../src/game/room'
import type { ServerRoomMessage } from '../src/game/room'

const MAX_BODY_BYTES = 32 * 1024

type Connection = { code?: string; token?: string; rateCheck: Promise<RoomError | undefined>; queue: Promise<void> }

const json = (response: http.ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

const fail = (response: http.ServerResponse, error: unknown) => {
  const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'The room service could not complete that request.', 500)
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

const clientIdentity = (request: http.IncomingMessage) => {
  const forwarded = request.headers['x-vercel-forwarded-for'] ?? request.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return value?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
}

const send = (socket: WebSocket, message: ServerRoomMessage) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
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
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const health = roomStoreHealth()
      return json(response, health.ok ? 200 : 503, health)
    }
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      try {
        await enforceRateLimit('create', clientIdentity(request), 12, 60)
        const body = await readJson(request)
        return json(response, 201, { data: await createRoom({ name: body.name, seatsTotal: body.seatsTotal }) })
      } catch (error) {
        return fail(response, error)
      }
    }
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]+)\/seats$/i)
    if (request.method === 'POST' && joinMatch) {
      try {
        await enforceRateLimit('join', clientIdentity(request), 48, 60)
        const body = await readJson(request)
        return json(response, 201, { data: await joinRoom({ code: joinMatch[1], name: body.name, controller: body.controller }) })
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
  webSockets.on('connection', (socket, request) => {
    const connection: Connection = {
      rateCheck: enforceRateLimit('socket', clientIdentity(request), 40, 60)
        .then(() => undefined)
        .catch((error) => error instanceof RoomError ? error : new RoomError('rate_limited', 'Too many socket connections.', 429)),
      queue: Promise.resolve(),
    }
    connections.set(socket, connection)
    void connection.rateCheck.then((roomError) => {
      if (!roomError || socket.readyState !== WebSocket.OPEN) return
      send(socket, { type: 'error', error: { code: roomError.code, message: roomError.message } })
      socket.close(4008, 'Rate limited')
    })
    const authenticationTimeout = setTimeout(() => {
      if (!connection.code) socket.close(4001, 'Authentication timeout')
    }, 5_000)
    socket.on('message', (data) => {
      connection.queue = connection.queue.then(async () => {
        const roomError = await connection.rateCheck
        if (roomError) {
          send(socket, { type: 'error', error: { code: roomError.code, message: roomError.message } })
          socket.close(4008, 'Rate limited')
          return
        }
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
            send(socket, { type: 'error', error: { code: 'hello_required', message: 'Authenticate the seat first.' } })
            socket.close(4001, 'Hello required')
            return
          }
          try {
            const room = await getRoomView(message.code, message.token)
            connection.code = room.code
            connection.token = message.token
            clearTimeout(authenticationTimeout)
            syncRoomEvents()
            return send(socket, { type: 'snapshot', room })
          } catch (error) {
            const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'Could not join the room.', 500)
            send(socket, { type: 'error', error: { code: roomError.code, message: roomError.message } })
            return socket.close(4003, 'Invalid seat')
          }
        }
        if (message.type === 'hello') return send(socket, { type: 'error', error: { code: 'already_authenticated', message: 'This socket already owns a seat.' } })
        if (message.type === 'ping') return send(socket, { type: 'pong' })
        try {
          if (message.type === 'start') await startRoom(connection.code, connection.token)
          else if (message.type === 'action') await playRoomAction(connection.code, connection.token, message.expectedRevision, message.action)
          else throw new RoomError('invalid_message', 'Unknown room message.')
          send(socket, { type: 'ack', requestId: message.requestId })
        } catch (error) {
          const roomError = error instanceof RoomError ? error : new RoomError('server_error', 'The room command failed.', 500)
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
