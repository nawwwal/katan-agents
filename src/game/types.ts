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

export type DesertPlacement = 'random' | 'center' | 'edge'
export type HarborLayout = 'shuffled' | 'fixed'

/**
 * Optional constraints, in the order the generator relaxes them. The four adjacency
 * rules (no touching 6/8, no touching 2/12, no repeated adjacent number, no repeated
 * adjacent terrain) are invariants of `createBoard`, not options, and are never relaxed.
 */
export type BoardConstraint = 'balancedPips'

export type BoardOptions = {
  /** Caps the pips on any one intersection and evens the pips across the six wedges of the island. */
  balancedPips: boolean
  desert: DesertPlacement
  harbors: HarborLayout
}

/** How a board was actually produced, so the UI can reproduce it and report relaxed constraints. */
export type BoardGeneration = {
  seed: number
  options: BoardOptions
  /** Constraints the generator had to drop to finish. Empty when everything the host asked for held. */
  relaxed: BoardConstraint[]
  /** Randomised solves run before the board was accepted. */
  attempts: number
  /** Backtracking nodes explored, for the search-budget headroom check. */
  nodes: number
}

export const BOARD_CONSTRAINTS: BoardConstraint[] = ['balancedPips']

export const defaultBoardOptions = (): BoardOptions => ({
  balancedPips: true,
  desert: 'random',
  harbors: 'shuffled',
})

export type Board = {
  hexes: HexTile[]
  vertices: Record<string, BoardVertex>
  edges: Record<string, BoardEdge>
  harbors: Harbor[]
  robberHexId: string
  generation: BoardGeneration
}

export type DevelopmentCard = 'knight' | 'road-building' | 'year-of-plenty' | 'monopoly' | 'victory-point'

/** Card names as the rulebook writes them. Lives here so the engine can name a card in the log without importing the UI. */
export const DEVELOPMENT_NAME: Record<DevelopmentCard, string> = {
  knight: 'Knight',
  'road-building': 'Road Building',
  'year-of-plenty': 'Year of Plenty',
  monopoly: 'Monopoly',
  'victory-point': 'Victory Point',
}

/** One line of behavior per named character, shown in the lobby and sent to an agent with its seat. */
export const CHARACTER_LINE: Record<string, string> = {
  Marlow: 'Harbor pilot. Trades early, trades often.',
  Ansel: 'Surveyor. Quiet until the ore adds up.',
  Solveig: 'Road boss. Takes the long way and gets there first.',
  Bram: 'Ferryman. Impatient, and it shows.',
}

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

/** A trade put to the whole table. Same shape as a domestic trade minus the target. */
export type BroadcastTrade = {
  fromPlayerId: string
  give: Partial<Resources>
  receive: Partial<Resources>
}

/**
 * An offer sitting on the table. A directed offer names one seat; a broadcast
 * offer names every rival and the first of them to accept takes it.
 *
 * `id` never repeats and only ever increases within a game, which is what lets a
 * client tell a fresh answer from one it has already shown. Revisions cannot do
 * that job: a revision stops moving once the trade resolves, so anything keyed on
 * "the current revision" reads the same answer forever.
 */
export type TradeOffer = {
  id: number
  fromPlayerId: string
  /** Seats the offer is open to, in seat order. One entry for a directed offer. */
  toPlayerIds: string[]
  give: Partial<Resources>
  receive: Partial<Resources>
  /** Seats that have said no. A seat in here can no longer accept. */
  declinedBy: string[]
  openedAtRevision: number
}

export type TradeOutcome =
  /** Someone took it. `acceptedBy` names them. */
  | 'accepted'
  /** Every seat it was offered to said no, but seats at the table were never asked. */
  | 'declined'
  /** Every rival at the table refused this exact bundle. */
  | 'no-takers'
  /** A recipient answered with an offer of their own. */
  | 'countered'
  /** The offerer took it back. */
  | 'withdrawn'
  /** The offerer stopped holding what they promised, so the offer died on the table. */
  | 'invalidated'

/**
 * How the last offer ended. This is the channel a client should read for a trade
 * outcome; the event log is a log, not an event channel.
 */
export type TradeResolution = {
  /** The id of the offer this resolves. */
  id: number
  outcome: TradeOutcome
  fromPlayerId: string
  toPlayerIds: string[]
  give: Partial<Resources>
  receive: Partial<Resources>
  declinedBy: string[]
  acceptedBy?: string
  /** The revision the answer landed at. */
  revision: number
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
  /** Puts one offer in front of every rival at once. First to accept takes it. */
  | { type: 'broadcast-trade'; trade: BroadcastTrade }
  | { type: 'counter-trade'; trade: DomesticTrade }
  | { type: 'respond-trade'; accept: boolean }
  /** Answers whichever offer is open, naming the seat that answers. */
  | { type: 'accept-trade'; offerId: number; playerId: string }
  | { type: 'decline-trade'; offerId: number; playerId: string }
  | { type: 'withdraw-trade'; offerId: number; playerId: string }
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
  /**
   * The seat currently on the clock for the open offer, in the old one-target
   * shape. Derived from `tradeOffer` so every consumer written before broadcast
   * offers existed keeps working; read `tradeOffer` for the whole picture.
   */
  pendingTrade?: DomesticTrade
  /** The offer on the table, if any. */
  tradeOffer?: TradeOffer
  /** How the last offer ended. Survives until the next offer opens. */
  tradeResolution?: TradeResolution
  /** Hands out offer ids. Bookkeeping, never sent to a player. */
  nextTradeId: number
  lastRoll?: [number, number]
  longestRoad?: { playerId: string; length: number }
  largestArmy?: { playerId: string; size: number }
  winnerId?: string
  events: GameEvent[]
  legalActions: GameAction[]
}

export type PublicGameState = Omit<GameState, 'players' | 'developmentDeck' | 'legalActions' | 'seed' | 'privateRandomSeed' | 'nextTradeId'> & {
  players: PublicPlayer[]
  developmentDeckCount: number
}

export type CreateGameOptions = {
  seed?: number
  boardOptions?: BoardOptions
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
