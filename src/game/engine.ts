import { createBoard, seededRandom, shuffle } from './board.js'
import {
  DEVELOPMENT_NAME,
  RESOURCES,
  defaultBoardOptions,
  emptyResources,
  type CreateGameOptions,
  type DevelopmentCard,
  type GameAction,
  type GameEvent,
  type GameState,
  type Player,
  type PlayerColor,
  type PlayerView,
  type Resource,
  type Resources,
  type TradeOffer,
  type TradeOutcome,
} from './types.js'

const COLORS: PlayerColor[] = ['coral', 'blue', 'amber', 'ivory']

/**
 * Seat colours in seat order. The lobby needs these before a game exists, so they
 * live here rather than being re-listed anywhere else.
 */
export const PLAYER_COLORS: readonly PlayerColor[] = COLORS
export const playerColorForSeat = (index: number): PlayerColor => COLORS[index % COLORS.length]
const NAMES = ['You', 'Marlow', 'Ansel', 'Solveig']
const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  development: { ore: 1, wool: 1, grain: 1 },
} satisfies Record<string, Partial<Resources>>

type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; code: 'stale' | 'illegal'; message: string }

const totalResources = (resources: Resources) => RESOURCES.reduce((total, resource) => total + resources[resource], 0)
const hasResources = (player: Player, cost: Partial<Resources>) => RESOURCES.every((resource) => player.resources[resource] >= (cost[resource] ?? 0))
const validResourceMap = (resources: Partial<Resources>) => Object.entries(resources).every(([resource, amount]) =>
  RESOURCES.includes(resource as Resource) && Number.isSafeInteger(amount) && (amount ?? -1) >= 0,
)

const pay = (state: GameState, player: Player, cost: Partial<Resources>) => {
  for (const resource of RESOURCES) {
    const amount = cost[resource] ?? 0
    player.resources[resource] -= amount
    state.bank[resource] += amount
  }
}

const currentPlayer = (state: GameState) => state.players[state.activePlayerIndex]
export const currentActorId = (state: Pick<GameState, 'actingPlayerId' | 'activePlayerIndex' | 'players'>) => state.actingPlayerId ?? state.players[state.activePlayerIndex].id

const playerById = (state: GameState, playerId: string) => state.players.find((player) => player.id === playerId)

const createDevelopmentDeck = (random: () => number): DevelopmentCard[] => shuffle([
  ...Array<DevelopmentCard>(14).fill('knight'),
  ...Array<DevelopmentCard>(2).fill('road-building'),
  ...Array<DevelopmentCard>(2).fill('year-of-plenty'),
  ...Array<DevelopmentCard>(2).fill('monopoly'),
  ...Array<DevelopmentCard>(5).fill('victory-point'),
], random)

const canPlaceSettlement = (state: GameState, vertexId: string, playerId: string, setup = false) => {
  const vertex = state.board.vertices[vertexId]
  if (!vertex || state.buildings[vertexId]) return false
  if (vertex.neighbors.some((neighborId) => state.buildings[neighborId])) return false
  return setup || vertex.edges.some((edgeId) => state.roadOwners[edgeId] === playerId)
}

const canPlaceRoad = (state: GameState, edgeId: string, playerId: string, setupVertexId?: string) => {
  const edge = state.board.edges[edgeId]
  if (!edge || state.roadOwners[edgeId]) return false
  if (setupVertexId) return edge.vertices.includes(setupVertexId)
  return edge.vertices.some((vertexId) => {
    const building = state.buildings[vertexId]
    if (building) return building.playerId === playerId
    return state.board.vertices[vertexId].edges.some((incident) => state.roadOwners[incident] === playerId)
  })
}

const playableDevelopment = (player: Player, card: Exclude<DevelopmentCard, 'victory-point'>) => {
  const owned = player.development.filter((candidate) => candidate === card).length
  const fresh = player.boughtDevelopment.filter((candidate) => candidate === card).length
  return owned > fresh
}

const tradeRatios = (state: GameState, player: Player, resource: Resource): Array<2 | 3 | 4> => {
  const ports = player.ports.map((id) => state.board.harbors.find((harbor) => harbor.id === id)).filter(Boolean)
  const available = new Set<2 | 3 | 4>([4])
  if (ports.some((port) => port?.ratio === 2 && port.resource === resource)) available.add(2)
  if (ports.some((port) => port?.ratio === 3)) available.add(3)
  return ([2, 3, 4] as const).filter((ratio) => available.has(ratio))
}

const canSupplyYearOfPlenty = (state: GameState) => RESOURCES.reduce((total, resource) => total + state.bank[resource], 0) >= 2

/* ------------------------------------------------------------------ trade -- */

const resourceTotalOf = (resources: Partial<Resources>) => RESOURCES.reduce((total, resource) => total + (resources[resource] ?? 0), 0)
const canCover = (player: Player | undefined, bundle: Partial<Resources>) =>
  Boolean(player) && RESOURCES.every((resource) => player!.resources[resource] >= (bundle[resource] ?? 0))
const openRecipients = (offer: TradeOffer) => offer.toPlayerIds.filter((playerId) => !offer.declinedBy.includes(playerId))

/**
 * The offer on the table, reading a room that was stored mid-negotiation before
 * offers carried an id. Without this a reconnect into that room finds a
 * `trade-response` phase with nothing to respond to, and the seat has no move.
 */
const currentOffer = (state: GameState): TradeOffer | undefined => {
  if (state.tradeOffer) return state.tradeOffer
  const trade = state.pendingTrade
  if (state.phase !== 'trade-response' || !trade) return undefined
  return {
    id: 0,
    fromPlayerId: trade.fromPlayerId,
    toPlayerIds: [trade.toPlayerId],
    give: structuredClone(trade.give),
    receive: structuredClone(trade.receive),
    declinedBy: [],
    openedAtRevision: state.revision,
  }
}
/** Ids are handed out from the game, so a room stored before offers existed still works. */
const takeTradeId = (state: GameState) => {
  const id = Number.isSafeInteger(state.nextTradeId) && state.nextTradeId > 0 ? state.nextTradeId : 1
  state.nextTradeId = id + 1
  return id
}

/**
 * Keeps `pendingTrade` pointing at whoever is on the clock. Every consumer written
 * before broadcast offers reads that field, so it has to stay true.
 */
const projectPendingTrade = (state: GameState) => {
  const offer = state.tradeOffer
  const nominated = offer && openRecipients(offer)[0]
  state.pendingTrade = offer && nominated
    ? { fromPlayerId: offer.fromPlayerId, toPlayerId: nominated, give: structuredClone(offer.give), receive: structuredClone(offer.receive) }
    : undefined
}

const openOffer = (state: GameState, fromPlayerId: string, toPlayerIds: string[], give: Partial<Resources>, receive: Partial<Resources>) => {
  state.tradeOffer = {
    id: takeTradeId(state),
    fromPlayerId,
    toPlayerIds: [...toPlayerIds],
    give: structuredClone(give),
    receive: structuredClone(receive),
    declinedBy: [],
    openedAtRevision: state.revision + 1,
  }
  // `tradeResolution` is left alone on purpose. It always describes an older offer
  // than `tradeOffer`, so the two never disagree and a client can match either by id.
  state.phase = 'trade-response'
  state.actingPlayerId = toPlayerIds[0]
  projectPendingTrade(state)
}

/** Ends the offer, records how, and hands the turn back to whoever owns it. */
const closeOffer = (state: GameState, outcome: TradeOutcome, acceptedBy?: string) => {
  const offer = state.tradeOffer
  if (!offer) return
  state.tradeResolution = {
    id: offer.id,
    outcome,
    fromPlayerId: offer.fromPlayerId,
    toPlayerIds: [...offer.toPlayerIds],
    give: structuredClone(offer.give),
    receive: structuredClone(offer.receive),
    declinedBy: [...offer.declinedBy],
    acceptedBy,
    revision: state.revision + 1,
  }
  state.tradeOffer = undefined
  state.pendingTrade = undefined
  state.phase = 'action'
  state.actingPlayerId = currentPlayer(state).id
}

/**
 * An offer nobody can take is not an offer. If the offerer stopped holding what
 * they promised, or every seat has refused, the table clears itself rather than
 * leaving a dead card in front of everyone.
 */
const settleOffer = (state: GameState, events: GameEvent[]) => {
  const offer = state.tradeOffer
  if (!offer) return
  const offerer = playerById(state, offer.fromPlayerId)
  if (!canCover(offerer, offer.give)) {
    closeOffer(state, 'invalidated')
    events.push(addEvent(state, 'trade-invalidated', `${offerer?.name ?? 'The offerer'} no longer holds that offer, so it came off the table.`, offer.fromPlayerId))
    return
  }
  const open = openRecipients(offer)
  if (!open.length) {
    const noTakers = everyRivalRefused(state, offer)
    closeOffer(state, noTakers ? 'no-takers' : 'declined')
    if (noTakers) events.push(addEvent(state, 'trade-no-takers', `Nobody took ${offerer?.name ?? 'that player'}'s offer.`, offer.fromPlayerId))
    return
  }
  if (!open.includes(currentActorId(state))) state.actingPlayerId = open[0]
  projectPendingTrade(state)
}

/** True when nobody else at the table is left to ask about this exact bundle. */
const everyRivalRefused = (state: GameState, offer: TradeOffer) =>
  state.players.every((player) => player.id === offer.fromPlayerId || offer.declinedBy.includes(player.id))

const defaultDiscard = (player: Player, amount: number): Partial<Resources> => {
  const result: Partial<Resources> = {}
  const ordered = [...RESOURCES].sort((a, b) => player.resources[b] - player.resources[a])
  let remaining = amount
  for (const resource of ordered) {
    const take = Math.min(player.resources[resource], remaining)
    if (take) result[resource] = take
    remaining -= take
  }
  return result
}

/**
 * What a seat may say about the offer on the table.
 *
 * Every open recipient gets the explicit `accept-trade` / `decline-trade` pair, so
 * the engine is already right when several seats answer at once. The seat that is
 * on the clock also gets the older `respond-trade` and `counter-trade` shapes, so
 * clients written before broadcast offers keep working unchanged.
 */
const tradeResponseActions = (state: GameState, offer: TradeOffer, playerId: string): GameAction[] => {
  const player = playerById(state, playerId)
  if (!player) return []
  if (playerId === offer.fromPlayerId) return [{ type: 'withdraw-trade', offerId: offer.id, playerId }]
  if (!offer.toPlayerIds.includes(playerId) || offer.declinedBy.includes(playerId)) return []
  const initiator = playerById(state, offer.fromPlayerId)
  const canAccept = canCover(player, offer.receive) && canCover(initiator, offer.give)
  const onTheClock = currentActorId(state) === playerId
  const actions: GameAction[] = []
  if (onTheClock) {
    if (canAccept) actions.push({ type: 'respond-trade', accept: true })
    actions.push({ type: 'respond-trade', accept: false })
  }
  if (canAccept) actions.push({ type: 'accept-trade', offerId: offer.id, playerId })
  actions.push({ type: 'decline-trade', offerId: offer.id, playerId })
  if (onTheClock && initiator) {
    for (const give of RESOURCES) {
      if (player.resources[give] < 1) continue
      for (const receive of RESOURCES) {
        if (receive !== give) actions.push({ type: 'counter-trade', trade: { fromPlayerId: player.id, toPlayerId: initiator.id, give: { [give]: 1 }, receive: { [receive]: 1 } } })
      }
    }
  }
  return actions
}

export const legalActionsForPlayer = (state: GameState, playerId: string): GameAction[] => {
  if (state.phase === 'game-over') return [{ type: 'restart', seed: state.seed + 1 }]
  // An open offer is the one place several seats have something to say at once, so
  // it is answered before the single-actor gate below.
  const offerOnTable = currentOffer(state)
  if (state.phase === 'trade-response' && offerOnTable) return tradeResponseActions(state, offerOnTable, playerId)
  if (currentActorId(state) !== playerId) return []
  const player = playerById(state, playerId)
  if (!player) return []

  if (state.phase === 'setup-settlement') {
    return Object.keys(state.board.vertices)
      .filter((vertexId) => canPlaceSettlement(state, vertexId, playerId, true))
      .map((vertexId) => ({ type: 'place-settlement', vertexId }))
  }
  if (state.phase === 'setup-road') {
    return Object.keys(state.board.edges)
      .filter((edgeId) => canPlaceRoad(state, edgeId, playerId, state.pendingSetupVertexId))
      .map((edgeId) => ({ type: 'place-road', edgeId }))
  }
  if (state.phase === 'discard') {
    const amount = state.discardRemaining[playerId] ?? 0
    return amount ? [{ type: 'discard', resources: defaultDiscard(player, amount) }] : []
  }
  if (state.phase === 'move-robber') {
    return state.board.hexes.filter((hex) => hex.id !== state.board.robberHexId).map((hex) => ({ type: 'move-robber', hexId: hex.id }))
  }
  if (state.phase === 'choose-victim') return state.robberVictims.map((victimId) => ({ type: 'steal-from', playerId: victimId }))
  if (state.phase === 'year-of-plenty') {
    const actions: GameAction[] = []
    for (let a = 0; a < RESOURCES.length; a += 1) {
      for (let b = a; b < RESOURCES.length; b += 1) {
        const first = RESOURCES[a]
        const second = RESOURCES[b]
        const required = first === second ? 2 : 1
        if (state.bank[first] >= required && state.bank[second] >= 1) actions.push({ type: 'choose-year-of-plenty', resources: [first, second] })
      }
    }
    return actions
  }
  if (state.phase === 'monopoly') return RESOURCES.map((resource) => ({ type: 'choose-monopoly', resource }))
  if (state.phase === 'road-building') {
    const roads = Object.keys(state.board.edges)
      .filter((edgeId) => canPlaceRoad(state, edgeId, playerId))
      .map((edgeId): GameAction => ({ type: 'build-road', edgeId, free: true }))
    const canFinish = state.pendingRoads <= 0 || !roads.length || player.roads.length >= 15
    return [...roads, ...(canFinish ? [{ type: 'finish-road-building' } as const] : [])]
  }

  const actions: GameAction[] = []
  if (state.phase === 'pre-roll') actions.push({ type: 'roll-dice' })
  if (!state.playedDevelopmentThisTurn) {
    for (const card of ['knight', 'road-building', 'year-of-plenty', 'monopoly'] as const) {
      if (playableDevelopment(player, card) && (card !== 'year-of-plenty' || canSupplyYearOfPlenty(state))) actions.push({ type: 'play-development', card })
    }
  }
  if (state.phase !== 'action') return actions

  if (player.roads.length < 15 && hasResources(player, COSTS.road)) {
    for (const edgeId of Object.keys(state.board.edges)) if (canPlaceRoad(state, edgeId, playerId)) actions.push({ type: 'build-road', edgeId })
  }
  if (player.settlements.length < 5 && hasResources(player, COSTS.settlement)) {
    for (const vertexId of Object.keys(state.board.vertices)) if (canPlaceSettlement(state, vertexId, playerId)) actions.push({ type: 'build-settlement', vertexId })
  }
  if (player.cities.length < 4 && hasResources(player, COSTS.city)) {
    for (const vertexId of player.settlements) actions.push({ type: 'build-city', vertexId })
  }
  if (state.developmentDeck.length && hasResources(player, COSTS.development)) actions.push({ type: 'buy-development' })
  for (const give of RESOURCES) {
    for (const ratio of tradeRatios(state, player, give)) {
      if (player.resources[give] < ratio) continue
      for (const receive of RESOURCES) {
        if (receive !== give && state.bank[receive] > 0) actions.push({ type: 'maritime-trade', give, receive, ratio })
      }
    }
  }
  for (const other of state.players) {
    if (other.id === player.id) continue
    for (const give of RESOURCES) {
      if (player.resources[give] < 1) continue
      for (const receive of RESOURCES) {
        if (receive !== give) actions.push({ type: 'offer-trade', trade: { fromPlayerId: player.id, toPlayerId: other.id, give: { [give]: 1 }, receive: { [receive]: 1 } } })
      }
    }
  }
  for (const give of RESOURCES) {
    if (player.resources[give] < 1) continue
    for (const receive of RESOURCES) {
      if (receive !== give) actions.push({ type: 'broadcast-trade', trade: { fromPlayerId: player.id, give: { [give]: 1 }, receive: { [receive]: 1 } } })
    }
  }
  actions.push({ type: 'end-turn' })
  return actions
}

const addEvent = (state: GameState, type: string, message: string, playerId?: string, publicData?: GameEvent['publicData'], trade?: GameEvent['trade']) => {
  const revision = state.revision + 1
  const sequence = state.events.filter((event) => event.revision === revision).length
  const event = { id: `ev-${revision}-${sequence}`, revision, type, message, playerId, publicData, trade: trade ? structuredClone(trade) : undefined }
  state.events.push(event)
  state.events = state.events.slice(-80)
  return event
}

const addPort = (state: GameState, player: Player, vertexId: string) => {
  const harborId = state.board.vertices[vertexId].harborId
  if (harborId && !player.ports.includes(harborId)) player.ports.push(harborId)
}

const removeCard = (player: Player, card: DevelopmentCard) => {
  const index = player.development.indexOf(card)
  if (index >= 0) player.development.splice(index, 1)
}

const longestRoadForPlayer = (state: GameState, playerId: string) => {
  const owned = new Set(Object.entries(state.roadOwners).filter(([, owner]) => owner === playerId).map(([edgeId]) => edgeId))
  let best = 0
  const walk = (vertexId: string, used: Set<string>, length: number) => {
    best = Math.max(best, length)
    const blockingBuilding = state.buildings[vertexId]
    if (length > 0 && blockingBuilding && blockingBuilding.playerId !== playerId) return
    for (const edgeId of state.board.vertices[vertexId].edges) {
      if (!owned.has(edgeId) || used.has(edgeId)) continue
      const nextUsed = new Set(used)
      nextUsed.add(edgeId)
      const edge = state.board.edges[edgeId]
      const next = edge.vertices[0] === vertexId ? edge.vertices[1] : edge.vertices[0]
      walk(next, nextUsed, length + 1)
    }
  }
  for (const vertexId of Object.keys(state.board.vertices)) walk(vertexId, new Set(), 0)
  return best
}

const updateAwards = (state: GameState) => {
  const roads = state.players.map((player) => ({ playerId: player.id, length: longestRoadForPlayer(state, player.id) }))
  const roadMax = Math.max(...roads.map((entry) => entry.length))
  const roadLeaders = roads.filter((entry) => entry.length === roadMax && entry.length >= 5)
  if (state.longestRoad && roadLeaders.some((entry) => entry.playerId === state.longestRoad?.playerId)) {
    state.longestRoad = { playerId: state.longestRoad.playerId, length: roadMax }
  } else {
    state.longestRoad = roadLeaders.length === 1 ? roadLeaders[0] : undefined
  }

  const armies = state.players.map((player) => ({ playerId: player.id, size: player.playedKnights }))
  const armyMax = Math.max(...armies.map((entry) => entry.size))
  const armyLeaders = armies.filter((entry) => entry.size === armyMax && entry.size >= 3)
  if (state.largestArmy && armyLeaders.some((entry) => entry.playerId === state.largestArmy?.playerId)) {
    state.largestArmy = { playerId: state.largestArmy.playerId, size: armyMax }
  } else {
    state.largestArmy = armyLeaders.length === 1 ? armyLeaders[0] : undefined
  }
}

export const scorePlayer = (state: GameState, playerId: string) => {
  const player = playerById(state, playerId)
  if (!player) return 0
  return player.settlements.length
    + player.cities.length * 2
    + player.development.filter((card) => card === 'victory-point').length
    + (state.longestRoad?.playerId === playerId ? 2 : 0)
    + (state.largestArmy?.playerId === playerId ? 2 : 0)
}

export const publicScorePlayer = (state: GameState, playerId: string) => {
  const player = playerById(state, playerId)
  if (!player) return 0
  const revealedVictoryPoints = state.phase === 'game-over'
    ? player.development.filter((card) => card === 'victory-point').length
    : 0
  return player.settlements.length
    + player.cities.length * 2
    + revealedVictoryPoints
    + (state.longestRoad?.playerId === playerId ? 2 : 0)
    + (state.largestArmy?.playerId === playerId ? 2 : 0)
}

const finish = (state: GameState, newEvents: GameEvent[]): ApplyResult => {
  settleOffer(state, newEvents)
  updateAwards(state)
  const active = currentPlayer(state)
  if (!state.winnerId && !state.phase.startsWith('setup') && scorePlayer(state, active.id) >= 10) {
    state.winnerId = active.id
    state.phase = 'game-over'
    state.actingPlayerId = active.id
    newEvents.push(addEvent(state, 'victory', `${active.name} settled the island with ${scorePlayer(state, active.id)} points.`, active.id))
  }
  state.revision += 1
  state.legalActions = legalActionsForPlayer(state, currentActorId(state))
  return { ok: true, state, events: newEvents }
}

const fail = (message: string): ApplyResult => ({ ok: false, code: 'illegal', message })

const giveStartingResources = (state: GameState, player: Player, vertexId: string) => {
  for (const hexId of state.board.vertices[vertexId].hexes) {
    const hex = state.board.hexes.find((tile) => tile.id === hexId)
    if (!hex || hex.terrain === 'desert' || state.bank[hex.terrain] === 0) continue
    state.bank[hex.terrain] -= 1
    player.resources[hex.terrain] += 1
  }
}

const produce = (state: GameState, roll: number) => {
  const claims = new Map<Resource, Map<string, number>>()
  for (const resource of RESOURCES) claims.set(resource, new Map())
  for (const hex of state.board.hexes) {
    if (hex.number !== roll || hex.id === state.board.robberHexId || hex.terrain === 'desert') continue
    for (const vertexId of hex.vertices) {
      const building = state.buildings[vertexId]
      if (!building) continue
      const resourceClaims = claims.get(hex.terrain)
      if (!resourceClaims) continue
      resourceClaims.set(building.playerId, (resourceClaims.get(building.playerId) ?? 0) + (building.type === 'city' ? 2 : 1))
    }
  }
  for (const resource of RESOURCES) {
    const resourceClaims = claims.get(resource) ?? new Map()
    const total = [...resourceClaims.values()].reduce((sum, amount) => sum + amount, 0)
    if (!total) continue
    if (total <= state.bank[resource]) {
      for (const [playerId, amount] of resourceClaims) {
        const player = playerById(state, playerId)
        if (player) player.resources[resource] += amount
      }
      state.bank[resource] -= total
    } else if (resourceClaims.size === 1) {
      const [[playerId]] = resourceClaims
      const player = playerById(state, playerId)
      if (player) player.resources[resource] += state.bank[resource]
      state.bank[resource] = 0
    }
  }
}

const beginRobber = (state: GameState, discard: boolean, events?: GameEvent[]) => {
  state.robberVictims = []
  if (!discard) {
    state.phase = 'move-robber'
    state.actingPlayerId = currentPlayer(state).id
    return
  }
  state.discardRemaining = {}
  state.discardQueue = []
  for (const player of state.players) {
    const amount = totalResources(player.resources) > 7 ? Math.floor(totalResources(player.resources) / 2) : 0
    if (amount) {
      state.discardRemaining[player.id] = amount
      state.discardQueue.push(player.id)
    }
  }
  if (state.discardQueue.length) {
    state.phase = 'discard'
    state.actingPlayerId = state.discardQueue[0]
    // Said once for the roll, not once per player. Without it the log jumps from
    // the seven straight to a stack of discards and reads like a robber penalty.
    events?.push(addEvent(state, 'hand-limit', 'A seven. Every hand above seven discards half.'))
  } else {
    state.phase = 'move-robber'
    state.actingPlayerId = currentPlayer(state).id
  }
}

const resumeTurnPhase = (state: GameState) => {
  state.phase = state.lastRoll ? 'action' : 'pre-roll'
}

const pickStartingIndex = (random: () => number, playerCount: number) => {
  let contenders = Array.from({ length: playerCount }, (_, index) => index)
  while (contenders.length > 1) {
    const rolls = contenders.map((index) => ({ index, roll: 2 + Math.floor(random() * 6) + Math.floor(random() * 6) }))
    const highest = Math.max(...rolls.map(({ roll }) => roll))
    contenders = rolls.filter(({ roll }) => roll === highest).map(({ index }) => index)
  }
  return contenders[0]
}

const secureRandomSeed = () => {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return values[0]
}

export const createGame = (options: CreateGameOptions = {}): GameState => {
  const seed = options.seed ?? Math.floor(Date.now() / 1000)
  const boardOptions = options.boardOptions ?? defaultBoardOptions()
  const privateRandomSeed = options.privateRandomSeed ?? secureRandomSeed()
  const controllers = (options.controllers ?? ['human', 'agent', 'agent']).slice(0, 4)
  if (controllers.length < 3) throw new Error('Base game requires 3 or 4 players')
  const setupRandom = seededRandom(seed ^ 0xa5a5a5a5)
  const privateRandom = options.random ?? seededRandom(privateRandomSeed ^ 0x6d2b79f5)
  const players: Player[] = controllers.map((controller, index) => ({
    id: `p${index}`,
    name: options.names?.[index] ?? NAMES[index],
    color: COLORS[index],
    controller,
    resources: emptyResources(),
    development: [],
    boughtDevelopment: [],
    playedKnights: 0,
    roads: [],
    settlements: [],
    cities: [],
    ports: [],
  }))
  const startingIndex = pickStartingIndex(setupRandom, players.length)
  const firstRound = players.map((_, offset) => (startingIndex + offset) % players.length)
  const setupOrder = [...firstRound, ...[...firstRound].reverse()]
  const state: GameState = {
    version: 1,
    seed,
    privateRandomSeed,
    revision: 0,
    board: createBoard(seed, boardOptions),
    players,
    activePlayerIndex: setupOrder[0],
    phase: 'setup-settlement',
    setupRound: 1,
    setupOrder,
    setupStep: 0,
    discardQueue: [],
    bank: { brick: 19, lumber: 19, ore: 19, grain: 19, wool: 19 },
    roadOwners: {},
    buildings: {},
    developmentDeck: createDevelopmentDeck(privateRandom),
    discardRemaining: {},
    robberVictims: [],
    pendingRoads: 0,
    playedDevelopmentThisTurn: false,
    nextTradeId: 1,
    events: [{ id: 'ev-0-0', revision: 0, type: 'start', message: `${players[startingIndex].name} rolled highest and places first.` }],
    legalActions: [],
  }
  state.actingPlayerId = players[startingIndex].id
  state.activePlayerIndex = startingIndex
  state.legalActions = legalActionsForPlayer(state, players[startingIndex].id)
  return state
}

export const applyAction = (input: GameState, action: GameAction, randomSource?: () => number): ApplyResult => {
  if (action.type === 'restart') {
    if (input.phase !== 'game-over') return fail('A rematch waits until this game ends.')
    // A rematch keeps the table's board options; only the seed moves on.
    return { ok: true, state: createGame({ seed: action.seed ?? input.seed + 1, boardOptions: input.board.generation.options, random: randomSource, controllers: input.players.map((player) => player.controller), names: input.players.map((player) => player.name) }), events: [] }
  }
  const state = structuredClone(input)
  // A room stored mid-negotiation before offers carried an id still resolves.
  state.tradeOffer = currentOffer(state)
  const actorId = currentActorId(state)
  const actor = playerById(state, actorId)
  if (!actor) return fail('Nobody can act. Your view is out of step with the room, and it will resync.')
  const events: GameEvent[] = []

  if (action.type === 'place-settlement') {
    if (state.phase !== 'setup-settlement' || !canPlaceSettlement(state, action.vertexId, actor.id, true)) return fail('Settlements need two edges of space. Pick a corner further out.')
    state.buildings[action.vertexId] = { playerId: actor.id, type: 'settlement' }
    actor.settlements.push(action.vertexId)
    addPort(state, actor, action.vertexId)
    state.pendingSetupVertexId = action.vertexId
    if (state.setupStep >= state.players.length) giveStartingResources(state, actor, action.vertexId)
    state.phase = 'setup-road'
    events.push(addEvent(state, 'settlement-built', `${actor.name} founded a settlement.`, actor.id, { vertexId: action.vertexId }))
    return finish(state, events)
  }

  if (action.type === 'place-road') {
    if (state.phase !== 'setup-road' || !canPlaceRoad(state, action.edgeId, actor.id, state.pendingSetupVertexId)) return fail('The road has to start at the settlement you just placed.')
    state.roadOwners[action.edgeId] = actor.id
    actor.roads.push(action.edgeId)
    events.push(addEvent(state, 'road-built', `${actor.name} laid a road.`, actor.id, { edgeId: action.edgeId }))
    state.setupStep += 1
    state.pendingSetupVertexId = undefined
    if (state.setupStep >= state.setupOrder.length) {
      state.activePlayerIndex = state.setupOrder[0]
      state.actingPlayerId = state.players[state.activePlayerIndex].id
      state.phase = 'pre-roll'
      events.push(addEvent(state, 'setup-complete', currentPlayer(state).name === 'You' ? 'You take the first turn.' : `${currentPlayer(state).name} takes the first turn.`))
    } else {
      state.setupRound = state.setupStep >= state.players.length ? 2 : 1
      state.activePlayerIndex = state.setupOrder[state.setupStep]
      state.actingPlayerId = state.players[state.activePlayerIndex].id
      state.phase = 'setup-settlement'
    }
    return finish(state, events)
  }

  if (action.type === 'roll-dice') {
    if (state.phase !== 'pre-roll' || actor.id !== currentPlayer(state).id) return fail('Roll the dice first.')
    const random = randomSource ?? seededRandom(state.privateRandomSeed ^ ((state.revision + 1) * 0x9e3779b1))
    const dice: [number, number] = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]
    state.lastRoll = dice
    const total = dice[0] + dice[1]
    events.push(addEvent(state, 'dice', `${actor.name} rolled ${total}.`, actor.id, { total, one: dice[0], two: dice[1] }))
    if (total === 7) beginRobber(state, true, events)
    else {
      produce(state, total)
      state.phase = 'action'
      events.push(addEvent(state, 'production', `The island produced for ${total}.`))
    }
    return finish(state, events)
  }

  if (action.type === 'discard') {
    if (state.phase !== 'discard' || state.actingPlayerId !== actor.id) return fail('Nothing to discard right now.')
    const required = state.discardRemaining[actor.id] ?? 0
    const amount = RESOURCES.reduce((sum, resource) => sum + (action.resources[resource] ?? 0), 0)
    if (!validResourceMap(action.resources) || amount !== required || RESOURCES.some((resource) => (action.resources[resource] ?? 0) > actor.resources[resource])) return fail(`Discard exactly ${required} cards, no more and no fewer.`)
    for (const resource of RESOURCES) {
      const count = action.resources[resource] ?? 0
      actor.resources[resource] -= count
      state.bank[resource] += count
    }
    delete state.discardRemaining[actor.id]
    state.discardQueue = state.discardQueue.filter((id) => id !== actor.id)
    events.push(addEvent(state, 'discard', `${actor.name} discarded ${amount} cards.`, actor.id))
    if (state.discardQueue.length) state.actingPlayerId = state.discardQueue[0]
    else {
      state.phase = 'move-robber'
      state.actingPlayerId = currentPlayer(state).id
    }
    return finish(state, events)
  }

  if (action.type === 'move-robber') {
    if (state.phase !== 'move-robber' || actor.id !== currentPlayer(state).id || action.hexId === state.board.robberHexId || !state.board.hexes.some((hex) => hex.id === action.hexId)) return fail('The robber has to go somewhere new.')
    state.board.robberHexId = action.hexId
    const hex = state.board.hexes.find((tile) => tile.id === action.hexId)
    const victims = new Set<string>()
    for (const vertexId of hex?.vertices ?? []) {
      const building = state.buildings[vertexId]
      if (building && building.playerId !== actor.id) {
        const victim = playerById(state, building.playerId)
        if (victim) victims.add(victim.id)
      }
    }
    state.robberVictims = [...victims]
    if (state.robberVictims.length) state.phase = 'choose-victim'
    else resumeTurnPhase(state)
    events.push(addEvent(state, 'robber-moved', `${actor.name} moved the robber.`, actor.id, { hexId: action.hexId }))
    return finish(state, events)
  }

  if (action.type === 'steal-from') {
    if (state.phase !== 'choose-victim' || !state.robberVictims.includes(action.playerId)) return fail('Pick someone built beside that tile.')
    const victim = playerById(state, action.playerId)
    if (!victim) return fail('That seat is gone.')
    const cards = RESOURCES.flatMap((resource) => Array<Resource>(victim.resources[resource]).fill(resource))
    if (cards.length) {
      const random = randomSource ?? seededRandom(state.privateRandomSeed ^ ((state.revision + 1) * 0x85ebca6b))
      const resource = cards[Math.floor(random() * cards.length)]
      victim.resources[resource] -= 1
      actor.resources[resource] += 1
    }
    state.robberVictims = []
    resumeTurnPhase(state)
    events.push(addEvent(state, 'robbery', cards.length ? `${actor.name} took a card from ${victim.name}.` : `${victim.name} had nothing to take.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'build-road') {
    const free = state.phase === 'road-building' && action.free
    if (state.phase !== 'action' && !free) return fail('You cannot do that right now.')
    if (actor.roads.length >= 15) return fail('All 15 of your roads are on the board. That is every road you get.')
    if (!canPlaceRoad(state, action.edgeId, actor.id)) return fail('Roads must connect to your own road or settlement.')
    if (!free) {
      if (!hasResources(actor, COSTS.road)) return fail('A road costs 1 brick and 1 lumber.')
      pay(state, actor, COSTS.road)
    }
    state.roadOwners[action.edgeId] = actor.id
    actor.roads.push(action.edgeId)
    events.push(addEvent(state, 'road-built', `${actor.name} built a road.`, actor.id, { edgeId: action.edgeId }))
    if (free) {
      state.pendingRoads -= 1
      const moreRoads = Object.keys(state.board.edges).some((edgeId) => canPlaceRoad(state, edgeId, actor.id))
      if (state.pendingRoads <= 0 || !moreRoads || actor.roads.length >= 15) resumeTurnPhase(state)
    }
    return finish(state, events)
  }

  if (action.type === 'build-settlement') {
    if (state.phase !== 'action') return fail('You cannot do that right now.')
    if (!canPlaceSettlement(state, action.vertexId, actor.id)) return fail('Settlements need two edges of space, and a road of yours reaching the corner.')
    if (actor.settlements.length >= 5) return fail('All five of your settlements are on the board. Upgrade one to a city to free it up.')
    if (!hasResources(actor, COSTS.settlement)) return fail('A settlement costs 1 brick, 1 lumber, 1 grain and 1 wool.')
    pay(state, actor, COSTS.settlement)
    state.buildings[action.vertexId] = { playerId: actor.id, type: 'settlement' }
    actor.settlements.push(action.vertexId)
    addPort(state, actor, action.vertexId)
    events.push(addEvent(state, 'settlement-built', `${actor.name} built a settlement.`, actor.id, { vertexId: action.vertexId }))
    return finish(state, events)
  }

  if (action.type === 'build-city') {
    if (state.phase !== 'action') return fail('You cannot do that right now.')
    if (!actor.settlements.includes(action.vertexId)) return fail('A city has to grow from one of your own settlements. Pick one of yours.')
    if (actor.cities.length >= 4) return fail('All four of your cities are on the board. That is every city you get.')
    if (!hasResources(actor, COSTS.city)) return fail('A city costs 3 ore and 2 grain.')
    pay(state, actor, COSTS.city)
    actor.settlements = actor.settlements.filter((id) => id !== action.vertexId)
    actor.cities.push(action.vertexId)
    state.buildings[action.vertexId] = { playerId: actor.id, type: 'city' }
    events.push(addEvent(state, 'city-built', `${actor.name} raised a city.`, actor.id, { vertexId: action.vertexId }))
    return finish(state, events)
  }

  if (action.type === 'buy-development') {
    if (state.phase !== 'action') return fail('You cannot do that right now.')
    if (!state.developmentDeck.length) return fail('The development deck is empty.')
    if (!hasResources(actor, COSTS.development)) return fail('A card costs 1 ore, 1 wool and 1 grain.')
    pay(state, actor, COSTS.development)
    const card = state.developmentDeck.shift()
    if (card) {
      actor.development.push(card)
      actor.boughtDevelopment.push(card)
    }
    events.push(addEvent(state, 'development-bought', `${actor.name} bought a card.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'play-development') {
    if ((state.phase !== 'pre-roll' && state.phase !== 'action') || state.playedDevelopmentThisTurn || !playableDevelopment(actor, action.card)) return fail('One development card per turn, and never on the turn you bought it.')
    if (action.card === 'year-of-plenty' && !canSupplyYearOfPlenty(state)) return fail('The bank is down to its last card.')
    removeCard(actor, action.card)
    state.playedDevelopmentThisTurn = true
    if (action.card === 'knight') {
      actor.playedKnights += 1
      beginRobber(state, false)
    } else if (action.card === 'road-building') {
      state.pendingRoads = Math.min(2, 15 - actor.roads.length)
      if (state.pendingRoads) state.phase = 'road-building'
      else resumeTurnPhase(state)
    } else if (action.card === 'year-of-plenty') state.phase = 'year-of-plenty'
    else state.phase = 'monopoly'
    events.push(addEvent(state, 'development-played', `${actor.name} played ${DEVELOPMENT_NAME[action.card]}.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'choose-year-of-plenty') {
    if (state.phase !== 'year-of-plenty') return fail('Year of Plenty is not in play.')
    const [first, second] = action.resources
    if (state.bank[first] < 1 || state.bank[second] < (first === second ? 2 : 1)) return fail('The bank cannot cover both of those. Pick again.')
    state.bank[first] -= 1
    state.bank[second] -= 1
    actor.resources[first] += 1
    actor.resources[second] += 1
    resumeTurnPhase(state)
    events.push(addEvent(state, 'year-of-plenty', `${actor.name} took two cards from the bank.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'choose-monopoly') {
    if (state.phase !== 'monopoly') return fail('Monopoly is not in play.')
    let amount = 0
    for (const player of state.players) {
      if (player.id === actor.id) continue
      amount += player.resources[action.resource]
      actor.resources[action.resource] += player.resources[action.resource]
      player.resources[action.resource] = 0
    }
    resumeTurnPhase(state)
    events.push(addEvent(state, 'monopoly', `${actor.name} claimed every ${action.resource} on the table, ${amount} cards.`, actor.id, { amount }))
    return finish(state, events)
  }

  if (action.type === 'maritime-trade') {
    if (state.phase !== 'action' || action.give === action.receive || !tradeRatios(state, actor, action.give).includes(action.ratio) || actor.resources[action.give] < action.ratio || state.bank[action.receive] < 1) return fail('You need the full stack to give, and the bank needs one to hand back.')
    actor.resources[action.give] -= action.ratio
    state.bank[action.give] += action.ratio
    state.bank[action.receive] -= 1
    actor.resources[action.receive] += 1
    events.push(addEvent(state, 'maritime-trade', `${actor.name} traded ${action.ratio} ${action.give} for 1 ${action.receive} at the harbor.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'finish-road-building') {
    if (state.phase !== 'road-building') return fail('Road Building is not in play.')
    const legalRoadRemains = state.pendingRoads > 0 && actor.roads.length < 15 && Object.keys(state.board.edges).some((edgeId) => canPlaceRoad(state, edgeId, actor.id))
    if (legalRoadRemains) return fail('Road Building gives you two. Place the second one.')
    state.pendingRoads = 0
    resumeTurnPhase(state)
    events.push(addEvent(state, 'road-building-finished', `${actor.name} finished placing free roads.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'offer-trade') {
    const { trade } = action
    const other = playerById(state, trade.toPlayerId)
    const giveTotal = RESOURCES.reduce((sum, resource) => sum + (trade.give[resource] ?? 0), 0)
    const receiveTotal = RESOURCES.reduce((sum, resource) => sum + (trade.receive[resource] ?? 0), 0)
    if (state.phase !== 'action' || actor.id !== currentPlayer(state).id || trade.fromPlayerId !== actor.id || !other || other.id === actor.id || !validResourceMap(trade.give) || !validResourceMap(trade.receive) || !giveTotal || !receiveTotal) return fail('Put at least one card on each side of the offer.')
    if (RESOURCES.some((resource) => actor.resources[resource] < (trade.give[resource] ?? 0))) return fail('You do not hold everything in that offer.')
    const givesOnlySame = RESOURCES.every((resource) => !(trade.give[resource] && trade.receive[resource]))
    if (!givesOnlySame) return fail('You cannot ask for what you are giving.')
    openOffer(state, actor.id, [other.id], trade.give, trade.receive)
    events.push(addEvent(state, 'trade-offered', `${actor.name} offered a trade to ${other.name}.`, actor.id, { toPlayerId: other.id, offerId: state.tradeOffer!.id }, trade))
    return finish(state, events)
  }

  if (action.type === 'broadcast-trade') {
    const { trade } = action
    const rivals = state.players.filter((player) => player.id !== actor.id).map((player) => player.id)
    if (state.phase !== 'action' || actor.id !== currentPlayer(state).id || trade.fromPlayerId !== actor.id || !rivals.length
      || !validResourceMap(trade.give) || !validResourceMap(trade.receive)
      || !resourceTotalOf(trade.give) || !resourceTotalOf(trade.receive)) return fail('Put at least one card on each side of the offer.')
    if (!canCover(actor, trade.give)) return fail('You do not hold everything in that offer.')
    if (RESOURCES.some((resource) => (trade.give[resource] ?? 0) > 0 && (trade.receive[resource] ?? 0) > 0)) return fail('You cannot ask for what you are giving.')
    openOffer(state, actor.id, rivals, trade.give, trade.receive)
    events.push(addEvent(state, 'trade-broadcast', `${actor.name} put an offer to the table.`, actor.id, { offerId: state.tradeOffer!.id }, { ...trade, toPlayerId: rivals[0] }))
    return finish(state, events)
  }

  if (action.type === 'respond-trade' || action.type === 'accept-trade' || action.type === 'decline-trade') {
    const offer = state.tradeOffer
    // `respond-trade` carries no author, so it can only speak for the seat on the
    // clock. The explicit pair names its author, which is what lets two seats
    // answer the same broadcast without the engine guessing who said what.
    const responderId = action.type === 'respond-trade' ? actor.id : action.playerId
    const responder = playerById(state, responderId)
    const accept = action.type === 'respond-trade' ? action.accept : action.type === 'accept-trade'
    // Answering an offer that has already ended is the ordinary case in a race, not
    // a client bug, so it gets its own line rather than a puzzled one.
    if (action.type !== 'respond-trade' && action.offerId !== offer?.id) return fail('That offer is already settled. The table has moved on.')
    if (state.phase !== 'trade-response' || !offer || !responder) return fail('No trade is waiting on you.')
    if (!offer.toPlayerIds.includes(responderId) || offer.declinedBy.includes(responderId)) return fail('No trade is waiting on you.')
    const initiator = playerById(state, offer.fromPlayerId)
    if (!initiator) return fail('The other seat is gone. The offer is dead.')
    const terms = { fromPlayerId: offer.fromPlayerId, toPlayerId: responderId, give: structuredClone(offer.give), receive: structuredClone(offer.receive) }
    if (!accept) {
      offer.declinedBy.push(responderId)
      events.push(addEvent(state, 'trade-rejected', `${responder.name} declined ${initiator.name}'s trade.`, responderId, { fromPlayerId: initiator.id, offerId: offer.id }, terms))
      // `settleOffer` inside `finish` moves the clock on, or ends the offer when
      // the last rival has passed.
      return finish(state, events)
    }
    if (!canCover(responder, offer.receive) || !canCover(initiator, offer.give)) return fail('One of you no longer holds those cards. The offer is dead.')
    for (const resource of RESOURCES) {
      const give = offer.give[resource] ?? 0
      const receive = offer.receive[resource] ?? 0
      initiator.resources[resource] += receive - give
      responder.resources[resource] += give - receive
    }
    closeOffer(state, 'accepted', responderId)
    events.push(addEvent(state, 'trade-accepted', `${responder.name} accepted ${initiator.name}'s trade.`, responderId, { fromPlayerId: initiator.id, offerId: state.tradeResolution!.id }, terms))
    return finish(state, events)
  }

  if (action.type === 'withdraw-trade') {
    const offer = state.tradeOffer
    if (state.phase !== 'trade-response' || !offer || offer.id !== action.offerId) return fail('There is no offer of yours to take back.')
    if (offer.fromPlayerId !== action.playerId) return fail('Only the seat that made the offer can take it back.')
    const offerer = playerById(state, offer.fromPlayerId)
    closeOffer(state, 'withdrawn')
    events.push(addEvent(state, 'trade-withdrawn', `${offerer?.name ?? 'The offerer'} took the offer back.`, offer.fromPlayerId))
    return finish(state, events)
  }

  if (action.type === 'counter-trade') {
    const previous = state.tradeOffer
    const { trade } = action
    const other = playerById(state, trade.toPlayerId)
    const giveTotal = resourceTotalOf(trade.give)
    const receiveTotal = resourceTotalOf(trade.receive)
    const participantsIncludeCurrent = [trade.fromPlayerId, trade.toPlayerId].includes(currentPlayer(state).id)
    if (state.phase !== 'trade-response' || !previous || !previous.toPlayerIds.includes(actor.id) || previous.declinedBy.includes(actor.id)
      || previous.fromPlayerId !== trade.toPlayerId || trade.fromPlayerId !== actor.id || !other || !participantsIncludeCurrent
      || !validResourceMap(trade.give) || !validResourceMap(trade.receive) || !giveTotal || !receiveTotal) return fail('Put at least one card on each side of the counteroffer.')
    if (!canCover(actor, trade.give)) return fail('You do not hold everything in that counteroffer.')
    if (!RESOURCES.every((resource) => !(trade.give[resource] && trade.receive[resource]))) return fail('You cannot ask for what you are giving.')
    // A counteroffer answers the old offer and replaces it, so the old one gets a
    // resolution of its own rather than disappearing.
    closeOffer(state, 'countered', actor.id)
    openOffer(state, actor.id, [other.id], trade.give, trade.receive)
    events.push(addEvent(state, 'trade-countered', `${actor.name} made a counteroffer to ${other.name}.`, actor.id, { toPlayerId: other.id, offerId: state.tradeOffer!.id }, trade))
    return finish(state, events)
  }

  if (action.type === 'end-turn') {
    if (state.phase !== 'action' || actor.id !== currentPlayer(state).id) return fail('Finish what you started before ending the turn.')
    actor.boughtDevelopment = []
    state.playedDevelopmentThisTurn = false
    state.lastRoll = undefined
    state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length
    state.actingPlayerId = currentPlayer(state).id
    state.phase = 'pre-roll'
    events.push(addEvent(state, 'turn-ended', currentPlayer(state).name === 'You' ? 'Your turn begins.' : `${currentPlayer(state).name}'s turn begins.`, currentPlayer(state).id))
    return finish(state, events)
  }

  return fail('You cannot do that right now.')
}

export const getPlayerView = (state: GameState, playerId: string): PlayerView => {
  const player = playerById(state, playerId)
  if (!player) throw new Error('Unknown player')
  const resourceCounts: Record<string, number> = {}
  for (const candidate of state.players) {
    resourceCounts[candidate.id] = totalResources(candidate.resources)
  }
  const publicState: PlayerView['publicState'] = {
    version: state.version,
    revision: state.revision,
    board: structuredClone(state.board),
    players: state.players.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      color: candidate.color,
      controller: candidate.controller,
      playedKnights: candidate.playedKnights,
      roads: [...candidate.roads],
      settlements: [...candidate.settlements],
      cities: [...candidate.cities],
      ports: [...candidate.ports],
      resourceCount: resourceCounts[candidate.id],
      developmentCount: candidate.development.length,
      publicScore: publicScorePlayer(state, candidate.id),
    })),
    activePlayerIndex: state.activePlayerIndex,
    phase: state.phase,
    setupRound: state.setupRound,
    setupOrder: [...state.setupOrder],
    setupStep: state.setupStep,
    pendingSetupVertexId: state.pendingSetupVertexId,
    actingPlayerId: state.actingPlayerId,
    discardQueue: [...state.discardQueue],
    bank: structuredClone(state.bank),
    roadOwners: { ...state.roadOwners },
    buildings: structuredClone(state.buildings),
    developmentDeckCount: state.developmentDeck.length,
    discardRemaining: { ...state.discardRemaining },
    robberVictims: [...state.robberVictims],
    pendingRoads: state.pendingRoads,
    playedDevelopmentThisTurn: state.playedDevelopmentThisTurn,
    pendingTrade: state.pendingTrade ? structuredClone(state.pendingTrade) : undefined,
    // Both are public: an offer's terms and its answer are things the whole table
    // hears. Neither carries a hand, so neither leaks one.
    tradeOffer: state.tradeOffer ? structuredClone(state.tradeOffer) : undefined,
    tradeResolution: state.tradeResolution ? structuredClone(state.tradeResolution) : undefined,
    lastRoll: state.lastRoll ? [...state.lastRoll] as [number, number] : undefined,
    longestRoad: state.longestRoad ? { ...state.longestRoad } : undefined,
    largestArmy: state.largestArmy ? { ...state.largestArmy } : undefined,
    winnerId: state.winnerId,
    events: structuredClone(state.events),
  }
  return {
    v: 1,
    revision: state.revision,
    playerId,
    phase: state.phase,
    publicState,
    privateState: {
      resources: structuredClone(player.resources),
      development: [...player.development],
      boughtDevelopment: [...player.boughtDevelopment],
    },
    resourceCounts,
    legalActions: legalActionsForPlayer(state, playerId),
  }
}
