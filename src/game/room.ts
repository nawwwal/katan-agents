import { RESOURCES, emptyResources } from './types'
import type { Controller, GameAction, GameDisplayState, PlayerView, Resources } from './types'

export type RoomStatus = 'lobby' | 'playing' | 'finished'

export type RoomSeat = {
  id: string
  name: string
  controller: Controller
  isHost: boolean
}

export type RoomView = {
  v: 1
  code: string
  status: RoomStatus
  seatsTotal: 3 | 4
  seats: RoomSeat[]
  viewerPlayerId: string
  isHost: boolean
  updatedAt: number
  game?: PlayerView
}

export type RoomCredentials = {
  code: string
  token: string
  playerId: string
}

export type ClientRoomMessage =
  | { type: 'hello'; code: string; token: string }
  | { type: 'action'; requestId: string; expectedRevision: number; action: unknown }
  | { type: 'start'; requestId: string }
  | { type: 'ping' }

export type ServerRoomMessage =
  | { type: 'snapshot'; room: RoomView }
  | { type: 'ack'; requestId: string }
  | { type: 'error'; requestId?: string; error: { code: string; message: string } }
  | { type: 'pong' }

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const exactKeys = (value: unknown, keys: string[]) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key))

export const parseClientRoomMessage = (value: unknown): ClientRoomMessage | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'ping' && exactKeys(value, ['type'])) return { type: 'ping' }
  if (value.type === 'hello' && exactKeys(value, ['type', 'code', 'token']) && typeof value.code === 'string' && /^[A-Z2-9]{6}$/i.test(value.code) && typeof value.token === 'string' && value.token.length >= 32 && value.token.length <= 128) {
    return { type: 'hello', code: value.code, token: value.token }
  }
  if (value.type === 'start' && exactKeys(value, ['type', 'requestId']) && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 128) {
    return { type: 'start', requestId: value.requestId }
  }
  if (value.type === 'action' && exactKeys(value, ['type', 'requestId', 'expectedRevision', 'action']) && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 128 && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0) {
    return { type: 'action', requestId: value.requestId, expectedRevision: Number(value.expectedRevision), action: value.action }
  }
  return undefined
}

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => own(right, key) && deepEqual(left[key], right[key]))
}

const validResourceMap = (value: unknown): value is Partial<Resources> => isRecord(value)
  && Object.keys(value).every((resource) => RESOURCES.includes(resource as (typeof RESOURCES)[number]))
  && Object.values(value).every((amount) => Number.isSafeInteger(amount) && Number(amount) >= 0)

const resourceTotal = (value: Partial<Resources>) => RESOURCES.reduce((total, resource) => total + (value[resource] ?? 0), 0)

const validDiscard = (view: PlayerView, action: Record<string, unknown>): action is Extract<GameAction, { type: 'discard' }> => {
  const resources = action.resources
  const required = view.publicState.discardRemaining[view.playerId]
  return view.phase === 'discard'
    && exactKeys(action, ['type', 'resources'])
    && validResourceMap(resources)
    && resourceTotal(resources) === required
    && RESOURCES.every((resource) => (resources[resource] ?? 0) <= view.privateState.resources[resource])
}

const validTrade = (view: PlayerView, action: Record<string, unknown>): action is Extract<GameAction, { type: 'offer-trade' | 'counter-trade' }> => {
  if (!['offer-trade', 'counter-trade'].includes(String(action.type)) || !exactKeys(action, ['type', 'trade']) || !isRecord(action.trade)) return false
  const trade = action.trade
  if (!exactKeys(trade, ['fromPlayerId', 'toPlayerId', 'give', 'receive'])) return false
  const give = trade.give
  const receive = trade.receive
  if (!validResourceMap(give) || !validResourceMap(receive)) return false
  if (trade.fromPlayerId !== view.playerId || typeof trade.toPlayerId !== 'string' || trade.toPlayerId === view.playerId) return false
  if (!resourceTotal(give) || !resourceTotal(receive)) return false
  if (RESOURCES.some((resource) => (give[resource] ?? 0) > 0 && (receive[resource] ?? 0) > 0)) return false
  if (RESOURCES.some((resource) => (give[resource] ?? 0) > view.privateState.resources[resource])) return false
  if (action.type === 'counter-trade') {
    return view.publicState.pendingTrade?.fromPlayerId === trade.toPlayerId
      && view.publicState.pendingTrade.toPlayerId === trade.fromPlayerId
  }
  return view.publicState.players.some((player) => player.id === trade.toPlayerId)
}

export const parsePlayerAction = (view: PlayerView, value: unknown): GameAction | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  const exact = view.legalActions.find((action) => deepEqual(action, value))
  if (exact) return exact
  if (value.type === 'discard' && view.legalActions.some((action) => action.type === 'discard') && validDiscard(view, value)) return value
  if (['offer-trade', 'counter-trade'].includes(value.type) && view.legalActions.some((action) => action.type === value.type) && validTrade(view, value)) return value
  return undefined
}

export const toDisplayState = (view: PlayerView): GameDisplayState => ({
  ...view.publicState,
  players: view.publicState.players.map((player) => ({
    ...player,
    resources: player.id === view.playerId ? { ...view.privateState.resources } : emptyResources(),
    development: player.id === view.playerId ? [...view.privateState.development] : [],
    boughtDevelopment: player.id === view.playerId ? [...view.privateState.boughtDevelopment] : [],
  })),
  legalActions: [...view.legalActions],
})

export const visibleScore = (game: GameDisplayState, playerId: string, viewerPlayerId?: string) => {
  const player = game.players.find((candidate) => candidate.id === playerId)
  if (!player) return 0
  if (game.phase === 'game-over' || playerId !== viewerPlayerId) return player.publicScore
  return player.publicScore + player.development.filter((card) => card === 'victory-point').length
}
