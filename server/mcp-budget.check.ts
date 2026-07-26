/**
 * Drives one agent seat through a whole game over the hosted MCP transport and
 * measures what that seat is asked to read. An agent pays for every byte of
 * every tool result, so an oversized view is not a cosmetic problem: it fills
 * the model's context, forces a compaction, and a compacted agent loses its
 * place. The budgets below are the guard against that regressing quietly.
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createRealtimeServer } from './realtime-server.js'
import { closeRoomStore, getRoomView, playRoomAction, startRoom } from './room-service.js'
import type { GameAction, PlayerView } from '../src/game/types.js'

/** Dice pips behind each number token, for valuing a corner. */
const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

/**
 * How the measured seat decides, reading nothing but the payloads the hosted
 * MCP handed it. If a lean view were missing something a player needs, this
 * would stall or play an illegal move, so the loop below is the sufficiency
 * proof as much as it is the measurement.
 */
const chooseFromView = (view: Record<string, any>, board: Record<string, any>): Record<string, unknown> | undefined => {
  const actions = (view.legalActions ?? []) as Record<string, any>[]
  if (!actions.length) return undefined
  // Every entry is playable as written; `or` holds the other values for the one
  // field that varies. Taking the default is dropping `or`, and taking an
  // alternative is swapping that field for one of its values.
  const one = ({ or: _or, ...action }: Record<string, any>) => action
  const swap = (action: Record<string, any>, field: string, choice: string) => ({ ...one(action), [field]: choice })
  const choices = (action: Record<string, any>, field: string) => [action[field] as string, ...((action.or ?? []) as string[])]
  const byType = (type: string) => actions.find((action) => action.type === type)

  const cornerValue = (vertexId: string) => {
    const terrains = new Set<string>()
    let score = 0
    for (const hexId of String(board.vertexHexes[vertexId] ?? '').split(' ').filter(Boolean)) {
      const hex = (board.hexes as Record<string, any>[]).find((candidate) => candidate.id === hexId)
      if (!hex || hex.terrain === 'desert') continue
      score += PIPS[hex.number as number] ?? 0
      terrains.add(hex.terrain)
    }
    return score + terrains.size * 1.6
  }
  const bestCorner = (action: Record<string, any>) =>
    swap(action, 'vertexId', choices(action, 'vertexId').toSorted((a, b) => cornerValue(b) - cornerValue(a))[0])

  const placement = byType('place-settlement')
  if (placement) return bestCorner(placement)
  for (const type of ['discard', 'respond-trade', 'roll-dice']) {
    const action = byType(type)
    if (action) return one(action)
  }
  const robber = byType('move-robber')
  if (robber) return one(robber)
  for (const type of ['steal-from', 'choose-year-of-plenty', 'choose-monopoly', 'build-city']) {
    const action = byType(type)
    if (action) return one(action)
  }
  const settlement = byType('build-settlement')
  if (settlement) return bestCorner(settlement)
  for (const type of ['place-road', 'build-road', 'finish-road-building', 'buy-development', 'play-development', 'end-turn', 'restart']) {
    const action = byType(type)
    if (action) return one(action)
  }
  return one(actions[0])
}

/**
 * How the other seats decide. They stand in for the humans and the other models
 * at the table and are driven straight through the room service, because only
 * the measured seat's cumulative read decides whether that seat compacts.
 */
const chooseForTable = (view: PlayerView): GameAction | undefined => {
  const actions = view.legalActions
  if (!actions.length) return undefined
  const pick = (type: GameAction['type']) => actions.find((action) => action.type === type)
  const corner = (vertexId: string) => {
    const vertex = view.publicState.board.vertices[vertexId]
    const terrains = new Set<string>()
    let score = 0
    for (const hexId of vertex?.hexes ?? []) {
      const hex = view.publicState.board.hexes.find((candidate) => candidate.id === hexId)
      if (!hex || hex.terrain === 'desert') continue
      score += PIPS[hex.number ?? 0] ?? 0
      terrains.add(hex.terrain)
    }
    return score + terrains.size * 1.6
  }
  const placements = actions.filter((action): action is Extract<GameAction, { type: 'place-settlement' }> => action.type === 'place-settlement')
  if (placements.length) return placements.toSorted((a, b) => corner(b.vertexId) - corner(a.vertexId))[0]
  for (const type of ['discard', 'respond-trade', 'roll-dice', 'move-robber', 'steal-from', 'choose-year-of-plenty', 'choose-monopoly', 'build-city'] as const) {
    const action = pick(type)
    if (action) return action
  }
  const builds = actions.filter((action): action is Extract<GameAction, { type: 'build-settlement' }> => action.type === 'build-settlement')
  if (builds.length) return builds.toSorted((a, b) => corner(b.vertexId) - corner(a.vertexId))[0]
  for (const type of ['place-road', 'build-road', 'finish-road-building', 'buy-development', 'play-development', 'end-turn', 'restart'] as const) {
    const action = pick(type)
    if (action) return action
  }
  return actions[0]
}

/**
 * Bytes per token for dense identifier-heavy JSON. Measured against the shapes
 * this server actually emits; exact byte counts are the assertion, this only
 * turns them into the number the client cares about.
 */
const BYTES_PER_TOKEN = 3.5

const BUDGET = {
  /** A full re-orientation, which is also the worst single view. */
  getViewBytes: 6_000,
  /** One decision handed back by play_action. */
  playBytes: 4_500,
  /** One wake-up. */
  waitBytes: 4_000,
  /** The island. Paid once per game and never again. */
  boardBytes: 6_000,
  /**
   * The number that actually decides whether a seat compacts, and the only one
   * that does not move with how long the game happened to run. Headroom is set
   * against how much a randomised game varies, not against the current figure:
   * putting the island back on a turn view would land near nine thousand.
   */
  bytesPerDecision: 4_000,
  /** A belt-and-braces ceiling on a whole game. */
  totalBytes: 1_200_000,
}

type TextToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }
type Sample = { tool: string; bytes: number }

const samples: Sample[] = []

const server = createRealtimeServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = (server.address() as AddressInfo).port
const baseUrl = `http://127.0.0.1:${port}`

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await response.json()).data
}

let client: Client | undefined
try {
  const host = await post('/api/rooms', { name: 'Aditya', seatsTotal: 3 })
  const code = host.credentials.code as string
  const bystander = await post(`/api/rooms/${code}/seats`, { name: 'Mara', controller: 'human' })

  client = new Client({ name: 'katan-budget-check', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`)))

  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await client!.callTool({ name: tool, arguments: args }) as TextToolResult
    const text = result.content.find((entry) => entry.type === 'text')?.text ?? ''
    samples.push({ tool, bytes: Buffer.byteLength(text, 'utf8') })
    let body: Record<string, any> = {}
    try { body = JSON.parse(text) } catch { body = { text } }
    return { body, isError: result.isError ?? false, text }
  }

  const joined = await call('join_room', { code, name: 'Atlas' })
  const playerKey = joined.body.playerKey as string
  assert.ok(playerKey, 'join_room must mint a seat key')
  const seat = joined.body.you as string

  await startRoom(code, host.credentials.token)

  // The static board, read once. Everything after this is dynamic state only.
  const board = await call('get_board', { code, playerKey })
  assert.ok(board.body.hexes?.length === 19, 'the one-time board must carry all nineteen hexes')

  const tokens = [host.credentials.token as string, bystander.credentials.token as string]

  const actorId = async () => {
    const room = await getRoomView(code, host.credentials.token as string)
    if (!room.game || room.status !== 'playing') return undefined
    const state = room.game.publicState
    return state.actingPlayerId
      ?? (state.phase === 'discard' ? state.discardQueue[0] : state.players[state.activePlayerIndex]?.id)
  }

  /** Moves whichever other seat is holding the table up. */
  const driveTable = async () => {
    for (const token of tokens) {
      const room = await getRoomView(code, token)
      if (!room.game || room.status !== 'playing') return false
      const state = room.game.publicState
      const actor = state.actingPlayerId
        ?? (state.phase === 'discard' ? state.discardQueue[0] : state.players[state.activePlayerIndex]?.id)
      if (actor !== room.viewerPlayerId) continue
      const action = chooseForTable(room.game)
      if (!action) return false
      try {
        await playRoomAction(code, token, room.game.revision, action)
      } catch {
        return false
      }
      return true
    }
    return false
  }

  let decisions = 0
  let wakeups = 0
  let view = (await call('get_view', { code, playerKey })).body

  /** A lean view must not become a leakier one. */
  const assertNoLeak = (payload: Record<string, any>) => {
    for (const player of (payload.players ?? []) as Record<string, unknown>[]) {
      if (player.id === seat) continue
      assert.equal(player.development, undefined, 'an opponent development list must never be serialized')
      assert.equal(player.resources, undefined, 'an opponent hand must never be serialized')
      assert.equal(player.hand, undefined, 'an opponent hand must never be serialized')
    }
    assert.equal(payload.seed, undefined)
    assert.equal(payload.privateRandomSeed, undefined)
    assert.equal(payload.developmentDeck, undefined, 'the undealt deck order must never be serialized')
  }

  for (let step = 0; step < 4_000; step += 1) {
    assertNoLeak(view)
    if (view.status === 'finished' || view.next === null) break

    if (view.actionRequired) {
      assert.ok((view.legalActions as unknown[])?.length, 'actionRequired must come with at least one legal action')
      const chosen = chooseFromView(view, board.body)
      assert.ok(chosen, 'a lean view must always be enough to find a playable action')
      const played = await call('play_action', { code, playerKey, expectedRevision: view.revision, action: chosen })
      assert.equal(played.isError, false, `play_action failed: ${played.text.slice(0, 200)}`)
      assert.equal(played.body.applied, true, `play_action refused a legal move: ${played.text.slice(0, 300)}`)
      // The documented loop decides again from what play_action hands back
      // rather than paying for a second read of the same position.
      view = played.body
      decisions += 1
      // Every so often, behave like a seat that lost its place and re-orients
      // from one cheap call. That path has to stay both correct and small.
      if (decisions % 12 === 0) {
        const reoriented = (await call('get_view', { code, playerKey })).body
        assert.equal(reoriented.revision, view.revision, 'a cold get_view must agree with the live position')
        assert.ok(Array.isArray(reoriented.events), 'a cold get_view must carry recent events')
        view = reoriented
      }
      continue
    }

    // Nothing to decide, so the seat sleeps the way the invite tells it to. The
    // table keeps moving underneath; the wait returns once, when this seat is
    // the one holding it up.
    const waiting = call('wait_for_event', { code, playerKey, afterUpdatedAt: view.cursor.updatedAt, afterRevision: view.revision, timeoutSeconds: 25 })
    let stuck = false
    while (!stuck) {
      const actor = await actorId()
      if (actor === undefined || actor === seat) break
      stuck = !(await driveTable())
    }
    view = (await waiting).body
    wakeups += 1
    if (stuck) break
  }

  const byTool = new Map<string, { calls: number; bytes: number; max: number }>()
  for (const sample of samples) {
    const entry = byTool.get(sample.tool) ?? { calls: 0, bytes: 0, max: 0 }
    entry.calls += 1
    entry.bytes += sample.bytes
    entry.max = Math.max(entry.max, sample.bytes)
    byTool.set(sample.tool, entry)
  }
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0)
  const rows = [...byTool.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  const est = (bytes: number) => Math.round(bytes / BYTES_PER_TOKEN)

  if (process.env.KATAN_BUDGET_REPORT) {
    const pad = (value: string | number, width: number) => String(value).padStart(width)
    console.log(`\nseat ${seat}, ${decisions} decisions, ${wakeups} wake-ups, ${samples.length} tool calls`)
    console.log('tool             calls        bytes     mean      max    ~tokens')
    for (const [tool, entry] of rows) {
      console.log(`${tool.padEnd(16)}${pad(entry.calls, 6)}${pad(entry.bytes, 13)}${pad(Math.round(entry.bytes / entry.calls), 9)}${pad(entry.max, 9)}${pad(est(entry.bytes), 11)}`)
    }
    console.log(`${'TOTAL'.padEnd(16)}${pad(samples.length, 6)}${pad(totalBytes, 13)}${pad('', 9)}${pad('', 9)}${pad(est(totalBytes), 11)}\n`)
  }

  const worst = (tool: string) => byTool.get(tool)?.max ?? 0
  const perDecision = Math.round(totalBytes / decisions)
  const over = (label: string, actual: number, budget: number) =>
    assert.ok(actual <= budget, `${label} is ${actual} bytes (~${est(actual)} tokens), over the ${budget} budget`)

  assert.equal(view.status, 'finished', 'the seat must reach the end of a real game without stalling')
  assert.ok(decisions > 20, `the seat should have played a real game, only ${decisions} decisions`)
  assert.ok(byTool.get('get_view')!.calls > 5, 'the re-orientation path has to be exercised')
  over('the worst get_view', worst('get_view'), BUDGET.getViewBytes)
  over('the worst play_action', worst('play_action'), BUDGET.playBytes)
  over('the worst wait_for_event', worst('wait_for_event'), BUDGET.waitBytes)
  over('get_board', worst('get_board'), BUDGET.boardBytes)
  over('one seat decision', perDecision, BUDGET.bytesPerDecision)
  over('one seat whole game', totalBytes, BUDGET.totalBytes)

  console.log(`mcp budget check passed: ${samples.length} calls, ${totalBytes} bytes (~${est(totalBytes)} tokens) for a full game seat over ${decisions} decisions, ${perDecision} bytes each, peak view ${worst('get_view')} bytes`)
} finally {
  await client?.close().catch(() => {})
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeRoomStore()
}
