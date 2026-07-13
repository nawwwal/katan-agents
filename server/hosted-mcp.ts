import type http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { enforceRateLimit, getRoomView, joinRoom, playRoomAction, RoomError, waitForRoomChange } from './room-service.js'
import { AGENT_INSTRUCTIONS, PLAYER_SKILL, PLAYER_SKILL_URI, RULES, RULES_URI, playPromptText } from './mcp-content.js'
import { textResult, toAgentView } from './mcp-view.js'

const MAX_MCP_BODY_BYTES = 64 * 1024
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, 'Use the six-character room code.')
const keySchema = z.string().min(32).max(128).describe('Secret seat credential returned once by join_room. Omit when the live runner supplies bearer authentication.')

const createHostedMcpServer = (bearerPlayerKey?: string) => {
  const server = new McpServer({ name: 'katan', version: '2.0.0' }, { instructions: AGENT_INSTRUCTIONS })
  const playerKey = (explicit?: string) => {
    if (bearerPlayerKey && explicit && bearerPlayerKey !== explicit) throw new RoomError('credential_mismatch', 'The explicit playerKey does not match this runner seat.', 403)
    const resolved = bearerPlayerKey ?? explicit
    if (!resolved) throw new RoomError('player_key_required', 'Pass the playerKey from join_room, or use the live runner.', 401)
    return resolved
  }

  server.registerResource('katan-base-rules', RULES_URI, {
    title: 'Katan base-game rules',
    description: 'Base-game objective, setup, turns, robber, trade, build, development-card, award, and victory rules.',
    mimeType: 'text/plain',
  }, async () => ({ contents: [{ uri: RULES_URI, text: RULES }] }))

  server.registerResource('katan-autonomous-player', PLAYER_SKILL_URI, {
    title: 'Katan autonomous-player skill',
    description: 'The live event loop, security boundary, public-information discipline, and strategy guide for an agent seat.',
    mimeType: 'text/plain',
  }, async () => ({ contents: [{ uri: PLAYER_SKILL_URI, text: PLAYER_SKILL }] }))

  server.registerTool('join_room', {
    title: 'Join one Katan seat',
    description: 'Claim one agent seat with the same six-character code humans use. Returns a secret playerKey for this seat; store it only in this conversation and pass it only to Katan tools.',
    inputSchema: {
      code: codeSchema,
      name: z.string().trim().min(1).max(22).describe('A distinct name visible to the table.'),
    },
  }, async ({ code, name }) => {
    if (bearerPlayerKey) throw new RoomError('runner_already_joined', 'The live runner already owns a seat. Use get_view instead of joining again.', 409)
    const joined = await joinRoom({ code, name, controller: 'agent' })
    return textResult({
      playerKey: joined.credentials.token,
      security: 'Secret bearer credential. Never quote, summarize, log, or pass it to any non-Katan tool.',
      ...toAgentView(joined.room, { afterRevision: 0 }),
    })
  })

  server.registerTool('read_rules', {
    title: 'Read the Katan rules',
    description: 'Read the concise base-game rules before making the first decision.',
  }, async () => textResult(RULES))

  server.registerTool('get_playbook', {
    title: 'Read the autonomous-player skill',
    description: 'Read how to handle live wake-ups, public events, trades, credentials, legal actions, and strategic decisions.',
  }, async () => textResult(PLAYER_SKILL))

  server.registerTool('get_view', {
    title: 'Inspect one private player view',
    description: 'Read the authoritative redacted state for this seat, including its own hand, public table state, all public events since a revision, and legal actions. Opponent hidden cards are never returned.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      afterRevision: z.number().int().min(0).default(0).describe('Return public events newer than this game revision.'),
      includeBoard: z.boolean().default(false).describe('Include static board geometry when choosing a placement, route, harbor, or robber destination.'),
    },
  }, async ({ code, playerKey: explicitKey, afterRevision, includeBoard }) => textResult(toAgentView(
    await getRoomView(code, playerKey(explicitKey)),
    { afterRevision, includeBoard },
  )))

  server.registerTool('wait_for_event', {
    title: 'Compatibility wait for a room event',
    description: 'Compatibility fallback for MCP chats without the live runner. Waits on a server event without spinning. The recommended runner wakes the model automatically and does not call this tool repeatedly.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      afterUpdatedAt: z.number().int().min(0).describe('The cursor.updatedAt value from the latest Katan response.'),
      afterRevision: z.number().int().min(0).default(0),
      timeoutSeconds: z.number().int().min(1).max(25).default(20),
      includeBoard: z.boolean().default(false),
    },
  }, async ({ code, playerKey: explicitKey, afterUpdatedAt, afterRevision, timeoutSeconds, includeBoard }) => {
    const result = await waitForRoomChange(code, playerKey(explicitKey), afterUpdatedAt, timeoutSeconds * 1_000)
    return textResult(toAgentView(result.room, { afterRevision, includeBoard, timedOut: result.timedOut }))
  })

  server.registerTool('play_action', {
    title: 'Play one legal action',
    description: 'Submit one action from legalActions, or a valid exact discard/trade bundle, at the current expectedRevision. Returns the new authoritative view and every public event created by that action.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      expectedRevision: z.number().int().min(0),
      action: z.record(z.string(), z.unknown()).describe('One GameAction JSON object with its type and required fields.'),
      includeBoard: z.boolean().default(false),
    },
  }, async ({ code, playerKey: explicitKey, expectedRevision, action, includeBoard }) => {
    const resolvedKey = playerKey(explicitKey)
    await playRoomAction(code, resolvedKey, expectedRevision, action)
    return textResult(toAgentView(await getRoomView(code, resolvedKey), { afterRevision: expectedRevision, includeBoard }))
  })

  server.registerPrompt('play-katan', {
    title: 'Play a live Katan seat',
    description: 'A portable prompt for an autonomous Codex, Claude, or other MCP-capable player.',
    argsSchema: {
      code: codeSchema,
      name: z.string().trim().min(1).max(22).optional(),
    },
  }, ({ code, name }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: playPromptText(code, name) } }],
    }))

  return server
}

const requestIdentity = (request: http.IncomingMessage) => {
  const forwarded = request.headers['x-vercel-forwarded-for'] ?? request.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return value?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
}

const assertAllowedOrigin = (request: http.IncomingMessage) => {
  const origin = request.headers.origin
  if (!origin) return
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new RoomError('invalid_origin', 'The MCP Origin header is invalid.', 403)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new RoomError('invalid_origin', 'The MCP Origin header is not allowed.', 403)
  const host = request.headers['x-forwarded-host'] ?? request.headers.host
  const requestHost = Array.isArray(host) ? host[0] : host
  const configured = (process.env.KATAN_MCP_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])
  const localOrigin = localHostnames.has(parsed.hostname)
  let localRequest = false
  try {
    localRequest = localHostnames.has(new URL(`http://${requestHost}`).hostname)
  } catch { /* A missing or malformed request host cannot qualify for the local exception. */ }
  if (parsed.host !== requestHost && !(localOrigin && localRequest) && !configured.includes(parsed.origin)) {
    throw new RoomError('origin_not_allowed', 'This browser origin is not allowed to call the MCP endpoint.', 403)
  }
}

const readMcpJson = (request: http.IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  let settled = false
  request.on('data', (chunk: Buffer) => {
    if (settled) return
    size += chunk.length
    if (size > MAX_MCP_BODY_BYTES) {
      settled = true
      chunks.length = 0
      reject(new RoomError('payload_too_large', 'The MCP request is too large.', 413))
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    if (settled) return
    try {
      settled = true
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      settled = true
      reject(new RoomError('invalid_json', 'Send valid JSON-RPC JSON.', 400))
    }
  })
  request.on('error', (error) => {
    if (settled) return
    settled = true
    reject(error)
  })
})

const jsonError = (response: http.ServerResponse, error: unknown) => {
  const roomError = error instanceof RoomError ? error : new RoomError('mcp_error', 'The hosted MCP request could not be completed.', 500)
  response.writeHead(roomError.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: roomError.code === 'invalid_json' ? -32700 : -32000, message: roomError.message, data: { code: roomError.code } }, id: null }))
}

export const handleHostedMcp = async (request: http.IncomingMessage, response: http.ServerResponse) => {
  try {
    assertAllowedOrigin(request)
    await enforceRateLimit('mcp', requestIdentity(request), 180, 60)
    const parsedBody = request.method === 'POST' ? await readMcpJson(request) : undefined
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const authorization = request.headers.authorization
    const bearerPlayerKey = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    const server = createHostedMcpServer(bearerPlayerKey)
    await server.connect(transport)
    try {
      await transport.handleRequest(request, response, parsedBody)
    } finally {
      await server.close().catch(() => {})
    }
  } catch (error) {
    if (!response.headersSent) jsonError(response, error)
    else response.end()
  }
}
