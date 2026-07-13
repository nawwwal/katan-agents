import type { RoomView } from '../src/game/room.js'

type AgentViewOptions = {
  includeBoard?: boolean
  afterRevision?: number
  timedOut?: boolean
  connected?: boolean
}

const currentActorId = (room: RoomView) => {
  const state = room.game?.publicState
  if (!state) return undefined
  return state.actingPlayerId
    ?? (state.phase === 'discard' ? state.discardQueue[0] : state.players[state.activePlayerIndex]?.id)
}

export const toAgentView = (room: RoomView, options: AgentViewOptions = {}) => {
  const timedOut = options.timedOut ?? false
  const base = {
    room: {
      code: room.code,
      status: room.status,
      seats: room.seats,
      seatsTotal: room.seatsTotal,
      updatedAt: room.updatedAt,
    },
    you: room.viewerPlayerId,
    actionRequired: false,
    timedOut,
    cursor: { updatedAt: room.updatedAt, revision: room.game?.revision ?? 0 },
    ...(options.connected === undefined ? {} : { connected: options.connected }),
  }

  if (!room.game) {
    return {
      ...base,
      nextCall: {
        preferred: 'Return control to the live runner; it will wake this seat when the room changes.',
        compatibilityFallback: 'wait_for_event',
      },
    }
  }

  const view = room.game
  const { board, events, ...publicState } = view.publicState
  const actorId = currentActorId(room)
  const afterRevision = Math.max(0, options.afterRevision ?? Math.max(0, view.revision - 12))
  const eventsSinceRevision = events.filter((event) => event.revision > afterRevision)
  const earliestAvailableRevision = events[0]?.revision ?? view.revision
  const isYourTurn = actorId === view.playerId
  const actionRequired = isYourTurn && view.legalActions.length > 0
  const finished = room.status === 'finished' || view.phase === 'game-over'

  return {
    ...base,
    revision: view.revision,
    phase: view.phase,
    currentActorId: actorId,
    isYourTurn,
    actionRequired,
    privateState: view.privateState,
    publicState,
    eventsSinceRevision,
    historyTruncated: events.length > 0 && afterRevision < earliestAvailableRevision - 1,
    legalActions: view.legalActions,
    ...(options.includeBoard ? { board } : {}),
    nextCall: finished
      ? null
      : actionRequired
        ? { preferred: 'play_action', expectedRevision: view.revision }
        : {
            preferred: 'Return control to the live runner; it will wake this same conversation on the next actionable event.',
            compatibilityFallback: 'wait_for_event',
            afterUpdatedAt: room.updatedAt,
            afterRevision: view.revision,
          },
  }
}

export const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})
