#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { AgentRoomClient } from './mcp-client'
import { AGENT_INSTRUCTIONS, PLAYER_SKILL, PLAYER_SKILL_URI, RULES, RULES_URI, playPromptText } from './mcp-content'
import { textResult, toAgentBoard, toAgentView } from './mcp-view'

const client = new AgentRoomClient()
const server = new McpServer({ name: 'katan-player', version: '2.0.0' }, { instructions: AGENT_INSTRUCTIONS })

server.registerResource('katan-base-rules', RULES_URI, {
  title: 'Katan base-game rules for agents',
  description: 'The exact turn, trade, build, robber, development-card, victory, and room-protocol rules an agent needs to play.',
  mimeType: 'text/plain',
}, async () => ({ contents: [{ uri: RULES_URI, text: RULES }] }))

server.registerResource('katan-autonomous-player', PLAYER_SKILL_URI, {
  title: 'Katan autonomous-player skill',
  description: 'The live event loop, security boundary, public-information discipline, and strategy guide for an agent seat.',
  mimeType: 'text/plain',
}, async () => ({ contents: [{ uri: PLAYER_SKILL_URI, text: PLAYER_SKILL }] }))

server.registerTool('join_room', {
  title: 'Join a Katan room',
  description: 'Claim one agent seat in a lobby using the same six-character room code humans share. Call once per MCP process/thread.',
  inputSchema: {
    code: z.string().length(6).describe('Six-character room code'),
    name: z.string().min(1).max(22).describe('The agent name visible at the table'),
    serverUrl: z.string().url().optional().describe('Hosted game origin, for example https://katan.example.com. Defaults to KATAN_SERVER_URL.'),
  },
}, async ({ code, name, serverUrl }) => textResult(toAgentView(await client.join(code, name, serverUrl), { connected: client.connected, afterRevision: 0 })))

server.registerTool('read_rules', {
  title: 'Read the Katan rules',
  description: 'Read the concise base-game and protocol playbook before making decisions.',
}, async () => textResult(RULES))

server.registerTool('get_playbook', {
  title: 'Read the autonomous-player skill',
  description: 'Read how to handle live wake-ups, public events, trades, credentials, legal actions, and strategic decisions.',
}, async () => textResult(PLAYER_SKILL))

server.registerTool('get_board', {
  title: 'Read the island once',
  description: 'Read the static island: hexes with terrain and number, which hexes each corner touches, which corners each road slot joins, and the harbors. None of it changes for the whole game, so call it once and keep the answer. get_view carries everything that moves, including the robber.',
}, async () => {
  if (!client.view) throw new Error('Join a room first.')
  const room = client.view
  if (!room.game) return textResult({ status: room.status, note: 'The host has not started the game, so no island has been dealt yet.' })
  return textResult({
    code: room.code,
    seats: room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
    you: room.viewerPlayerId,
    ...toAgentBoard(room.game.publicState.board),
  })
})

server.registerTool('get_view', {
  title: 'Inspect your private player view',
  description: 'Read everything that changes: whose decision it is, your hand, every player public holdings and score, recent public events, and your legal actions. The island itself is static and lives in get_board. Every entry in legalActions is playable exactly as written; where a family of placements shares a shape, the other values for that field sit in a sibling `or` list.',
  inputSchema: {
    afterRevision: z.number().int().min(0).default(0),
  },
}, async ({ afterRevision }) => {
  if (!client.view) throw new Error('Join a room first.')
  return textResult(toAgentView(client.view, { afterRevision, connected: client.connected }))
})

server.registerTool('wait_for_turn', {
  title: 'Wait for your next decision',
  description: 'Wait efficiently on realtime room updates until this agent must act, the game finishes, or the timeout expires.',
  inputSchema: { timeoutSeconds: z.number().int().min(1).max(45).default(30) },
}, async ({ timeoutSeconds }) => {
  const afterRevision = client.view?.game?.revision ?? 0
  const result = await client.waitForTurn(timeoutSeconds * 1_000)
  return textResult(toAgentView(result.room, { afterRevision, connected: client.connected, timedOut: result.timedOut }))
})

server.registerTool('wait_for_event', {
  title: 'Compatibility wait for a room event',
  description: 'Wait for the next room change without spinning. The live runner is preferred because it wakes the model only for a decision.',
  inputSchema: { timeoutSeconds: z.number().int().min(1).max(45).default(30) },
}, async ({ timeoutSeconds }) => {
  const afterRevision = client.view?.game?.revision ?? 0
  const result = await client.waitForTurn(timeoutSeconds * 1_000)
  return textResult(toAgentView(result.room, { afterRevision, connected: client.connected, timedOut: result.timedOut }))
})

server.registerTool('play_action', {
  title: 'Play one legal action',
  description: 'Submit exactly one action at the current revision: an entry from legalActions as written, the same entry with one value swapped in from its `or` list, or a valid discard or trade bundle. A move that no longer fits comes back with applied false and the current view attached, so one call is always enough to get back on your feet.',
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    action: z.record(z.string(), z.unknown()).describe('One GameAction JSON object with its type and required fields. Copying a grouped action from legalActions verbatim is fine; its `or` list is ignored.'),
  },
}, async ({ expectedRevision, action }) => {
  const { or: _alternatives, ...submitted } = action
  try {
    return textResult({ applied: true, ...toAgentView(await client.play(expectedRevision, submitted), { afterRevision: expectedRevision, connected: client.connected }) })
  } catch (error) {
    if (!client.view) throw error
    return textResult({
      applied: false,
      error: { message: error instanceof Error ? error.message : 'That move did not apply.' },
      hint: 'Read revision, actionRequired and legalActions below and submit one action at that revision.',
      ...toAgentView(client.view, { connected: client.connected }),
    })
  }
})

server.registerPrompt('play-katan', {
  title: 'Play a Katan seat',
  description: 'A portable operating loop for an autonomous Codex, Claude, or other MCP-capable player.',
  argsSchema: { code: z.string(), name: z.string() },
}, ({ code, name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: playPromptText(code, name) } }] }))

const transport = new StdioServerTransport()
await server.connect(transport)

const shutdown = () => { client.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
