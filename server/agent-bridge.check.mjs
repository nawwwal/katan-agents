import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'

const getFreePort = () => new Promise((resolve, reject) => {
  const probe = http.createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    probe.close(() => resolve(address.port))
  })
})

const runner = `
const { spawn } = require('node:child_process')
let input = ''
let resistTermination = false
process.on('SIGTERM', () => { if (!resistTermination) process.exit(143) })
process.stdin.on('data', (chunk) => { input += chunk; if (input.includes('"playerId":"p-resistant"')) resistTermination = true })
process.stdin.on('end', () => {
  if (input.includes('topSecret') || input.includes('"brick":99') || input.includes('"seed":')) process.exit(7)
  const view = JSON.parse(input.split('\\n\\n').at(-1))
  const send = () => process.stdout.write(JSON.stringify(view.legalActions[0]))
  if (view.playerId === 'p-discard-alt') return process.stdout.write(JSON.stringify({ type: 'discard', resources: { brick: 1, grain: 1 } }))
  if (view.playerId === 'p-trade-multi') return process.stdout.write(JSON.stringify({ type: 'offer-trade', trade: { fromPlayerId: view.playerId, toPlayerId: 'p-other', give: { brick: 2, lumber: 1 }, receive: { grain: 2 } } }))
  if (view.playerId === 'p-invalid') return process.stdout.write('not json')
  if (view.playerId === 'p-exit') { process.stderr.write('PRIVATE LOCAL ERROR'); return process.exit(2) }
  if (view.playerId === 'p-noisy') { process.stderr.write('x'.repeat(70 * 1024)); return setTimeout(send, 50) }
  if (view.playerId === 'p-timeout') return setTimeout(send, 900)
  if (view.playerId === 'p-slow') return setTimeout(send, 150)
  if (view.playerId === 'p-resistant') return setTimeout(send, 5000)
  if (view.playerId === 'p-descendant') {
    const descendant = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'inherit'] })
    descendant.unref()
    resistTermination = true
    return setTimeout(send, 5000)
  }
  send()
})
`

const makeView = (playerId = 'p-ok') => ({
  v: 1,
  revision: 7,
  playerId,
  phase: 'pre-roll',
  publicState: {
    version: 1,
    seed: 987654321,
    revision: 7,
    board: { hexes: [], vertices: {}, edges: {}, harbors: [], robberHexId: 'h0' },
    players: [{ id: playerId, name: 'Agent', color: 'blue', controller: 'agent', playedKnights: 0, roads: [], settlements: [], cities: [], ports: [], resourceCount: 0, developmentCount: 0, publicScore: 0, resources: { brick: 99 } }],
    activePlayerIndex: 0,
    phase: 'pre-roll',
    actingPlayerId: playerId,
    setupRound: 1,
    setupOrder: [0],
    setupStep: 0,
    discardQueue: [],
    bank: { brick: 19, lumber: 19, ore: 19, grain: 19, wool: 19 },
    roadOwners: {},
    buildings: {},
    developmentDeckCount: 25,
    discardRemaining: {},
    robberVictims: [],
    pendingRoads: 0,
    playedDevelopmentThisTurn: false,
    events: [],
  },
  privateState: { resources: { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 }, development: [], boughtDevelopment: [] },
  resourceCounts: { [playerId]: 0 },
  legalActions: [{ type: 'roll-dice', topSecret: 'drop me' }],
  topSecret: 'drop me too',
})

const port = await getFreePort()
const bridge = spawn(process.execPath, ['server/agent-bridge.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    KATAN_AGENT_PORT: String(port),
    KATAN_AGENT_TIMEOUT_MS: '250',
    KATAN_AGENT_COMMAND: process.execPath,
    KATAN_AGENT_ARGS: JSON.stringify(['-e', runner]),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const baseUrl = `http://127.0.0.1:${port}`
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/health`)
    if (response.ok) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 25))
}

const decision = (view, origin = 'http://127.0.0.1:5173') => fetch(`${baseUrl}/v1/decision`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  body: JSON.stringify(view),
})

const makeDiscardView = () => {
  const view = makeView('p-discard-alt')
  view.phase = 'discard'
  view.publicState.phase = 'discard'
  view.publicState.actingPlayerId = view.playerId
  view.publicState.discardRemaining = { [view.playerId]: 2 }
  view.privateState.resources = { brick: 2, lumber: 0, ore: 0, grain: 1, wool: 0 }
  view.legalActions = [{ type: 'discard', resources: { brick: 2 } }]
  return view
}

const makeMultiTradeView = () => {
  const view = makeView('p-trade-multi')
  view.phase = 'action'
  view.publicState.phase = 'action'
  view.publicState.actingPlayerId = view.playerId
  view.publicState.players.push({ id: 'p-other', name: 'Other', color: 'coral', controller: 'bot', playedKnights: 0, roads: [], settlements: [], cities: [], ports: [], resourceCount: 2, developmentCount: 0, publicScore: 0 })
  view.privateState.resources = { brick: 2, lumber: 1, ore: 0, grain: 0, wool: 0 }
  view.legalActions = [{ type: 'offer-trade', trade: { fromPlayerId: view.playerId, toPlayerId: 'p-other', give: { brick: 1 }, receive: { grain: 1 } } }]
  return view
}

try {
  const health = await (await fetch(`${baseUrl}/health`)).json()
  assert.deepEqual(health, { ok: true, status: 'ready', mode: 'external' })

  const noOrigin = await decision(makeView(), null)
  assert.equal(noOrigin.status, 403)
  assert.deepEqual(await noOrigin.json(), { error: 'origin_not_allowed' })

  const previewOrigin = await decision(makeView(), 'http://127.0.0.1:4173')
  assert.equal(previewOrigin.status, 200)

  const smuggled = await decision(makeView())
  assert.equal(smuggled.status, 200)
  assert.deepEqual(await smuggled.json(), { revision: 7, action: { type: 'roll-dice' } })

  const alternativeDiscard = await decision(makeDiscardView())
  assert.equal(alternativeDiscard.status, 200)
  assert.deepEqual(await alternativeDiscard.json(), { revision: 7, action: { type: 'discard', resources: { brick: 1, grain: 1 } } })

  const multiTrade = await decision(makeMultiTradeView())
  assert.equal(multiTrade.status, 200)
  assert.deepEqual(await multiTrade.json(), { revision: 7, action: { type: 'offer-trade', trade: { fromPlayerId: 'p-trade-multi', toPlayerId: 'p-other', give: { brick: 2, lumber: 1 }, receive: { grain: 2 } } } })

  const mismatchView = makeView()
  mismatchView.publicState.revision = 6
  const mismatch = await decision(mismatchView)
  assert.equal(mismatch.status, 422)
  assert.deepEqual(await mismatch.json(), { error: 'revision_mismatch' })

  const slow = decision(makeView('p-slow'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  const busy = await decision(makeView())
  assert.equal(busy.status, 429)
  assert.deepEqual(await busy.json(), { error: 'agent_busy' })
  assert.equal((await slow).status, 200)

  const abortController = new AbortController()
  const aborted = fetch(`${baseUrl}/v1/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify(makeView('p-slow')),
    signal: abortController.signal,
  }).catch((error) => error)
  await new Promise((resolve) => setTimeout(resolve, 30))
  abortController.abort()
  assert.equal((await aborted).name, 'AbortError')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true, status: 'ready', mode: 'external' })

  const descendantStartedAt = performance.now()
  const descendant = await decision(makeView('p-descendant'))
  const descendantElapsed = performance.now() - descendantStartedAt
  assert.equal(descendant.status, 504)
  assert.deepEqual(await descendant.json(), { error: 'agent_timeout' })
  assert.ok(descendantElapsed < 2_200, `descendant timeout took ${descendantElapsed.toFixed(0)}ms`)
  assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true, status: 'ready', mode: 'external' })
  assert.equal((await decision(makeView())).status, 200)
  assert.equal((await decision(makeView())).status, 200)

  const resistant = decision(makeView('p-resistant'))
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true, status: 'busy', mode: 'external' })
  const resistantResponse = await resistant
  assert.equal(resistantResponse.status, 504)
  assert.deepEqual(await resistantResponse.json(), { error: 'agent_timeout' })
  assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true, status: 'ready', mode: 'external' })

  const invalid = await decision(makeView('p-invalid'))
  assert.equal(invalid.status, 422)
  assert.deepEqual(await invalid.json(), { error: 'agent_invalid_output' })

  const exited = await decision(makeView('p-exit'))
  assert.equal(exited.status, 502)
  const exitBody = await exited.text()
  assert.equal(exitBody, '{"error":"agent_failed"}')
  assert.ok(!exitBody.includes('PRIVATE LOCAL ERROR'))

  const noisy = await decision(makeView('p-noisy'))
  assert.equal(noisy.status, 502)
  assert.deepEqual(await noisy.json(), { error: 'agent_error_too_large' })

  const timedOut = await decision(makeView('p-timeout'))
  assert.equal(timedOut.status, 504)
  assert.deepEqual(await timedOut.json(), { error: 'agent_timeout' })
  console.log('agent bridge check passed: dev/preview origin, seed redaction, flexible discard/trade parity, strict concurrency, abort safety, descendant cleanup, failure privacy, timeout')
} finally {
  bridge.kill('SIGTERM')
}
