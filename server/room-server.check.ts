import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { createRealtimeServer } from './realtime-server'
import { closeRoomStore } from './room-service'
import type { ServerRoomMessage } from '../src/game/room'

const server = createRealtimeServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = (server.address() as AddressInfo).port
const baseUrl = `http://127.0.0.1:${port}`

const health = await fetch(`${baseUrl}/api/health`)
assert.equal(health.status, 200)
assert.deepEqual(await health.json(), { ok: true, storage: 'memory' })

const post = async (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const boardOptions = { balancedPips: true, desert: 'center', harbors: 'fixed' }
const rejectedSeed = await post('/api/rooms', { name: 'Aditya', seatsTotal: 3, boardSeed: -4 })
assert.equal(rejectedSeed.status, 400)
assert.equal((await rejectedSeed.json()).error.code, 'invalid_board_seed')

const create = await post('/api/rooms', { name: 'Aditya', seatsTotal: 3, boardSeed: 4_242, boardOptions })
assert.equal(create.status, 201)
const host = (await create.json()).data
assert.equal(host.room.boardSeed, 4_242)
assert.deepEqual(host.room.boardOptions, boardOptions)
const code = host.credentials.code as string
assert.match(code, /^[A-Z2-9]{6}$/)

const blueResponse = await post(`/api/rooms/${code}/seats`, { name: 'Mara', controller: 'human' })
const recoverableJoin = { name: 'Ivo', controller: 'agent', joinId: 'runner-idempotency-1234', playerKey: 'A'.repeat(43) }
const amberResponse = await post(`/api/rooms/${code}/seats`, recoverableJoin)
assert.equal(blueResponse.status, 201)
assert.equal(amberResponse.status, 201)
const blue = (await blueResponse.json()).data
const amber = (await amberResponse.json()).data
const repeated = await post(`/api/rooms/${code}/seats`, recoverableJoin)
assert.equal(repeated.status, 201)
const repeatedData = (await repeated.json()).data
assert.equal(repeatedData.reused, true)
assert.equal(repeatedData.credentials.playerId, amber.credentials.playerId)
assert.equal(repeatedData.room.seats.length, 3)
assert.equal(JSON.stringify(repeatedData.room).includes('tokenHash'), false)
assert.equal(JSON.stringify(repeatedData.room).includes('joinIdHash'), false)
const conflictingRecovery = await post(`/api/rooms/${code}/seats`, { ...recoverableJoin, playerKey: 'B'.repeat(43) })
assert.equal(conflictingRecovery.status, 409)
assert.equal((await conflictingRecovery.json()).error.code, 'join_id_conflict')
const full = await post(`/api/rooms/${code}/seats`, { name: 'Overflow', controller: 'agent' })
assert.equal(full.status, 409)
assert.equal((await full.json()).error.code, 'room_full')

const unauthenticated = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
await once(unauthenticated, 'open')
const unauthenticatedMessages: ServerRoomMessage[] = []
unauthenticated.on('message', (data) => unauthenticatedMessages.push(JSON.parse(data.toString()) as ServerRoomMessage))
unauthenticated.send(JSON.stringify({ type: 'ping' }))
await once(unauthenticated, 'close')
const unauthenticatedError = unauthenticatedMessages.findLast((message): message is Extract<ServerRoomMessage, { type: 'error' }> => message.type === 'error')
assert.equal(unauthenticatedError?.error.code, 'hello_required')

const connect = async (token: string) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
  await once(socket, 'open')
  const messages: ServerRoomMessage[] = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerRoomMessage))
  socket.send(JSON.stringify({ type: 'hello', code, token }))
  while (!messages.some((message) => message.type === 'snapshot')) await new Promise((resolve) => setTimeout(resolve, 5))
  return { socket, messages }
}

const clients = await Promise.all([host, blue, amber].map((entry) => connect(entry.credentials.token)))
clients[0].socket.send(JSON.stringify({ type: 'start', requestId: 'start-1' }))
while (!clients.every((client) => client.messages.some((message) => message.type === 'snapshot' && message.room.status === 'playing'))) await new Promise((resolve) => setTimeout(resolve, 5))

const replayAfterStart = await post(`/api/rooms/${code}/seats`, recoverableJoin)
assert.equal(replayAfterStart.status, 201)
assert.equal((await replayAfterStart.json()).data.credentials.playerId, amber.credentials.playerId)

const latest = (client: typeof clients[number]) => client.messages.filter((message): message is Extract<ServerRoomMessage, { type: 'snapshot' }> => message.type === 'snapshot').at(-1)!.room
const views = clients.map(latest)
assert.deepEqual(views[0].seats.map((seat) => seat.controller), ['human', 'human', 'agent'])
assert.ok(views.every((view) => view.game?.privateState && view.game.playerId === view.viewerPlayerId))

// The host previewed one island while creating the room; that is the island being played.
const playedBoard = views[0].game!.publicState.board
assert.equal(playedBoard.generation.seed, 4_242)
assert.deepEqual(playedBoard.generation.options, boardOptions)
assert.deepEqual(playedBoard.generation.relaxed, [])
const desert = playedBoard.hexes.find((hex) => hex.terrain === 'desert')!
assert.equal(Math.max(Math.abs(desert.q), Math.abs(desert.r), Math.abs(desert.q + desert.r)), 0)

const actorId = views[0].game!.publicState.actingPlayerId
const actorIndex = views.findIndex((view) => view.viewerPlayerId === actorId)
const actor = clients[actorIndex]
const actorView = latest(actor)
const action = actorView.game!.legalActions[0]
actor.socket.send(JSON.stringify({ type: 'action', requestId: 'action-1', expectedRevision: 0, action }))
while (!clients.every((client) => latest(client).game?.revision === 1)) await new Promise((resolve) => setTimeout(resolve, 5))

actor.socket.send(JSON.stringify({ type: 'action', requestId: 'stale-1', expectedRevision: 0, action }))
while (!actor.messages.some((message) => message.type === 'error' && message.requestId === 'stale-1')) await new Promise((resolve) => setTimeout(resolve, 5))
const stale = actor.messages.find((message): message is Extract<ServerRoomMessage, { type: 'error' }> => message.type === 'error' && message.requestId === 'stale-1')
assert.equal(stale?.error.code, 'stale_revision')

const invalid = await fetch(`${baseUrl}/api/rooms/${code}`, { headers: { authorization: 'Bearer wrong-token' } })
assert.equal(invalid.status, 403)

for (const client of clients) client.socket.close()
await Promise.all(clients.map((client) => once(client.socket, 'close')))
await new Promise<void>((resolve) => server.close(() => resolve()))
await closeRoomStore()

console.log('room server check passed: health, create, join, board seed and options plumbed into the played island, no bots, pre-auth rejection, private views, realtime action fanout, stale revision, seat auth')
