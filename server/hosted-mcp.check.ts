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
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['join_room', 'read_rules', 'get_playbook', 'get_view', 'wait_for_event', 'play_action'])
  const resources = await clients[0].listResources()
  assert.deepEqual(resources.resources.map((resource) => resource.uri), ['katan://rules/base-game', 'katan://skill/autonomous-player'])
  const prompt = await clients[0].getPrompt({ name: 'play-katan', arguments: { code, name: 'Atlas' } })
  assert.match(prompt.messages[0].content.type === 'text' ? prompt.messages[0].content.text : '', new RegExp(code))

  const atlas = (await toolJson(clients[0], 'join_room', { code, name: 'Atlas' })).body
  const moss = (await toolJson(clients[1], 'join_room', { code, name: 'Moss' })).body
  assert.equal(atlas.room.seats.at(-1).controller, 'agent')
  assert.equal(moss.room.seats.at(-1).controller, 'agent')
  assert.notEqual(atlas.playerKey, moss.playerKey)

  const forbidden = await toolJson(clients[0], 'get_view', { code, playerKey: `${atlas.playerKey}x`, afterRevision: 0 })
  assert.equal(forbidden.isError, true)

  const lobby = (await toolJson(clients[0], 'get_view', { code, playerKey: atlas.playerKey, afterRevision: 0 })).body
  const changed = toolJson(clients[0], 'wait_for_event', {
    code,
    playerKey: atlas.playerKey,
    afterUpdatedAt: lobby.cursor.updatedAt,
    afterRevision: 0,
    timeoutSeconds: 2,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await startRoom(code, host.credentials.token)
  const started = await changed
  assert.equal(started.body.timedOut, false)
  assert.ok(started.body.cursor.updatedAt > lobby.cursor.updatedAt)

  const view = (await toolJson(clients[0], 'get_view', { code, playerKey: atlas.playerKey, afterRevision: 0, includeBoard: true })).body
  assert.equal(view.room.status, 'playing')
  assert.ok(view.board.hexes.length > 0)
  assert.equal(view.publicState.events, undefined)
  assert.equal(view.publicState.board, undefined)
  assert.ok(Array.isArray(view.eventsSinceRevision))
  assert.equal(view.privateState.resources !== undefined, true)

  const wait = await toolJson(clients[0], 'wait_for_event', {
    code,
    playerKey: atlas.playerKey,
    afterUpdatedAt: view.cursor.updatedAt,
    afterRevision: view.revision,
    timeoutSeconds: 1,
  })
  assert.equal(wait.body.timedOut, true)

  console.log('hosted MCP check passed: origin guard, capped stateless HTTP, instructions, rules + skill resources, prompt, isolated seat keys, redacted views, event cursor, final wait read')
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => {})))
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeRoomStore()
}
