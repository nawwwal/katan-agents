import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const HOST = '127.0.0.1'
const PORT = Number(process.env.KATAN_AGENT_PORT || 8787)
const AGENT_TIMEOUT_MS = Math.min(Math.max(Number(process.env.KATAN_AGENT_TIMEOUT_MS || 30_000), 100), 60_000)
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_STDOUT_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const TERMINATION_GRACE_MS = 1_200
const FORCE_SETTLE_MS = 1_500
const RESOURCES = ['brick', 'lumber', 'ore', 'grain', 'wool']
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  ...(process.env.KATAN_AGENT_ORIGIN ? [process.env.KATAN_AGENT_ORIGIN] : []),
])
const ACTION_PRIORITY = [
  'discard', 'respond-trade', 'roll-dice', 'move-robber', 'steal-from', 'choose-year-of-plenty', 'choose-monopoly',
  'build-city', 'build-settlement', 'build-road', 'place-settlement', 'place-road', 'finish-road-building',
  'buy-development', 'play-development', 'end-turn', 'maritime-trade', 'offer-trade', 'counter-trade',
]
const ACTION_KEYS = {
  'place-settlement': ['type', 'vertexId'],
  'place-road': ['type', 'edgeId'],
  'roll-dice': ['type', 'dice'],
  discard: ['type', 'resources'],
  'move-robber': ['type', 'hexId'],
  'steal-from': ['type', 'playerId'],
  'build-road': ['type', 'edgeId', 'free'],
  'finish-road-building': ['type'],
  'build-settlement': ['type', 'vertexId'],
  'build-city': ['type', 'vertexId'],
  'buy-development': ['type'],
  'play-development': ['type', 'card'],
  'choose-year-of-plenty': ['type', 'resources'],
  'choose-monopoly': ['type', 'resource'],
  'maritime-trade': ['type', 'give', 'receive', 'ratio'],
  'offer-trade': ['type', 'trade'],
  'counter-trade': ['type', 'trade'],
  'respond-trade': ['type', 'accept'],
  'end-turn': ['type'],
  restart: ['type', 'seed'],
}

class BridgeError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => own(value, key)).map((key) => [key, value[key]]))
const resourceMap = (value) => Object.fromEntries(RESOURCES.filter((resource) => isRecord(value) && own(value, resource)).map((resource) => [resource, value[resource]]))
const primitiveRecord = (value) => Object.fromEntries(isRecord(value) ? Object.entries(value).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)) : [])
const stringRecord = (value) => Object.fromEntries(isRecord(value) ? Object.entries(value).filter(([, item]) => typeof item === 'string') : [])
const numberRecord = (value) => Object.fromEntries(isRecord(value) ? Object.entries(value).filter(([, item]) => typeof item === 'number' && Number.isFinite(item)) : [])
const stringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

const sanitizeAction = (action) => {
  if (!isRecord(action) || typeof action.type !== 'string' || !ACTION_KEYS[action.type]) throw new BridgeError('invalid_player_view', 400)
  const clean = pick(action, ACTION_KEYS[action.type])
  if (action.type === 'discard') clean.resources = resourceMap(action.resources)
  if (action.type === 'offer-trade' || action.type === 'counter-trade') {
    if (!isRecord(action.trade)) throw new BridgeError('invalid_player_view', 400)
    clean.trade = {
      ...pick(action.trade, ['fromPlayerId', 'toPlayerId']),
      give: resourceMap(action.trade.give),
      receive: resourceMap(action.trade.receive),
    }
  }
  return clean
}

const sanitizeBoard = (board) => {
  if (!isRecord(board)) throw new BridgeError('invalid_player_view', 400)
  const hexes = Array.isArray(board.hexes) ? board.hexes.filter(isRecord).map((hex) => ({ ...pick(hex, ['id', 'q', 'r', 'x', 'z', 'terrain', 'number']), vertices: stringArray(hex.vertices), edges: stringArray(hex.edges), neighbors: stringArray(hex.neighbors) })) : []
  const vertices = Object.fromEntries(isRecord(board.vertices) ? Object.entries(board.vertices).filter(([, vertex]) => isRecord(vertex)).map(([id, vertex]) => [id, { ...pick(vertex, ['id', 'x', 'z', 'harborId']), hexes: stringArray(vertex.hexes), edges: stringArray(vertex.edges), neighbors: stringArray(vertex.neighbors) }]) : [])
  const edges = Object.fromEntries(isRecord(board.edges) ? Object.entries(board.edges).filter(([, edge]) => isRecord(edge)).map(([id, edge]) => [id, { ...pick(edge, ['id']), vertices: stringArray(edge.vertices), hexes: stringArray(edge.hexes) }]) : [])
  const harbors = Array.isArray(board.harbors) ? board.harbors.map((harbor) => pick(harbor, ['id', 'edgeId', 'ratio', 'resource'])) : []
  return { hexes, vertices, edges, harbors, robberHexId: board.robberHexId }
}

const sanitizePublicState = (state) => {
  if (!isRecord(state)) throw new BridgeError('invalid_player_view', 400)
  const clean = pick(state, [
    'version', 'revision', 'activePlayerIndex', 'phase', 'setupRound', 'setupOrder', 'setupStep',
    'pendingSetupVertexId', 'actingPlayerId', 'discardQueue', 'pendingRoads', 'playedDevelopmentThisTurn',
    'lastRoll', 'winnerId', 'developmentDeckCount',
  ])
  clean.board = sanitizeBoard(state.board)
  clean.players = Array.isArray(state.players) ? state.players.filter(isRecord).map((player) => ({
    ...pick(player, ['id', 'name', 'color', 'controller', 'playedKnights', 'resourceCount', 'developmentCount', 'publicScore']),
    roads: stringArray(player.roads),
    settlements: stringArray(player.settlements),
    cities: stringArray(player.cities),
    ports: stringArray(player.ports),
  })) : []
  clean.bank = resourceMap(state.bank)
  clean.roadOwners = stringRecord(state.roadOwners)
  clean.buildings = Object.fromEntries(isRecord(state.buildings) ? Object.entries(state.buildings).map(([id, building]) => [id, pick(building, ['playerId', 'type'])]) : [])
  clean.discardRemaining = numberRecord(state.discardRemaining)
  clean.robberVictims = stringArray(state.robberVictims)
  clean.longestRoad = isRecord(state.longestRoad) ? pick(state.longestRoad, ['playerId', 'length']) : undefined
  clean.largestArmy = isRecord(state.largestArmy) ? pick(state.largestArmy, ['playerId', 'size']) : undefined
  clean.events = Array.isArray(state.events) ? state.events.map((event) => ({
    ...pick(event, ['id', 'revision', 'type', 'message', 'playerId']),
    ...(isRecord(event.publicData) ? { publicData: primitiveRecord(event.publicData) } : {}),
  })) : []
  if (isRecord(state.pendingTrade)) {
    clean.pendingTrade = {
      ...pick(state.pendingTrade, ['fromPlayerId', 'toPlayerId']),
      give: resourceMap(state.pendingTrade.give),
      receive: resourceMap(state.pendingTrade.receive),
    }
  }
  return clean
}

const sanitizeView = (view) => {
  if (!isRecord(view) || view.v !== 1 || !Number.isInteger(view.revision) || typeof view.playerId !== 'string' || !Array.isArray(view.legalActions)) throw new BridgeError('invalid_player_view', 400)
  if (view.revision < 0 || !Number.isSafeInteger(view.revision)) throw new BridgeError('invalid_player_view', 400)
  if (!isRecord(view.publicState) || view.publicState.revision !== view.revision) throw new BridgeError('revision_mismatch', 422)
  if (view.publicState.phase !== view.phase) throw new BridgeError('phase_mismatch', 422)
  if (view.publicState.actingPlayerId !== view.playerId) throw new BridgeError('actor_mismatch', 422)
  if (!view.legalActions.length) throw new BridgeError('no_legal_actions', 400)
  if (view.legalActions.length > 500) throw new BridgeError('too_many_legal_actions', 400)
  const clean = {
    v: 1,
    revision: view.revision,
    playerId: view.playerId,
    phase: view.phase,
    publicState: sanitizePublicState(view.publicState),
    privateState: {
      resources: resourceMap(view.privateState?.resources),
      development: Array.isArray(view.privateState?.development) ? [...view.privateState.development] : [],
      boughtDevelopment: Array.isArray(view.privateState?.boughtDevelopment) ? [...view.privateState.boughtDevelopment] : [],
    },
    resourceCounts: numberRecord(view.resourceCounts),
    legalActions: view.legalActions.map(sanitizeAction),
  }
  return clean
}

const json = (response, status, payload) => {
  if (response.writableEnded || response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  let settled = false
  const fail = (error) => {
    if (settled) return
    settled = true
    reject(error)
  }
  request.on('data', (chunk) => {
    if (settled) return
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      fail(new BridgeError('payload_too_large', 413))
      request.resume()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    if (settled) return
    settled = true
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
    catch { reject(new BridgeError('invalid_json', 400)) }
  })
  request.on('error', () => fail(new BridgeError('request_failed', 400)))
})

const heuristicDecision = (view) => {
  for (const type of ACTION_PRIORITY) {
    const action = view.legalActions.find((candidate) => candidate?.type === type)
    if (action) return action
  }
  return view.legalActions[0]
}

const parseArgs = () => {
  if (!process.env.KATAN_AGENT_ARGS) return []
  const args = JSON.parse(process.env.KATAN_AGENT_ARGS)
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) throw new Error('KATAN_AGENT_ARGS must be a JSON string array')
  return args
}

const runExternalAgent = async (view, signal) => {
  const command = process.env.KATAN_AGENT_COMMAND
  if (!command) return heuristicDecision(view)
  const args = parseArgs()
  const cwd = await mkdtemp(join(tmpdir(), 'katan-agent-'))
  const prompt = [
    'You are taking exactly one turn action in a deterministic hex-island strategy game.',
    'Return only one JSON object copied or derived from legalActions. No markdown and no explanation.',
    'For discard and domestic-trade actions, you may change non-negative resource quantities while obeying the visible required count, your private hand, and the listed participants.',
    'Never invent targets, hidden cards, dice results, or unavailable resources.',
    JSON.stringify(view),
  ].join('\n\n')
  try {
    return await new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new BridgeError('request_aborted', 499))
      const child = spawn(command, args, {
        cwd,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...Object.fromEntries(['PATH', 'HOME', 'CODEX_HOME', 'LANG', 'TMPDIR'].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])),
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      })
      const output = []
      let outputBytes = 0
      let stderrBytes = 0
      let settled = false
      let failure
      let killTimer
      let forceSettleTimer
      const signalTree = (signalName) => {
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, signalName)
            return
          } catch {}
        }
        try { child.kill(signalName) } catch {}
      }
      const finish = (callback) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        if (forceSettleTimer) clearTimeout(forceSettleTimer)
        signal.removeEventListener('abort', abort)
        callback()
      }
      const stop = (error) => {
        if (settled || failure) return
        failure = error
        signalTree('SIGTERM')
        killTimer = setTimeout(() => signalTree('SIGKILL'), TERMINATION_GRACE_MS)
        killTimer.unref()
        forceSettleTimer = setTimeout(() => {
          child.stdin.destroy()
          child.stdout.destroy()
          child.stderr.destroy()
          finish(() => reject(failure))
        }, FORCE_SETTLE_MS)
        forceSettleTimer.unref()
      }
      const abort = () => stop(new BridgeError('request_aborted', 499))
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => stop(new BridgeError('agent_timeout', 504)), AGENT_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > MAX_STDOUT_BYTES) {
          stop(new BridgeError('agent_output_too_large', 502))
          return
        }
        output.push(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length
        if (stderrBytes > MAX_STDERR_BYTES) {
          stop(new BridgeError('agent_error_too_large', 502))
        }
      })
      child.stdin.on('error', (error) => {
        if (settled || failure || signal.aborted || error?.code === 'EPIPE') return
        finish(() => reject(new BridgeError('agent_failed', 502)))
      })
      child.on('error', () => { if (!failure) finish(() => reject(new BridgeError('agent_failed', 502))) })
      child.on('close', (code) => finish(() => {
        if (failure) return reject(failure)
        if (code !== 0) return reject(new BridgeError('agent_failed', 502))
        try {
          resolve(JSON.parse(Buffer.concat(output).toString('utf8').trim()))
        } catch { reject(new BridgeError('agent_invalid_output', 422)) }
      }))
      child.stdin.end(prompt)
    })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key))
const validAgentResourceMap = (value) => isRecord(value)
  && Object.keys(value).every((resource) => RESOURCES.includes(resource))
  && Object.values(value).every((amount) => Number.isSafeInteger(amount) && amount >= 0)
const resourceTotal = (value) => RESOURCES.reduce((total, resource) => total + (value[resource] ?? 0), 0)
const disjointTrade = (trade) => RESOURCES.every((resource) => !(trade.give[resource] && trade.receive[resource]))

const validDiscardAction = (view, action) => {
  const required = view.publicState.discardRemaining?.[view.playerId]
  return view.phase === 'discard'
    && view.legalActions.some((candidate) => candidate.type === 'discard')
    && exactKeys(action, ['type', 'resources'])
    && validAgentResourceMap(action.resources)
    && resourceTotal(action.resources) === required
    && RESOURCES.every((resource) => (action.resources[resource] ?? 0) <= (view.privateState.resources[resource] ?? 0))
}

const validDomesticTradeAction = (view, action) => {
  if (!['offer-trade', 'counter-trade'].includes(action?.type) || !view.legalActions.some((candidate) => candidate.type === action.type)) return false
  const trade = action.trade
  if (!exactKeys(action, ['type', 'trade']) || !exactKeys(trade, ['fromPlayerId', 'toPlayerId', 'give', 'receive'])) return false
  if (trade.fromPlayerId !== view.playerId || typeof trade.toPlayerId !== 'string' || trade.toPlayerId === view.playerId) return false
  if (!validAgentResourceMap(trade.give) || !validAgentResourceMap(trade.receive) || !resourceTotal(trade.give) || !resourceTotal(trade.receive) || !disjointTrade(trade)) return false
  if (!RESOURCES.every((resource) => (trade.give[resource] ?? 0) <= (view.privateState.resources[resource] ?? 0))) return false
  if (action.type === 'counter-trade') return view.publicState.pendingTrade?.fromPlayerId === trade.toPlayerId && view.publicState.pendingTrade?.toPlayerId === trade.fromPlayerId
  return view.publicState.players.some((player) => player.id === trade.toPlayerId)
}

const legalAction = (view, action) => view.legalActions.some((candidate) => isDeepStrictEqual(candidate, action))
  || (action?.type === 'discard' && validDiscardAction(view, action))
  || validDomesticTradeAction(view, action)
let inFlight = false
const activeRequests = new Set()

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true, status: inFlight ? 'busy' : 'ready', mode: process.env.KATAN_AGENT_COMMAND ? 'external' : 'heuristic' })
  if (request.method !== 'POST' || request.url !== '/v1/decision') return json(response, 404, { error: 'not_found' })
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(response, 403, { error: 'origin_not_allowed' })
  if (inFlight) return json(response, 429, { error: 'agent_busy' })
  inFlight = true
  const controller = new AbortController()
  activeRequests.add(controller)
  request.once('aborted', () => controller.abort())
  response.once('close', () => { if (!response.writableEnded) controller.abort() })
  try {
    const view = sanitizeView(await readBody(request))
    const action = await runExternalAgent(view, controller.signal)
    if (!legalAction(view, action)) throw new BridgeError('illegal_agent_action', 422)
    return json(response, 200, { revision: view.revision, action })
  } catch (error) {
    const bridgeError = error instanceof BridgeError ? error : new BridgeError('agent_bridge_error', 500)
    return json(response, bridgeError.status, { error: bridgeError.code })
  } finally {
    activeRequests.delete(controller)
    inFlight = false
  }
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  for (const controller of activeRequests) controller.abort()
  const forceExit = setTimeout(() => {
    server.closeAllConnections()
    process.exit(1)
  }, 2_500)
  server.close(() => {
    clearTimeout(forceExit)
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

server.listen(PORT, HOST, () => {
  console.log(`Katan agent bridge listening on http://${HOST}:${PORT} (${process.env.KATAN_AGENT_COMMAND ? 'external agent' : 'heuristic fallback'})`)
})
