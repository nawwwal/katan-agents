import type { RoomView } from '../src/game/room.js'
import type { Board, GameAction, GameEvent } from '../src/game/types.js'

type AgentViewOptions = {
  afterRevision?: number
  timedOut?: boolean
  connected?: boolean
}

/**
 * How many recent public events a view carries when the caller does not ask for
 * a window. Enough for a seat that missed a couple of turns, small enough that
 * a stale cursor cannot re-send the whole match.
 */
const DEFAULT_EVENT_WINDOW = 8
/** The ceiling, even when a caller asks for everything since revision zero. */
const MAX_EVENTS = 25

const currentActorId = (room: RoomView) => {
  const state = room.game?.publicState
  if (!state) return undefined
  return state.actingPlayerId
    ?? (state.phase === 'discard' ? state.discardQueue[0] : state.players[state.activePlayerIndex]?.id)
}

/** True when this seat, and no other, is the one holding the game up. */
export const seatMustAct = (room: RoomView) => Boolean(
  room.game && currentActorId(room) === room.game.playerId && room.game.legalActions.length > 0,
)

export const gameOver = (room: RoomView) => room.status === 'finished' || room.game?.phase === 'game-over'

/**
 * Action families whose members differ in exactly one field. Fifty-four legal
 * settlement corners are fifty-four near-identical JSON objects; collapsing them
 * into one object with a list of choices says the same thing for a fifth of the
 * bytes. The field name is preserved, so rebuilding a single action is picking
 * one value out of the list.
 */
const CHOICE_FIELD: Record<string, string> = {
  'place-settlement': 'vertexId',
  'build-settlement': 'vertexId',
  'build-city': 'vertexId',
  'place-road': 'edgeId',
  'build-road': 'edgeId',
  'move-robber': 'hexId',
  'steal-from': 'playerId',
  'maritime-trade': 'receive',
}

export const choiceFieldFor = (type: unknown) => typeof type === 'string' ? CHOICE_FIELD[type] : undefined

const TRADE_TYPES = new Set(['offer-trade', 'counter-trade'])

export const TRADE_TEMPLATE = 'One worked example per partner is listed above. offer-trade and counter-trade take any bundle you can pay for: give and receive are resource maps, both non-empty, with no resource on both sides. Copy the example and change the amounts.'

/**
 * The engine enumerates every one-card-for-one-card offer to every opponent,
 * which is forty near-identical objects and three quarters of an action-phase
 * view. It is also a misleading menu, because the server accepts any bundle a
 * seat can pay for, not just the singles it happens to list. One real example
 * per partner plus the rule says strictly more for a twentieth of the bytes.
 */
const collapseTradeOffers = (actions: GameAction[]) => {
  const kept: GameAction[] = []
  const seen = new Set<string>()
  let collapsed = 0
  for (const action of actions) {
    if (!TRADE_TYPES.has(action.type)) {
      kept.push(action)
      continue
    }
    const { trade } = action as Extract<GameAction, { type: 'offer-trade' }>
    const key = `${action.type}:${trade.toPlayerId}`
    if (seen.has(key)) {
      collapsed += 1
      continue
    }
    seen.add(key)
    kept.push(action)
  }
  return { kept, collapsed }
}

export const groupLegalActions = (actions: GameAction[]) => {
  const ordered: Record<string, unknown>[] = []
  const groups = new Map<string, Record<string, unknown>>()
  for (const action of actions) {
    const field = CHOICE_FIELD[action.type]
    const value = field ? (action as Record<string, unknown>)[field] : undefined
    if (!field || typeof value !== 'string') {
      ordered.push(action as unknown as Record<string, unknown>)
      continue
    }
    const rest = Object.entries(action).filter(([key]) => key !== field)
    const signature = JSON.stringify(rest)
    let group = groups.get(signature)
    if (!group) {
      group = { ...Object.fromEntries(rest), [field]: [] as string[] }
      groups.set(signature, group)
      ordered.push(group)
    }
    ;(group[field] as string[]).push(value)
  }
  // A family of one is cheaper, and less to explain, as a plain action.
  for (const group of groups.values()) {
    for (const [key, value] of Object.entries(group)) {
      if (Array.isArray(value) && value.length === 1) group[key] = value[0]
    }
  }
  return ordered
}

/** Drops the event id. Nothing an agent does needs it; the revision orders the log. */
const compactEvent = ({ id: _id, ...event }: GameEvent) => event

const listed = (values: string[]) => values.join(' ')
const when = <T>(include: boolean, value: T) => include ? value : undefined

/**
 * The island, exactly once. Nineteen hexes, fifty-four corners, seventy-two road
 * slots and the harbours never change after the host starts, so re-sending them
 * every turn was the single largest waste in the protocol. Render coordinates go,
 * and so does every adjacency that is the inverse of another: hex-to-corner is
 * recovered from vertexHexes, corner-to-road from edges.
 */
export const toAgentBoard = (board: Board) => ({
  legend: 'Static for the whole game. Read once and keep it. q,r are axial hex coordinates. vertexHexes maps a corner to the hexes touching it. edges maps a road slot to the two corners it joins. harbors are keyed by the port id that shows up in a player ports list.',
  hexes: board.hexes.map((hex) => ({
    id: hex.id,
    q: hex.q,
    r: hex.r,
    terrain: hex.terrain,
    ...(hex.number === undefined ? {} : { number: hex.number }),
  })),
  vertexHexes: Object.fromEntries(Object.values(board.vertices).map((vertex) => [vertex.id, listed(vertex.hexes)])),
  edges: Object.fromEntries(Object.values(board.edges).map((edge) => [edge.id, listed(edge.vertices)])),
  harbors: Object.fromEntries(board.harbors.map((harbor) => [harbor.id, {
    ratio: harbor.ratio,
    ...(harbor.resource ? { resource: harbor.resource } : {}),
    edgeId: harbor.edgeId,
    vertices: listed(Object.values(board.vertices).filter((vertex) => vertex.harborId === harbor.id).map((vertex) => vertex.id)),
  }])),
})

/**
 * Everything that changes, and nothing that does not. The island lives in
 * get_board, the seat roster in join_room and get_board, and the engine's two
 * ownership maps are dropped because every player already carries the same
 * roads, settlements and cities.
 */
export const toAgentView = (room: RoomView, options: AgentViewOptions = {}) => {
  const base = {
    status: room.status,
    you: room.viewerPlayerId,
    actionRequired: false,
    // Only a wait carries this, and a wait always carries it: "nothing happened"
    // and "something happened" have to be told apart without inference.
    ...(options.timedOut === undefined ? {} : { timedOut: options.timedOut }),
    ...(options.connected === undefined ? {} : { connected: options.connected }),
    cursor: { updatedAt: room.updatedAt, revision: room.game?.revision ?? 0 },
  }

  if (!room.game) {
    return {
      ...base,
      seats: room.seats.map((seat) => ({ id: seat.id, name: seat.name })),
      seatsTotal: room.seatsTotal,
      next: 'wait_for_event',
      note: 'The host has not started the game yet. Wait for it; do not join again.',
    }
  }

  const view = room.game
  const state = view.publicState
  const actorId = currentActorId(room)
  const isYourTurn = actorId === view.playerId
  const actionRequired = isYourTurn && view.legalActions.length > 0
  const finished = room.status === 'finished' || view.phase === 'game-over'

  const requested = options.afterRevision ?? 0
  const window = requested > 0 ? requested : Math.max(0, view.revision - DEFAULT_EVENT_WINDOW)
  const matching = state.events.filter((event) => event.revision > window)
  const events = matching.slice(-MAX_EVENTS)
  const earliest = state.events[0]?.revision ?? view.revision
  const setup = view.phase === 'setup-settlement' || view.phase === 'setup-road'
  const discarding = Object.keys(state.discardRemaining).length > 0
  const trades = collapseTradeOffers(view.legalActions)

  return {
    ...base,
    revision: view.revision,
    phase: view.phase,
    currentActorId: actorId,
    isYourTurn,
    actionRequired,
    robberHexId: state.board.robberHexId,
    hand: view.privateState.resources,
    development: view.privateState.development,
    ...when(view.privateState.boughtDevelopment.length > 0, { boughtDevelopment: view.privateState.boughtDevelopment }),
    bank: state.bank,
    developmentDeckCount: state.developmentDeckCount,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.publicScore,
      cards: player.resourceCount,
      devCards: player.developmentCount,
      ...when(player.playedKnights > 0, { knights: player.playedKnights }),
      ...when(player.settlements.length > 0, { settlements: listed(player.settlements) }),
      ...when(player.cities.length > 0, { cities: listed(player.cities) }),
      ...when(player.roads.length > 0, { roads: listed(player.roads) }),
      ...when(player.ports.length > 0, { ports: listed(player.ports) }),
    })),
    ...when(state.lastRoll !== undefined, { lastRoll: state.lastRoll }),
    ...when(state.longestRoad !== undefined, { longestRoad: state.longestRoad }),
    ...when(state.largestArmy !== undefined, { largestArmy: state.largestArmy }),
    ...when(state.pendingTrade !== undefined, { pendingTrade: state.pendingTrade }),
    ...when(state.pendingRoads > 0, { pendingRoads: state.pendingRoads }),
    ...when(state.playedDevelopmentThisTurn, { playedDevelopmentThisTurn: true }),
    ...when(discarding, { discardRemaining: state.discardRemaining, discardQueue: state.discardQueue }),
    ...when(state.robberVictims.length > 0, { robberVictims: state.robberVictims }),
    ...when(setup, {
      setup: {
        round: state.setupRound,
        step: state.setupStep,
        order: state.setupOrder,
        ...(state.pendingSetupVertexId ? { pendingVertexId: state.pendingSetupVertexId } : {}),
      },
    }),
    ...when(state.winnerId !== undefined, { winnerId: state.winnerId }),
    events: events.map(compactEvent),
    ...when(matching.length > events.length || window > 0 && window < earliest - 1, { eventsTruncated: true }),
    legalActions: groupLegalActions(trades.kept),
    ...when(trades.collapsed > 0, { tradeTemplate: TRADE_TEMPLATE }),
    ...(finished
      ? { next: null }
      : actionRequired
        ? { next: 'play_action', expectedRevision: view.revision }
        : { next: 'wait_for_event', afterUpdatedAt: room.updatedAt, afterRevision: view.revision }),
  }
}

/**
 * Compact JSON. Pretty printing doubled the size of every response an agent
 * read, and no model needs the indentation.
 */
export const textResult = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
})
