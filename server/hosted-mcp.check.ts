import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createRealtimeServer } from './realtime-server.js'
import { closeRoomStore, startRoom } from './room-service.js'

type TextToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

const server = createRealtimeServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = (server.address() as AddressInfo).port
const baseUrl = `http://127.0.0.1:${port}`

const post = async (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const toolJson = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args }) as TextToolResult
  const block = result.content.find((entry) => entry.type === 'text')
  assert.ok(block?.text, `${name} should return JSON text`)
  let body: unknown = block.text
  try { body = JSON.parse(block.text) } catch { /* SDK tool errors are plain text. */ }
  return { body: body as Record<string, any>, isError: result.isError ?? false }
}

const clients: Client[] = []
try {
  const rebinding = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      origin: 'http://localhost:5173',
      'x-forwarded-host': 'katan.example',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'origin-check', version: '1' } } }),
  })
  assert.equal(rebinding.status, 403)

  const oversized = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x'.repeat(70_000) }),
  })
  assert.equal(oversized.status, 413)

  const create = await post('/api/rooms', { name: 'Aditya', seatsTotal: 3 })
  assert.equal(create.status, 201)
  const host = (await create.json()).data
  const code = host.credentials.code as string

  for (const name of ['Atlas', 'Moss']) {
    const client = new Client({ name: `katan-hosted-check-${name}`, version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`)))
    clients.push(client)
    assert.match(client.getInstructions() ?? '', /live runner owns sleeping/i)
  }

  const tools = await clients[0].listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['join_room', 'read_rules', 'get_playbook', 'get_board', 'get_view', 'wait_for_event', 'play_action'])
  const resources = await clients[0].listResources()
  assert.deepEqual(resources.resources.map((resource) => resource.uri), ['katan://rules/base-game', 'katan://skill/autonomous-player'])
  const prompt = await clients[0].getPrompt({ name: 'play-katan', arguments: { code, name: 'Atlas' } })
  assert.match(prompt.messages[0].content.type === 'text' ? prompt.messages[0].content.text : '', new RegExp(code))

  const atlas = (await toolJson(clients[0], 'join_room', { code, name: 'Atlas' })).body
  const moss = (await toolJson(clients[1], 'join_room', { code, name: 'Moss' })).body
  assert.equal(atlas.you, 'p1')
  assert.equal(moss.you, 'p2')
  assert.equal(moss.status, 'lobby')
  assert.notEqual(atlas.playerKey, moss.playerKey)
  assert.match(atlas.keepAlive, new RegExp(code), 'join_room must tell a seat what it has to carry forward')

  const forbidden = await toolJson(clients[0], 'get_view', { code, playerKey: `${atlas.playerKey}x`, afterRevision: 0 })
  assert.equal(forbidden.isError, true)

  const lobby = (await toolJson(clients[0], 'get_view', { code, playerKey: atlas.playerKey, afterRevision: 0 })).body
  const changed = toolJson(clients[0], 'wait_for_event', {
    code,
    playerKey: atlas.playerKey,
    afterUpdatedAt: lobby.cursor.updatedAt,
    afterRevision: 0,
    timeoutSeconds: 2,
    untilMyTurn: false,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await startRoom(code, host.credentials.token)
  const started = await changed
  assert.equal(started.body.timedOut, false)
  assert.ok(started.body.cursor.updatedAt > lobby.cursor.updatedAt)

  const board = (await toolJson(clients[0], 'get_board', { code, playerKey: atlas.playerKey })).body
  assert.equal(board.hexes.length, 19)
  assert.equal(Object.keys(board.vertexHexes).length, 54)
  assert.equal(Object.keys(board.edges).length, 72)
  assert.equal(board.hexes[0].x, undefined, 'render coordinates are not an agent concern')

  const view = (await toolJson(clients[0], 'get_view', { code, playerKey: atlas.playerKey, afterRevision: 0 })).body
  assert.equal(view.status, 'playing')
  assert.equal(view.board, undefined, 'the static island must not ride along on a turn view')
  assert.equal(view.publicState, undefined)
  assert.ok(view.robberHexId, 'the robber moves, so the view has to carry it')
  assert.ok(Array.isArray(view.events))
  assert.ok(view.hand.brick !== undefined, 'a seat must always see its own hand')
  assert.equal(JSON.stringify(view).includes('victory-point'), false, 'no hidden card may leak through the lean view')

  const stale = (await toolJson(clients[0], 'play_action', { code, playerKey: atlas.playerKey, expectedRevision: view.revision + 99, action: { type: 'end-turn' } })).body
  assert.equal(stale.applied, false, 'a refused move must come back recoverable')
  assert.equal(stale.revision, view.revision, 'a refused move must hand back the live revision')
  assert.ok(Array.isArray(stale.legalActions))

  const listed = (await toolJson(clients[0], 'play_action', { code, playerKey: atlas.playerKey, expectedRevision: view.revision, action: { type: 'place-settlement', vertexId: ['v0', 'v1'] } })).body
  assert.equal(listed.applied, false)
  assert.match(listed.hint, /single vertexId/, 'sending a whole family back must be answered with the fix')

  const wait = await toolJson(clients[0], 'wait_for_event', {
    code,
    playerKey: atlas.playerKey,
    afterUpdatedAt: view.cursor.updatedAt,
    afterRevision: view.revision,
    timeoutSeconds: 1,
    untilMyTurn: false,
  })
  assert.equal(wait.body.timedOut, true)

  // Moss holds the third seat and never acts, so a turn-scoped wait must sleep
  // through the whole setup rather than waking on every other seat's move.
  const patient = await toolJson(clients[1], 'wait_for_event', { code, playerKey: moss.playerKey, timeoutSeconds: 1 })
  assert.equal(patient.body.timedOut, true, 'a turn-scoped wait must not wake a seat that has nothing to decide')

  // A seat that has lost its cursor must still be able to sleep and re-orient.
  const cursorless = await toolJson(clients[0], 'wait_for_event', { code, playerKey: atlas.playerKey, timeoutSeconds: 1 })
  assert.equal(cursorless.isError, false, 'wait_for_event must not require a cursor an agent may have lost')
  assert.equal(cursorless.body.timedOut, true)

  console.log('hosted MCP check passed: origin guard, capped stateless HTTP, instructions, rules + skill resources, prompt, isolated seat keys, one-time board, lean redacted views, recoverable refusals, cursorless wait')
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => {})))
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeRoomStore()
}
