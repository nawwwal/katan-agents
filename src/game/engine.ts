import { createBoard, seededRandom, shuffle } from './board.js'
import {
  RESOURCES,
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
} from './types.js'

const COLORS: PlayerColor[] = ['coral', 'blue', 'amber', 'ivory']
const NAMES = ['You', 'Agent Blue', 'Agent Amber', 'Ivory Guild']
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

export const legalActionsForPlayer = (state: GameState, playerId: string): GameAction[] => {
  if (state.phase === 'game-over') return [{ type: 'restart', seed: state.seed + 1 }]
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
  if (state.phase === 'trade-response') {
    const trade = state.pendingTrade
    if (!trade || trade.toPlayerId !== playerId) return []
    const initiator = playerById(state, trade.fromPlayerId)
    const canAccept = Boolean(initiator && RESOURCES.every((resource) =>
      player.resources[resource] >= (trade.receive[resource] ?? 0)
      && initiator.resources[resource] >= (trade.give[resource] ?? 0)))
    const counters: GameAction[] = []
    if (initiator) {
      for (const give of RESOURCES) {
        if (player.resources[give] < 1) continue
        for (const receive of RESOURCES) {
          if (receive !== give) counters.push({ type: 'counter-trade', trade: { fromPlayerId: player.id, toPlayerId: initiator.id, give: { [give]: 1 }, receive: { [receive]: 1 } } })
        }
      }
    }
    return [...(canAccept ? [{ type: 'respond-trade', accept: true } as const] : []), { type: 'respond-trade', accept: false }, ...counters]
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
  actions.push({ type: 'end-turn' })
  return actions
}

const addEvent = (state: GameState, type: string, message: string, playerId?: string, publicData?: GameEvent['publicData']) => {
  const revision = state.revision + 1
  const sequence = state.events.filter((event) => event.revision === revision).length
  const event = { id: `ev-${revision}-${sequence}`, revision, type, message, playerId, publicData }
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

const beginRobber = (state: GameState, discard: boolean) => {
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
    board: createBoard(seed),
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
    if (input.phase !== 'game-over') return fail('Restart is only available after the game ends')
    return { ok: true, state: createGame({ seed: action.seed ?? input.seed + 1, random: randomSource, controllers: input.players.map((player) => player.controller), names: input.players.map((player) => player.name) }), events: [] }
  }
  const state = structuredClone(input)
  const actorId = currentActorId(state)
  const actor = playerById(state, actorId)
  if (!actor) return fail('No player can act right now')
  const events: GameEvent[] = []

  if (action.type === 'place-settlement') {
    if (state.phase !== 'setup-settlement' || !canPlaceSettlement(state, action.vertexId, actor.id, true)) return fail('That starting settlement is not legal')
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
    if (state.phase !== 'setup-road' || !canPlaceRoad(state, action.edgeId, actor.id, state.pendingSetupVertexId)) return fail('That starting road is not legal')
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
    if (state.phase !== 'pre-roll' || actor.id !== currentPlayer(state).id) return fail('Roll at the start of your turn')
    const random = randomSource ?? seededRandom(state.privateRandomSeed ^ ((state.revision + 1) * 0x9e3779b1))
    const dice: [number, number] = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]
    state.lastRoll = dice
    const total = dice[0] + dice[1]
    events.push(addEvent(state, 'dice', `${actor.name} rolled ${total}.`, actor.id, { total, one: dice[0], two: dice[1] }))
    if (total === 7) beginRobber(state, true)
    else {
      produce(state, total)
      state.phase = 'action'
      events.push(addEvent(state, 'production', `The island produced for ${total}.`))
    }
    return finish(state, events)
  }

  if (action.type === 'discard') {
    if (state.phase !== 'discard' || state.actingPlayerId !== actor.id) return fail('You do not need to discard now')
    const required = state.discardRemaining[actor.id] ?? 0
    const amount = RESOURCES.reduce((sum, resource) => sum + (action.resources[resource] ?? 0), 0)
    if (!validResourceMap(action.resources) || amount !== required || RESOURCES.some((resource) => (action.resources[resource] ?? 0) > actor.resources[resource])) return fail(`Discard exactly ${required} resource cards`)
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
    if (state.phase !== 'move-robber' || actor.id !== currentPlayer(state).id || action.hexId === state.board.robberHexId || !state.board.hexes.some((hex) => hex.id === action.hexId)) return fail('Move the robber to a different hex')
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
    if (state.phase !== 'choose-victim' || !state.robberVictims.includes(action.playerId)) return fail('Choose an adjacent player')
    const victim = playerById(state, action.playerId)
    if (!victim) return fail('That player is unavailable')
    const cards = RESOURCES.flatMap((resource) => Array<Resource>(victim.resources[resource]).fill(resource))
    if (cards.length) {
      const random = randomSource ?? seededRandom(state.privateRandomSeed ^ ((state.revision + 1) * 0x85ebca6b))
      const resource = cards[Math.floor(random() * cards.length)]
      victim.resources[resource] -= 1
      actor.resources[resource] += 1
    }
    state.robberVictims = []
    resumeTurnPhase(state)
    events.push(addEvent(state, 'robbery', cards.length ? `${actor.name} stole a resource from ${victim.name}.` : `${victim.name} had no resource cards to steal.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'build-road') {
    const free = state.phase === 'road-building' && action.free
    if ((state.phase !== 'action' && !free) || !canPlaceRoad(state, action.edgeId, actor.id) || actor.roads.length >= 15) return fail('That road is not legal')
    if (!free) {
      if (!hasResources(actor, COSTS.road)) return fail('A road costs brick and lumber')
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
    if (state.phase !== 'action' || !canPlaceSettlement(state, action.vertexId, actor.id) || actor.settlements.length >= 5 || !hasResources(actor, COSTS.settlement)) return fail('That settlement is not legal or affordable')
    pay(state, actor, COSTS.settlement)
    state.buildings[action.vertexId] = { playerId: actor.id, type: 'settlement' }
    actor.settlements.push(action.vertexId)
    addPort(state, actor, action.vertexId)
    events.push(addEvent(state, 'settlement-built', `${actor.name} built a settlement.`, actor.id, { vertexId: action.vertexId }))
    return finish(state, events)
  }

  if (action.type === 'build-city') {
    if (state.phase !== 'action' || !actor.settlements.includes(action.vertexId) || actor.cities.length >= 4 || !hasResources(actor, COSTS.city)) return fail('Upgrade one of your settlements with 3 ore and 2 grain')
    pay(state, actor, COSTS.city)
    actor.settlements = actor.settlements.filter((id) => id !== action.vertexId)
    actor.cities.push(action.vertexId)
    state.buildings[action.vertexId] = { playerId: actor.id, type: 'city' }
    events.push(addEvent(state, 'city-built', `${actor.name} raised a city.`, actor.id, { vertexId: action.vertexId }))
    return finish(state, events)
  }

  if (action.type === 'buy-development') {
    if (state.phase !== 'action' || !state.developmentDeck.length || !hasResources(actor, COSTS.development)) return fail('A development card costs ore, wool, and grain')
    pay(state, actor, COSTS.development)
    const card = state.developmentDeck.shift()
    if (card) {
      actor.development.push(card)
      actor.boughtDevelopment.push(card)
    }
    events.push(addEvent(state, 'development-bought', `${actor.name} bought a development card.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'play-development') {
    if ((state.phase !== 'pre-roll' && state.phase !== 'action') || state.playedDevelopmentThisTurn || !playableDevelopment(actor, action.card)) return fail('That development card cannot be played now')
    if (action.card === 'year-of-plenty' && !canSupplyYearOfPlenty(state)) return fail('The bank cannot supply two resources')
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
    events.push(addEvent(state, 'development-played', `${actor.name} played ${action.card.replaceAll('-', ' ')}.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'choose-year-of-plenty') {
    if (state.phase !== 'year-of-plenty') return fail('Year of Plenty is not active')
    const [first, second] = action.resources
    if (state.bank[first] < 1 || state.bank[second] < (first === second ? 2 : 1)) return fail('The bank cannot supply those resources')
    state.bank[first] -= 1
    state.bank[second] -= 1
    actor.resources[first] += 1
    actor.resources[second] += 1
    resumeTurnPhase(state)
    events.push(addEvent(state, 'year-of-plenty', `${actor.name} drew two resources.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'choose-monopoly') {
    if (state.phase !== 'monopoly') return fail('Monopoly is not active')
    let amount = 0
    for (const player of state.players) {
      if (player.id === actor.id) continue
      amount += player.resources[action.resource]
      actor.resources[action.resource] += player.resources[action.resource]
      player.resources[action.resource] = 0
    }
    resumeTurnPhase(state)
    events.push(addEvent(state, 'monopoly', `${actor.name} claimed ${amount} ${action.resource}.`, actor.id, { amount }))
    return finish(state, events)
  }

  if (action.type === 'maritime-trade') {
    if (state.phase !== 'action' || action.give === action.receive || !tradeRatios(state, actor, action.give).includes(action.ratio) || actor.resources[action.give] < action.ratio || state.bank[action.receive] < 1) return fail('That maritime trade is unavailable')
    actor.resources[action.give] -= action.ratio
    state.bank[action.give] += action.ratio
    state.bank[action.receive] -= 1
    actor.resources[action.receive] += 1
    events.push(addEvent(state, 'maritime-trade', `${actor.name} traded ${action.ratio} ${action.give} for ${action.receive}.`, actor.id))
    return finish(state, events)
  }

  if (action.type === 'finish-road-building') {
    if (state.phase !== 'road-building') return fail('Road Building is not active')
    const legalRoadRemains = state.pendingRoads > 0 && actor.roads.length < 15 && Object.keys(state.board.edges).some((edgeId) => canPlaceRoad(state, edgeId, actor.id))
    if (legalRoadRemains) return fail('Place both free roads while legal paths remain')
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
    if (state.phase !== 'action' || actor.id !== currentPlayer(state).id || trade.fromPlayerId !== actor.id || !other || other.id === actor.id || !validResourceMap(trade.give) || !validResourceMap(trade.receive) || !giveTotal || !receiveTotal) return fail('That domestic trade is invalid')
    if (RESOURCES.some((resource) => actor.resources[resource] < (trade.give[resource] ?? 0))) return fail('You lack the cards in that offer')
    const givesOnlySame = RESOURCES.every((resource) => !(trade.give[resource] && trade.receive[resource]))
    if (!givesOnlySame) return fail('A resource cannot be traded for itself')
    state.pendingTrade = structuredClone(trade)
    state.phase = 'trade-response'
    state.actingPlayerId = other.id
    events.push(addEvent(state, 'trade-offered', `${actor.name} offered a trade to ${other.name}.`, actor.id, { toPlayerId: other.id }))
    return finish(state, events)
  }

  if (action.type === 'respond-trade') {
    const trade = state.pendingTrade
    if (state.phase !== 'trade-response' || !trade || trade.toPlayerId !== actor.id) return fail('There is no trade for you to answer')
    const initiator = playerById(state, trade.fromPlayerId)
    if (!initiator) return fail('The offering player is unavailable')
    if (action.accept && RESOURCES.some((resource) => actor.resources[resource] < (trade.receive[resource] ?? 0) || initiator.resources[resource] < (trade.give[resource] ?? 0))) return fail('A trader no longer has those cards')
    if (action.accept) {
      for (const resource of RESOURCES) {
        const give = trade.give[resource] ?? 0
        const receive = trade.receive[resource] ?? 0
        initiator.resources[resource] += receive - give
        actor.resources[resource] += give - receive
      }
    }
    state.pendingTrade = undefined
    state.phase = 'action'
    state.actingPlayerId = currentPlayer(state).id
    events.push(addEvent(state, action.accept ? 'trade-accepted' : 'trade-rejected', `${actor.name} ${action.accept ? 'accepted' : 'declined'} ${initiator.name}'s trade.`, actor.id, { fromPlayerId: initiator.id }))
    return finish(state, events)
  }

  if (action.type === 'counter-trade') {
    const previous = state.pendingTrade
    const { trade } = action
    const other = playerById(state, trade.toPlayerId)
    const giveTotal = RESOURCES.reduce((sum, resource) => sum + (trade.give[resource] ?? 0), 0)
    const receiveTotal = RESOURCES.reduce((sum, resource) => sum + (trade.receive[resource] ?? 0), 0)
    const participantsIncludeCurrent = [trade.fromPlayerId, trade.toPlayerId].includes(currentPlayer(state).id)
    if (state.phase !== 'trade-response' || !previous || previous.toPlayerId !== actor.id || previous.fromPlayerId !== trade.toPlayerId || trade.fromPlayerId !== actor.id || !other || !participantsIncludeCurrent || !validResourceMap(trade.give) || !validResourceMap(trade.receive) || !giveTotal || !receiveTotal) return fail('That counteroffer is invalid')
    if (RESOURCES.some((resource) => actor.resources[resource] < (trade.give[resource] ?? 0))) return fail('You lack the cards in that counteroffer')
    if (!RESOURCES.every((resource) => !(trade.give[resource] && trade.receive[resource]))) return fail('A resource cannot be traded for itself')
    state.pendingTrade = structuredClone(trade)
    state.actingPlayerId = other.id
    events.push(addEvent(state, 'trade-countered', `${actor.name} made a counteroffer to ${other.name}.`, actor.id, { toPlayerId: other.id }))
    return finish(state, events)
  }

  if (action.type === 'end-turn') {
    if (state.phase !== 'action' || actor.id !== currentPlayer(state).id) return fail('Finish resolving the current action first')
    actor.boughtDevelopment = []
    state.playedDevelopmentThisTurn = false
    state.lastRoll = undefined
    state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length
    state.actingPlayerId = currentPlayer(state).id
    state.phase = 'pre-roll'
    events.push(addEvent(state, 'turn-ended', currentPlayer(state).name === 'You' ? 'Your turn begins.' : `${currentPlayer(state).name}'s turn begins.`, currentPlayer(state).id))
    return finish(state, events)
  }

  return fail('That action is not available now')
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
