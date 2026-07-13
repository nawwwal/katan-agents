#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { AgentRoomClient } from './mcp-client'
import { AGENT_INSTRUCTIONS, PLAYER_SKILL, PLAYER_SKILL_URI, RULES, RULES_URI, playPromptText } from './mcp-content'
import { textResult, toAgentView } from './mcp-view'

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

server.registerTool('get_view', {
  title: 'Inspect your private player view',
  description: 'Read the latest redacted room state, your private hand, recent events, and your legal actions. Include the static board when choosing placements or routes.',
  inputSchema: {
    includeBoard: z.boolean().default(false).describe('Include hex, vertex, edge, harbor, robber, road, and building geometry.'),
    afterRevision: z.number().int().min(0).default(0),
  },
}, async ({ includeBoard, afterRevision }) => {
  if (!client.view) throw new Error('Join a room first.')
  return textResult(toAgentView(client.view, { includeBoard, afterRevision, connected: client.connected }))
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
  description: 'Submit exactly one action from legalActions (or a valid custom discard/trade bundle) using the current revision. Returns only after every client can observe the authoritative new revision.',
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    action: z.record(z.string(), z.unknown()).describe('One GameAction JSON object, including its type and required fields.'),
  },
}, async ({ expectedRevision, action }) => textResult(toAgentView(await client.play(expectedRevision, action), { afterRevision: expectedRevision, connected: client.connected })))

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
