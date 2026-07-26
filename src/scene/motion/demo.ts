import { useEffect, useMemo, useState } from 'react'
import type { GameAction, GameDisplayState } from '../../game/types'
import type { GamePresentation } from '../../game/useGame'

// Motion-QA-only driver, in the same spirit as the `?board` route.
//
// Camera easing, dice tumble and impact timing cannot be judged from a still
// of an idle board, and the visual-QA route has no server to produce real
// events. `?motion=<beat>` replays one beat on a loop so a screenshot burst or
// a recording actually captures the arc. It is inert without the parameter.

type Beat = { action: GameAction['type']; label: string }

const BEATS: Record<string, Beat> = {
  roll: { action: 'roll-dice', label: 'dice' },
  place: { action: 'build-settlement', label: 'settlement' },
  road: { action: 'build-road', label: 'road' },
  city: { action: 'build-city', label: 'city' },
  robber: { action: 'move-robber', label: 'robber' },
  trade: { action: 'maritime-trade', label: 'trade' },
  award: { action: 'build-road', label: 'longest road' },
  army: { action: 'play-development', label: 'largest army' },
  victory: { action: 'build-city', label: 'victory' },
}

const CYCLE = ['roll', 'place', 'city', 'robber', 'trade', 'award'] as const

export type MotionDemo = { game: GameDisplayState; presentation?: GamePresentation }

export const motionDemoMode = () => {
  if (typeof window === 'undefined') return undefined
  const mode = new URLSearchParams(window.location.search).get('motion')
  return mode && (mode === 'cycle' || mode in BEATS) ? mode : undefined
}

/** `?motionPeriod=0` stops the loop so a harness can step beats by hand. */
const demoPeriod = (fallback: number) => {
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('motionPeriod')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function useMotionDemo(game: GameDisplayState, fallbackPeriod = 6): MotionDemo {
  const mode = useMemo(motionDemoMode, [])
  const period = useMemo(() => demoPeriod(fallbackPeriod), [fallbackPeriod])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!mode) return
    const step = () => setTick((value) => value + 1)
    ;(globalThis as unknown as { __katanNext?: () => void }).__katanNext = step
    if (period <= 0) return
    const timer = window.setInterval(step, period * 1000)
    return () => window.clearInterval(timer)
  }, [mode, period])

  return useMemo(() => {
    if (!mode) return { game }
    const key = mode === 'cycle' ? CYCLE[tick % CYCLE.length] : mode
    const beat = BEATS[key]
    const revision = game.revision + tick + 1
    const settled = Object.keys(game.buildings)
    const roads = Object.keys(game.roadOwners)
    const vertexId = settled[tick % Math.max(1, settled.length)]
    const edgeId = roads[tick % Math.max(1, roads.length)]
    const hexId = game.board.hexes[(tick * 5) % game.board.hexes.length].id
    const publicData: Record<string, string> = key === 'robber' ? { hexId } : key === 'road' || key === 'award' ? { edgeId } : { vertexId }
    const winner = key === 'victory' ? game.players[0]?.id : undefined
    const owner = game.buildings[vertexId]?.playerId ?? game.players[0]?.id

    return {
      game: {
        ...game,
        revision,
        lastRoll: [1 + ((tick * 3) % 6), 1 + ((tick * 5) % 6)] as [number, number],
        winnerId: winner,
        longestRoad: key === 'award' ? { playerId: owner, length: 5 } : game.longestRoad,
        largestArmy: key === 'army' ? { playerId: owner, size: 3 } : game.largestArmy,
      },
      presentation: {
        revision,
        actionType: beat.action,
        events: [{ id: `demo-${revision}`, revision, type: 'demo', message: beat.label, playerId: owner, publicData }],
        resourceDeltas: {},
        awardChanges: key === 'award' ? ['Someone now holds Longest Road'] : key === 'army' ? ['Someone now holds Largest Army'] : [],
      },
    }
  }, [game, mode, tick])
}
