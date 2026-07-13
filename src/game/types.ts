export const RESOURCES = ['brick', 'lumber', 'ore', 'grain', 'wool'] as const
export type Resource = (typeof RESOURCES)[number]
export type Terrain = Resource | 'desert'
export type Controller = 'human' | 'agent'
export type PlayerColor = 'coral' | 'blue' | 'amber' | 'ivory'
export type AgentStatus = {
  state: 'idle' | 'thinking'
  detail?: string
  revision?: number
  actionType?: GameAction['type']
}
export type Phase =
  | 'setup-settlement'
  | 'setup-road'
  | 'pre-roll'
  | 'action'
  | 'discard'
  | 'move-robber'
  | 'choose-victim'
  | 'road-building'
  | 'year-of-plenty'
  | 'monopoly'
  | 'trade-response'
  | 'game-over'

export type Resources = Record<Resource, number>

export type Harbor = {
  id: string
  edgeId: string
  ratio: 2 | 3
  resource?: Resource
}

export type HexTile = {
  id: string
  q: number
  r: number
  x: number
  z: number
  terrain: Terrain
  number?: number
  vertices: string[]
  edges: string[]
  neighbors: string[]
}

export type BoardVertex = {
  id: string
  x: number
  z: number
  hexes: string[]
  edges: string[]
  neighbors: string[]
  harborId?: string
}

export type BoardEdge = {
  id: string
  vertices: [string, string]
  hexes: string[]
}

export type Board = {
  hexes: HexTile[]
  vertices: Record<string, BoardVertex>
  edges: Record<string, BoardEdge>
  harbors: Harbor[]
  robberHexId: string
}

export type DevelopmentCard = 'knight' | 'road-building' | 'year-of-plenty' | 'monopoly' | 'victory-point'

export type Player = {
  id: string
  name: string
  color: PlayerColor
  controller: Controller
  resources: Resources
  development: DevelopmentCard[]
  boughtDevelopment: DevelopmentCard[]
  playedKnights: number
  roads: string[]
  settlements: string[]
  cities: string[]
  ports: string[]
}

export type PublicPlayer = Pick<Player, 'id' | 'name' | 'color' | 'controller' | 'playedKnights' | 'roads' | 'settlements' | 'cities' | 'ports'> & {
  resourceCount: number
  developmentCount: number
  publicScore: number
}

export type DomesticTrade = {
  fromPlayerId: string
  toPlayerId: string
  give: Partial<Resources>
  receive: Partial<Resources>
}

export type GameAction =
  | { type: 'place-settlement'; vertexId: string }
  | { type: 'place-road'; edgeId: string }
  | { type: 'roll-dice'; dice?: [number, number] }
  | { type: 'discard'; resources: Partial<Resources> }
  | { type: 'move-robber'; hexId: string }
  | { type: 'steal-from'; playerId: string }
  | { type: 'build-road'; edgeId: string; free?: boolean }
  | { type: 'finish-road-building' }
  | { type: 'build-settlement'; vertexId: string }
  | { type: 'build-city'; vertexId: string }
  | { type: 'buy-development' }
  | { type: 'play-development'; card: Exclude<DevelopmentCard, 'victory-point'> }
  | { type: 'choose-year-of-plenty'; resources: [Resource, Resource] }
  | { type: 'choose-monopoly'; resource: Resource }
  | { type: 'maritime-trade'; give: Resource; receive: Resource; ratio: 2 | 3 | 4 }
  | { type: 'offer-trade'; trade: DomesticTrade }
  | { type: 'counter-trade'; trade: DomesticTrade }
  | { type: 'respond-trade'; accept: boolean }
  | { type: 'end-turn' }
  | { type: 'restart'; seed?: number }

export type GameEvent = {
  id: string
  revision: number
  type: string
  message: string
  playerId?: string
  publicData?: Record<string, string | number | boolean>
  trade?: DomesticTrade
}

export type GameState = {
  version: 1
  seed: number
  privateRandomSeed: number
  revision: number
  board: Board
  players: Player[]
  activePlayerIndex: number
  phase: Phase
  setupRound: 1 | 2
  setupOrder: number[]
  setupStep: number
  pendingSetupVertexId?: string
  actingPlayerId?: string
  discardQueue: string[]
  bank: Resources
  roadOwners: Record<string, string>
  buildings: Record<string, { playerId: string; type: 'settlement' | 'city' }>
  developmentDeck: DevelopmentCard[]
  discardRemaining: Record<string, number>
  robberVictims: string[]
  pendingRoads: number
  playedDevelopmentThisTurn: boolean
  pendingTrade?: DomesticTrade
  lastRoll?: [number, number]
  longestRoad?: { playerId: string; length: number }
  largestArmy?: { playerId: string; size: number }
  winnerId?: string
  events: GameEvent[]
  legalActions: GameAction[]
}

export type PublicGameState = Omit<GameState, 'players' | 'developmentDeck' | 'legalActions' | 'seed' | 'privateRandomSeed'> & {
  players: PublicPlayer[]
  developmentDeckCount: number
}

export type CreateGameOptions = {
  seed?: number
  privateRandomSeed?: number
  random?: () => number
  controllers?: Controller[]
  names?: string[]
}

export type PlayerView = {
  v: 1
  revision: number
  playerId: string
  phase: Phase
  publicState: PublicGameState
  privateState: Pick<Player, 'resources' | 'development' | 'boughtDevelopment'>
  resourceCounts: Record<string, number>
  legalActions: GameAction[]
}

export type VisiblePlayer = PublicPlayer & Pick<Player, 'resources' | 'development' | 'boughtDevelopment'>

export type GameDisplayState = Omit<PublicGameState, 'players'> & {
  players: VisiblePlayer[]
  legalActions: GameAction[]
}

export const emptyResources = (): Resources => ({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 })
