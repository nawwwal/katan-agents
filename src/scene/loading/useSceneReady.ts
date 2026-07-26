import { useCallback, useEffect, useRef, useState } from 'react'
import { preloadEverything, preloadState, subscribeToPreload, type PreloadState } from './preload'

/**
 * "Ready" means two independent things have both finished: every asset is
 * fetched and decoded, and the scene has linked its shaders. Neither alone is
 * enough, so the loading screen waits on both.
 *
 * There is also a hard ceiling. If a fetch hangs behind a proxy or a driver
 * refuses to finish a compile, the player gets the board anyway -- a scene
 * that is briefly rough beats a progress bar that never fills.
 */

const HARD_LIMIT_MS = 15000

export type SceneReady = {
  ready: boolean
  progress: number
  label: string
  assets: PreloadState
}

export function useSceneReady(compiled: boolean): SceneReady {
  const [assets, setAssets] = useState<PreloadState>(preloadState)
  const [expired, setExpired] = useState(false)
  // The limit is a safety net, not an event. Firing it after a load that
  // already succeeded would put a scary warning in the console every session.
  const settled = useRef(false)

  useEffect(() => {
    const unsubscribe = subscribeToPreload(setAssets)
    void preloadEverything()
    const timer = setTimeout(() => {
      if (settled.current) return
      console.warn('[loading] hard limit reached; revealing the scene regardless')
      setExpired(true)
    }, HARD_LIMIT_MS)
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [])

  const ready = expired || (assets.done && compiled)
  settled.current = ready
  // Asset work is the long pole; reserve the last slice of the bar for the
  // shader compile so it does not sit at 100% while still visibly waiting.
  const progress = ready ? 1 : Math.min(0.94, assets.progress * 0.94) + (compiled ? 0.06 : 0)
  const label = ready ? 'Ready' : assets.done ? 'Compiling shaders' : assets.label

  return { ready, progress, label, assets }
}

/** Callback identity that survives re-renders, for `ScenePrecompile`. */
export function useCompiledFlag(): [boolean, () => void] {
  const [compiled, setCompiled] = useState(false)
  const mark = useCallback(() => setCompiled(true), [])
  return [compiled, mark]
}
