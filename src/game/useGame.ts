import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseBotAction } from './bot'
import { applyAction, createGame, currentActorId, getPlayerView } from './engine'
import { RESOURCES } from './types'
import type { AgentStatus, CreateGameOptions, GameAction, GameEvent, GameState, Resources } from './types'

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export type SpectatorPace = 'slow' | 'steady' | 'fast'
export type GamePresentation = {
  revision: number
  action: GameAction
  actionType: GameAction['type']
  events: GameEvent[]
  resourceDeltas: Record<string, Partial<Resources>>
  awardChanges: string[]
}

const PACE_MS: Record<SpectatorPace, { beforeAction: number; betweenAgentStages: number; afterSelection: number }> = {
  slow: { beforeAction: 1_650, betweenAgentStages: 720, afterSelection: 900 },
  steady: { beforeAction: 950, betweenAgentStages: 420, afterSelection: 560 },
  fast: { beforeAction: 220, betweenAgentStages: 110, afterSelection: 140 },
}

class AgentDecisionError extends Error {
  constructor(readonly code: 'disconnected' | 'timeout' | 'invalid', message: string) {
    super(message)
  }
}

const checkAgentHealth = async (signal: AbortSignal) => {
  try {
    const response = await fetch('/agent-api/health', { signal: AbortSignal.any([signal, AbortSignal.timeout(2_500)]) })
    if (!response.ok) throw new AgentDecisionError('disconnected', `Bridge returned ${response.status}`)
    return (await response.json()) as { ok: boolean; mode: 'heuristic' | 'external' }
  } catch (error) {
    if (error instanceof AgentDecisionError) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new AgentDecisionError('timeout', 'Bridge health check timed out')
    throw new AgentDecisionError('disconnected', 'Bridge is not reachable')
  }
}

const askLocalAgent = async (state: GameState, playerId: string, signal: AbortSignal) => {
  const response = await fetch('/agent-api/v1/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(getPlayerView(state, playerId)),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
  })
  if (!response.ok) throw new AgentDecisionError(response.status === 504 ? 'timeout' : response.status === 422 ? 'invalid' : 'disconnected', `Agent bridge returned ${response.status}`)
  const decision = (await response.json()) as { revision?: number; action?: GameAction }
  if (decision.revision !== state.revision || !decision.action?.type) throw new AgentDecisionError('invalid', 'Agent response did not match the current revision')
  return decision as { revision: number; action: GameAction }
}

export const useGame = () => {
  const [game, setGame] = useState<GameState>()
  const [error, setError] = useState<string>()
  const [thinkingPlayerId, setThinkingPlayerId] = useState<string>()
  const [spectating, setSpectating] = useState(false)
  const [spectatorPaused, setSpectatorPaused] = useState(false)
  const [spectatorPace, setSpectatorPace] = useState<SpectatorPace>('steady')
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({})
  const [presentation, setPresentation] = useState<GamePresentation>()
  const gameRef = useRef(game)
  gameRef.current = game

  const start = useCallback((options: CreateGameOptions) => {
    const next = createGame(options)
    gameRef.current = next
    setGame(next)
    setError(undefined)
    setThinkingPlayerId(undefined)
    setSpectatorPaused(false)
    setSpectatorPace('steady')
    setAgentStatuses(Object.fromEntries(next.players.filter((player) => player.controller === 'agent').map((player) => [player.id, { state: 'idle', detail: 'Waiting for first turn' } satisfies AgentStatus])))
    setPresentation(undefined)
    return next
  }, [])

  const reset = useCallback(() => {
    gameRef.current = undefined
    setGame(undefined)
    setError(undefined)
    setThinkingPlayerId(undefined)
    setSpectating(false)
    setSpectatorPaused(false)
    setSpectatorPace('steady')
    setAutomationEnabled(false)
    setAgentStatuses({})
    setPresentation(undefined)
  }, [])

  const submit = useCallback((action: GameAction) => {
    const current = gameRef.current
    if (!current) return
    const result = applyAction(current, action)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const resourceDeltas = Object.fromEntries(result.state.players.map((player) => {
      const before = current.players.find((candidate) => candidate.id === player.id)
      const deltas = Object.fromEntries(RESOURCES.flatMap((resource) => {
        const delta = player.resources[resource] - (before?.resources[resource] ?? 0)
        return delta ? [[resource, delta]] : []
      }))
      return [player.id, deltas]
    }))
    gameRef.current = result.state
    setGame(result.state)
    const awardChanges = [
      current.longestRoad?.playerId !== result.state.longestRoad?.playerId ? `${result.state.players.find((player) => player.id === result.state.longestRoad?.playerId)?.name ?? 'No one'} now holds Longest Road` : undefined,
      current.largestArmy?.playerId !== result.state.largestArmy?.playerId ? `${result.state.players.find((player) => player.id === result.state.largestArmy?.playerId)?.name ?? 'No one'} now holds Largest Army` : undefined,
    ].filter((change): change is string => Boolean(change))
    setPresentation({ revision: result.state.revision, action, actionType: action.type, events: result.events, resourceDeltas, awardChanges })
    setError(undefined)
  }, [])

  useEffect(() => {
    if (!game || !automationEnabled || spectatorPaused) return
    if (game.phase === 'game-over') return
    const actorId = currentActorId(game)
    const actor = game.players.find((player) => player.id === actorId)
    if (!actor || (actor.controller === 'human' && !spectating)) return
    let cancelled = false
    const agentRequest = new AbortController()
    setThinkingPlayerId(actor.id)
    if (actor.controller === 'agent') {
      setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'connecting', detail: 'Opening the local bridge', revision: game.revision } }))
    }

    const act = async () => {
      const pace = PACE_MS[spectatorPace]
      await wait(pace.beforeAction)
      if (cancelled) return
      let action: GameAction | undefined
      let usedFallback = false
      const current = gameRef.current
      if (!current || currentActorId(current) !== actor.id) return
      if (actor.controller === 'agent') {
        try {
          const health = await checkAgentHealth(agentRequest.signal)
          if (cancelled) return
          setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'connected', detail: health.mode === 'external' ? 'External runner ready' : 'Heuristic bridge', revision: current.revision } }))
          await wait(pace.betweenAgentStages)
          if (cancelled) return
          setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'thinking', detail: 'Reviewing legal actions', revision: current.revision } }))
          const decision = await askLocalAgent(current, actor.id, agentRequest.signal)
          const selectedAction = decision.action
          action = selectedAction
          setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'selected', detail: selectedAction.type.replaceAll('-', ' '), revision: decision.revision, actionType: selectedAction.type } }))
          await wait(pace.afterSelection)
        } catch (error) {
          if (cancelled || agentRequest.signal.aborted) return
          const failure = error instanceof AgentDecisionError ? error.code : error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'invalid'
          setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: failure, detail: error instanceof Error ? error.message : 'Agent decision failed', revision: current.revision } }))
          const fallbackAction = chooseBotAction(getPlayerView(current, actor.id))
          action = fallbackAction
          if (fallbackAction) {
            usedFallback = true
            setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'fallback', detail: `Bot chose ${fallbackAction.type.replaceAll('-', ' ')}`, revision: current.revision, actionType: fallbackAction.type } }))
            await wait(pace.afterSelection)
          } else setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: 'fatal', detail: 'No legal fallback action', revision: current.revision } }))
        }
      } else action = chooseBotAction(getPlayerView(current, actor.id))
      if (!cancelled && action) {
        const latest = gameRef.current
        if (!latest || latest.revision !== current.revision || currentActorId(latest) !== actor.id) return
        const appliedAction = action
        submit(appliedAction)
        if (actor.controller === 'agent') setAgentStatuses((statuses) => ({ ...statuses, [actor.id]: { state: usedFallback ? 'fallback' : 'applied', detail: usedFallback ? `Applied bot fallback · ${appliedAction.type.replaceAll('-', ' ')}` : appliedAction.type.replaceAll('-', ' '), revision: current.revision, actionType: appliedAction.type } }))
      }
      if (!cancelled) setThinkingPlayerId(undefined)
    }
    void act()
    return () => {
      cancelled = true
      agentRequest.abort()
      setThinkingPlayerId(undefined)
      if (actor.controller === 'agent') {
        setAgentStatuses((statuses) => {
          const status = statuses[actor.id]
          if (!status || !['connecting', 'connected', 'thinking', 'selected'].includes(status.state)) return statuses
          return { ...statuses, [actor.id]: { state: 'idle', detail: 'Decision stopped before completion', revision: game.revision } }
        })
      }
    }
  }, [automationEnabled, game, spectatorPace, spectatorPaused, spectating, submit])

  return { game, start, reset, submit, error, thinkingPlayerId, agentStatuses, presentation, spectating, setSpectating, spectatorPaused, setSpectatorPaused, spectatorPace, setSpectatorPace, automationEnabled, setAutomationEnabled }
}
