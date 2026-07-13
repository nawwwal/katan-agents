#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { AgentRoomClient } from './mcp-client'
import type { RoomView } from '../src/game/room'

const RULES_URI = 'katan://rules/base-game'
const RULES = `KATAN BASE GAME — AGENT PLAYBOOK

Objective
- Reach 10 victory points on your own turn. Settlements are worth 1, cities 2, Longest Road 2, Largest Army 2, and some development cards are hidden victory points.

Setup
- In the first pass, each player places one settlement and one adjacent road. The order then reverses for the second settlement and road.
- The second settlement collects one starting resource from every adjacent productive terrain hex.
- Settlements must be at least two edges apart. Roads must connect to your building or road network.

Turn flow
1. Before rolling, you may play at most one non-victory development card bought on an earlier turn.
2. Roll two dice. Matching numbered hexes produce for every adjacent settlement (1 card) and city (2 cards), unless blocked by the robber.
3. In the action phase, trade and build in any order, play one eligible development card if you have not already, then end the turn.

Seven and robber
- On a 7, every player with more than 7 resource cards discards half, rounded down.
- Move the robber to a different hex. That hex stops producing. If rivals have buildings beside it, choose one and steal one random card.

Trading
- Domestic trades name one target player and exact give/receive bundles. The target may accept, decline, or counter. Never assume a rival's hidden cards from a rejected trade.
- Maritime trade is normally 4 identical cards for 1. A 3:1 harbor improves all resources; a matching 2:1 harbor improves that resource.

Build costs and limits
- Road: 1 brick + 1 lumber. Maximum 15.
- Settlement: 1 brick + 1 lumber + 1 grain + 1 wool. Maximum 5; must connect to your road.
- City: 3 ore + 2 grain. Upgrades one of your settlements. Maximum 4.
- Development card: 1 ore + 1 grain + 1 wool.

Development cards
- Knight moves the robber and counts toward Largest Army.
- Road Building places up to two free legal roads.
- Year of Plenty takes two resources the bank can supply.
- Monopoly takes every rival's cards of one named resource.
- Victory-point cards stay hidden until the game is won.
- A card cannot be played on the turn it was bought. Only one non-victory development card may be played per turn.

Awards
- Longest Road requires a continuous road of at least 5; an opponent building can split a route.
- Largest Army requires at least 3 played knights.

Protocol discipline
- Call join_room once, then read_rules once.
- Call wait_for_turn. When it returns your turn, inspect revision and legalActions.
- Use get_view with includeBoard=true when you need terrain, vertex, edge, harbor, or route geometry.
- Send exactly one legal action with play_action and the current expectedRevision. Never invent resource names, IDs, actions, or hidden information.
- After playing, continue with the returned view. A turn can require several actions, especially setup, discards, robber choices, trades, and development cards.`

const client = new AgentRoomClient()
const server = new McpServer({ name: 'katan-player', version: '1.0.0' })

const textResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

const agentView = (room: RoomView, includeBoard = false, timedOut = false) => {
  if (!room.game) return { room: { code: room.code, status: room.status, seats: room.seats, seatsTotal: room.seatsTotal }, you: room.viewerPlayerId, connected: client.connected, timedOut }
  const view = room.game
  const { board, events, ...publicState } = view.publicState
  const actorId = publicState.actingPlayerId
    ?? (publicState.phase === 'discard' ? publicState.discardQueue[0] : publicState.players[publicState.activePlayerIndex]?.id)
  return {
    room: { code: room.code, status: room.status, seats: room.seats, seatsTotal: room.seatsTotal },
    you: view.playerId,
    connected: client.connected,
    timedOut,
    revision: view.revision,
    phase: view.phase,
    currentActorId: actorId,
    isYourTurn: actorId === view.playerId,
    privateState: view.privateState,
    publicState: { ...publicState, recentEvents: events.slice(-12) },
    legalActions: view.legalActions,
    ...(includeBoard ? { board } : {}),
  }
}

server.registerResource('katan-base-rules', RULES_URI, {
  title: 'Katan base-game rules for agents',
  description: 'The exact turn, trade, build, robber, development-card, victory, and room-protocol rules an agent needs to play.',
  mimeType: 'text/plain',
}, async () => ({ contents: [{ uri: RULES_URI, text: RULES }] }))

server.registerTool('join_room', {
  title: 'Join a Katan room',
  description: 'Claim one agent seat in a lobby using the same six-character room code humans share. Call once per MCP process/thread.',
  inputSchema: {
    code: z.string().length(6).describe('Six-character room code'),
    name: z.string().min(1).max(22).describe('The agent name visible at the table'),
    serverUrl: z.string().url().optional().describe('Hosted game origin, for example https://katan.example.com. Defaults to KATAN_SERVER_URL.'),
  },
}, async ({ code, name, serverUrl }) => textResult(agentView(await client.join(code, name, serverUrl))))

server.registerTool('read_rules', {
  title: 'Read the Katan rules',
  description: 'Read the concise base-game and protocol playbook before making decisions.',
}, async () => textResult(RULES))

server.registerTool('get_view', {
  title: 'Inspect your private player view',
  description: 'Read the latest redacted room state, your private hand, recent events, and your legal actions. Include the static board when choosing placements or routes.',
  inputSchema: { includeBoard: z.boolean().default(false).describe('Include hex, vertex, edge, harbor, robber, road, and building geometry.') },
}, async ({ includeBoard }) => {
  if (!client.view) throw new Error('Join a room first.')
  return textResult(agentView(client.view, includeBoard))
})

server.registerTool('wait_for_turn', {
  title: 'Wait for your next decision',
  description: 'Wait efficiently on realtime room updates until this agent must act, the game finishes, or the timeout expires.',
  inputSchema: { timeoutSeconds: z.number().int().min(1).max(45).default(30) },
}, async ({ timeoutSeconds }) => {
  const result = await client.waitForTurn(timeoutSeconds * 1_000)
  return textResult(agentView(result.room, false, result.timedOut))
})

server.registerTool('play_action', {
  title: 'Play one legal action',
  description: 'Submit exactly one action from legalActions (or a valid custom discard/trade bundle) using the current revision. Returns only after every client can observe the authoritative new revision.',
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    action: z.record(z.string(), z.unknown()).describe('One GameAction JSON object, including its type and required fields.'),
  },
}, async ({ expectedRevision, action }) => textResult(agentView(await client.play(expectedRevision, action))))

server.registerPrompt('play-katan', {
  title: 'Play a Katan seat',
  description: 'A compact operating loop for an autonomous Codex player.',
  argsSchema: { code: z.string(), name: z.string() },
}, ({ code, name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Join Katan room ${code} as ${name}. Read the rules once. Keep your own personality, play to win, use only your redacted view, never assume hidden cards, and keep calling wait_for_turn followed by legal play_action calls until the game ends.` } }] }))

const transport = new StdioServerTransport()
await server.connect(transport)

const shutdown = () => { client.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
