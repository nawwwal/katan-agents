import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import WebSocket from 'ws'
import { AgentRoomClient } from './mcp-client'
import { createRealtimeServer } from './realtime-server'
import { closeRoomStore } from './room-service'
import type { RoomView, ServerRoomMessage } from '../src/game/room'

const roomServer = createRealtimeServer()
roomServer.listen(0, '127.0.0.1')
await once(roomServer, 'listening')
const port = (roomServer.address() as AddressInfo).port
const baseUrl = `http://127.0.0.1:${port}`

const post = async (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const create = await post('/api/rooms', { name: 'Aditya', seatsTotal: 3 })
const host = (await create.json()).data
const code = host.credentials.code as string
const humanResponse = await post(`/api/rooms/${code}/seats`, { name: 'Mara', controller: 'human' })
const human = (await humanResponse.json()).data

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['node_modules/tsx/dist/cli.mjs', 'server/mcp.ts'],
  cwd: process.cwd(),
  env: { ...process.env, KATAN_SERVER_URL: baseUrl } as Record<string, string>,
  stderr: 'pipe',
})
const mcp = new Client({ name: 'katan-mcp-check', version: '1.0.0' })
type TextToolResult = { content: Array<{ type: string; text?: string }> }

const toolJson = async (name: string, args: Record<string, unknown>) => {
  const result = await mcp.callTool({ name, arguments: args }) as TextToolResult
  const block = result.content.find((entry) => entry.type === 'text')
  assert.ok(block?.text)
  return JSON.parse(block.text)
}

type BrowserClient = { socket: WebSocket; messages: ServerRoomMessage[] }
const connectBrowser = async (token: string): Promise<BrowserClient> => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
  await once(socket, 'open')
  const messages: ServerRoomMessage[] = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerRoomMessage))
  socket.send(JSON.stringify({ type: 'hello', code, token }))
  while (!messages.some((message) => message.type === 'snapshot')) await new Promise((resolve) => setTimeout(resolve, 5))
  return { socket, messages }
}

/**
 * A grouped action is playable as it stands, with its alternatives alongside in
 * `or`. An agent is free to send the whole thing back, so the check does.
 */
const asSent = (action: Record<string, unknown>) => action

const latest = (client: BrowserClient) => client.messages.filter((message): message is Extract<ServerRoomMessage, { type: 'snapshot' }> => message.type === 'snapshot').at(-1)!.room
const waitForRevision = async (clients: BrowserClient[], revision: number) => {
  while (!clients.every((client) => latest(client).game?.revision === revision)) await new Promise((resolve) => setTimeout(resolve, 5))
}

const browsers: BrowserClient[] = []
try {
  await mcp.connect(transport)
  const tools = await mcp.listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['join_room', 'read_rules', 'get_playbook', 'get_board', 'get_view', 'wait_for_turn', 'wait_for_event', 'play_action'])
  const resources = await mcp.listResources()
  assert.deepEqual(resources.resources.map((resource) => resource.uri), ['katan://rules/base-game', 'katan://skill/autonomous-player'])
  assert.match(mcp.getInstructions() ?? '', /live runner owns sleeping/i)
  const rules = await mcp.callTool({ name: 'read_rules', arguments: {} }) as TextToolResult
  assert.match(rules.content[0].text ?? '', /10 victory points/)
  const joined = await toolJson('join_room', { code, name: 'Atlas' })
  assert.equal(joined.status, 'lobby')
  assert.equal(joined.seats.at(-1).id, 'p2')
  const lobbyWaitStartedAt = Date.now()
  const lobbyWait = await toolJson('wait_for_turn', { timeoutSeconds: 1 })
  assert.equal(lobbyWait.timedOut, true)
  assert.ok(Date.now() - lobbyWaitStartedAt >= 800, 'an agent should wait efficiently instead of spinning in the lobby')

  browsers.push(await connectBrowser(host.credentials.token), await connectBrowser(human.credentials.token))
  browsers[0].socket.send(JSON.stringify({ type: 'start', requestId: 'start' }))
  while (!browsers.every((browser) => latest(browser).status === 'playing')) await new Promise((resolve) => setTimeout(resolve, 5))

  const waiting = toolJson('wait_for_turn', { timeoutSeconds: 5 })
  let agentView = await toolJson('get_view', {})
  for (let step = 0; !agentView.isYourTurn && step < 8; step += 1) {
    const room: RoomView = latest(browsers[0])
    const actorId = room.game!.publicState.actingPlayerId ?? room.game!.publicState.players[room.game!.publicState.activePlayerIndex].id
    const actor = browsers.find((browser) => latest(browser).viewerPlayerId === actorId)
    assert.ok(actor, 'a browser-controlled player should act before the agent')
    const actorRoom = latest(actor)
    const revision = actorRoom.game!.revision
    actor.socket.send(JSON.stringify({ type: 'action', requestId: `human-${step}`, expectedRevision: revision, action: actorRoom.game!.legalActions[0] }))
    await waitForRevision(browsers, revision + 1)
    agentView = await toolJson('get_view', {})
  }

  const board = await toolJson('get_board', {})
  assert.equal(board.hexes.length, 19, 'the static island is read once and carries every hex')
  assert.equal(Object.keys(board.vertexHexes).length, 54)
  assert.equal(Object.keys(board.edges).length, 72)

  const turn = await waiting
  assert.equal(turn.isYourTurn, true)
  assert.equal(agentView.isYourTurn, true)
  assert.ok(agentView.legalActions.length > 0)
  const before = agentView.revision as number
  const after = await toolJson('play_action', { expectedRevision: before, action: asSent(agentView.legalActions[0]) })
  assert.equal(after.applied, true)
  assert.equal(after.revision, before + 1)

  const stale = await toolJson('play_action', { expectedRevision: before, action: asSent(agentView.legalActions[0]) })
  assert.equal(stale.applied, false, 'a stale move must come back recoverable, not as a dead end')
  assert.equal(stale.revision, before + 1, 'a refused move must still hand back the current revision')
  await waitForRevision(browsers, before + 1)
  assert.equal(latest(browsers[0]).game?.revision, after.revision)

  const idleRoomResponse = await post('/api/rooms', { name: 'Idle host', seatsTotal: 3 })
  const idleRoom = (await idleRoomResponse.json()).data
  const idleClient = new AgentRoomClient(baseUrl, 20)
  try {
    await idleClient.join(idleRoom.credentials.code, 'Sleeper')
    assert.equal(idleClient.connected, true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(idleClient.connected, false, 'an unused MCP seat should release its socket')
    await post(`/api/rooms/${idleRoom.credentials.code}/seats`, { name: 'Late arrival', controller: 'human' })
    const refreshed = await idleClient.read()
    assert.equal(idleClient.connected, true)
    assert.equal(refreshed.seats.length, 3, 'the next tool call must reconnect and read a fresh room snapshot')
  } finally {
    idleClient.close()
  }

  console.log('mcp check passed: Codex tool discovery, rules, lobby wait, agent seat join, one-time board, realtime turn, grouped legal action, recoverable stale move, browser fanout, idle disconnect and fresh resume')
} finally {
  for (const browser of browsers) browser.socket.close()
  await Promise.all(browsers.map((browser) => browser.socket.readyState === WebSocket.CLOSED ? Promise.resolve() : once(browser.socket, 'close')))
  await mcp.close().catch(() => {})
  await new Promise<void>((resolve) => roomServer.close(() => resolve()))
  await closeRoomStore()
}
