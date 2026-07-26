import type http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { clientIdentity, enforceRateLimit, getRoomView, joinRoom, playRoomAction, RoomError, waitForRoomChange } from './room-service.js'
import { AGENT_INSTRUCTIONS, PLAYER_SKILL, PLAYER_SKILL_URI, RULES, RULES_URI, playPromptText } from './mcp-content.js'
import { choiceFieldFor, gameOver, seatMustAct, textResult, toAgentBoard, toAgentView } from './mcp-view.js'

const MAX_MCP_BODY_BYTES = 64 * 1024
// A live seat makes a handful of calls per turn and several seats can share one
// egress IP, so the ceiling is generous. Configurable because a local suite
// drives a whole game through one socket in well under a minute.
const MCP_RATE_LIMIT = Number(process.env.KATAN_MCP_RATE_LIMIT) > 0 ? Number(process.env.KATAN_MCP_RATE_LIMIT) : 180
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, 'Use the six-character room code.')
const keySchema = z.string().min(32).max(128).describe('Secret seat credential returned once by join_room. Omit when the live runner supplies bearer authentication.')

/**
 * Failures a seat can play through. Each one is answered with the current view
 * instead of a bare message, because an agent that only learns "that did not
 * work" has to guess its way back and an agent that guesses wrong stops.
 */
const RECOVERABLE = new Set(['stale_revision', 'not_your_turn', 'illegal_action', 'room_busy', 'room_not_playing'])

/**
 * Copying a grouped action back verbatim, `or` list and all, is the natural
 * thing for an agent to do and no real action has an `or` field. Dropping it is
 * kinder, and cheaper, than teaching every agent the distinction the hard way.
 */
const withoutAlternatives = ({ or: _or, ...action }: Record<string, unknown>) => action

/** The one grouped-action mistake left worth naming: sending the field as a list. */
const listChoiceHint = (action: Record<string, unknown>) => {
  const field = choiceFieldFor(action.type)
  if (field && Array.isArray(action[field])) {
    return `Send a single ${field} value. Pick one from the \`or\` list beside the action if you do not want the one it came with.`
  }
  return undefined
}

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
      keepAlive: `Every other Katan call needs code ${joined.room.code} and this playerKey. Carry both forward through any summary or context compaction; there is no way to re-issue this key for this seat.`,
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

  server.registerTool('get_board', {
    title: 'Read the island once',
    description: 'Read the static island: hexes with their terrain and number, which hexes each corner touches, which corners each road slot joins, and the harbors. None of it changes for the whole game, so call this once after the host starts and keep the answer. get_view carries everything that moves, including the robber.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
    },
  }, async ({ code, playerKey: explicitKey }) => {
    const room = await getRoomView(code, playerKey(explicitKey))
    if (!room.game) {
      return textResult({
        status: room.status,
        note: 'The host has not started the game, so no island has been dealt. Call wait_for_event, then call get_board once.',
      })
    }
    return textResult({
      code: room.code,
      seats: room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
      you: room.viewerPlayerId,
      ...toAgentBoard(room.game.publicState.board),
    })
  })

  server.registerTool('get_view', {
    title: 'Inspect one private player view',
    description: 'Read everything that changes: whose decision it is, this seat own hand, every player public holdings and score, recent public events, and this seat legal actions. Opponent hidden cards are never returned. The island itself is static and lives in get_board. Every entry in legalActions is playable exactly as written; where a family of placements shares a shape, the other values for that field sit in a sibling `or` list.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      afterRevision: z.number().int().min(0).default(0).describe('Return public events newer than this game revision. Omit it and you get the recent tail, which is enough to re-orient after losing your place.'),
    },
  }, async ({ code, playerKey: explicitKey, afterRevision }) => textResult(toAgentView(
    await getRoomView(code, playerKey(explicitKey)),
    { afterRevision },
  )))

  server.registerTool('wait_for_event', {
    title: 'Wait for this seat next decision',
    description: 'Block until this seat has a legal move, the game ends, or the timeout expires, then return the fresh view. This is how a plain MCP chat sleeps between turns instead of polling. Every argument except the room code is optional, so a seat that has lost its cursor can still call it.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      afterUpdatedAt: z.number().int().min(0).optional().describe('The cursor.updatedAt from the last Katan reply. Omit it to wait from right now.'),
      afterRevision: z.number().int().min(0).default(0),
      timeoutSeconds: z.number().int().min(1).max(25).default(20),
      untilMyTurn: z.boolean().default(true).describe('Keep waiting through other seats moves. Set false to wake on any table change, for example to watch a trade you are not part of.'),
    },
  }, async ({ code, playerKey: explicitKey, afterUpdatedAt, afterRevision, timeoutSeconds, untilMyTurn }) => {
    const resolvedKey = playerKey(explicitKey)
    const deadline = Date.now() + timeoutSeconds * 1_000
    let cursor = afterUpdatedAt ?? (await getRoomView(code, resolvedKey)).updatedAt
    let result = await waitForRoomChange(code, resolvedKey, cursor, Math.max(1, deadline - Date.now()))
    while (untilMyTurn && !result.timedOut && !seatMustAct(result.room) && !gameOver(result.room) && Date.now() < deadline) {
      cursor = result.room.updatedAt
      result = await waitForRoomChange(code, resolvedKey, cursor, Math.max(1, deadline - Date.now()))
    }
    return textResult(toAgentView(result.room, { afterRevision, timedOut: result.timedOut }))
  })

  server.registerTool('play_action', {
    title: 'Play one legal action',
    description: 'Submit exactly one action at the current expectedRevision: an entry from legalActions as written, the same entry with one value swapped in from its `or` list, or an exact discard or trade bundle. A move that no longer fits comes back with applied false and the current view attached, so one call is always enough to get back on your feet.',
    inputSchema: {
      code: codeSchema,
      playerKey: keySchema.optional(),
      expectedRevision: z.number().int().min(0),
      action: z.record(z.string(), z.unknown()).describe('One GameAction JSON object with its type and required fields. Copying a grouped action from legalActions verbatim is fine; its `or` list is ignored.'),
    },
  }, async ({ code, playerKey: explicitKey, expectedRevision, action }) => {
    const resolvedKey = playerKey(explicitKey)
    const submitted = withoutAlternatives(action)
    try {
      await playRoomAction(code, resolvedKey, expectedRevision, submitted)
    } catch (error) {
      if (!(error instanceof RoomError) || !RECOVERABLE.has(error.code)) throw error
      return textResult({
        applied: false,
        error: { code: error.code, message: error.message },
        hint: listChoiceHint(submitted) ?? 'Read revision, actionRequired and legalActions below and submit one action at that revision.',
        ...toAgentView(await getRoomView(code, resolvedKey)),
      })
    }
    return textResult({ applied: true, ...toAgentView(await getRoomView(code, resolvedKey), { afterRevision: expectedRevision }) })
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

/**
 * A runner seat carries the credential this server minted for it, which is a
 * truer identity than an address that a human host and several local agent
 * seats all share. Callers without one still answer for their address.
 */
const requestIdentity = (request: http.IncomingMessage) => {
  const authorization = request.headers.authorization
  if (authorization?.startsWith('Bearer ')) return `seat:${authorization.slice(7)}`
  return clientIdentity(request)
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
    await enforceRateLimit('mcp', requestIdentity(request), MCP_RATE_LIMIT, 60)
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
