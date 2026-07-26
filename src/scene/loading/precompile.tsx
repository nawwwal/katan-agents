import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'

/**
 * Shader compilation, done before the player can see it.
 *
 * This is the stall that hides from every average. A WebGL program is linked
 * the first time a material is drawn, and linking a standard material with
 * shadows, an environment map and three lights costs tens of milliseconds --
 * sometimes hundreds on a cold driver. Ten materials appearing across the
 * first minute of play is ten separate freezes, each one landing exactly when
 * something interesting just happened, and the mean frame time barely moves.
 *
 * `compileAsync` links everything currently in the scene without blocking the
 * main thread, so the cost is paid against the loading bar instead.
 */

const COMPILE_TIMEOUT_MS = 12000

declare global {
  // eslint-disable-next-line no-var
  var __katanCompileMs: number | undefined
}

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])

type Props = {
  onReady: () => void
}

export function ScenePrecompile({ onReady }: Props) {
  const gl = useThree((three) => three.gl)
  const scene = useThree((three) => three.scene)
  const camera = useThree((three) => three.camera)
  const done = useRef(false)
  const counted = useRef(0)
  const warming = useRef(false)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // One frame of grace so late children and the effect composer have
      // actually attached; compiling an empty scene proves nothing.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (cancelled) return
      const started = performance.now()
      try {
        await withTimeout(gl.compileAsync(scene, camera), COMPILE_TIMEOUT_MS)
      } catch (error) {
        console.warn('[precompile] shader warmup failed, continuing anyway:', error)
      }
      if (cancelled) return
      // Force the shadow map through once too, so the first cast shadow is not
      // its own separate hitch.
      gl.shadowMap.needsUpdate = true
      globalThis.__katanCompileMs = Math.round(performance.now() - started)
      counted.current = count(scene)
      done.current = true
      onReady()
    }

    void run()
    return () => { cancelled = true }
  }, [camera, gl, onReady, scene])

  // Pieces, tokens and effects mount long after the loading screen is gone,
  // and each new material is a fresh program link. Watch for the scene graph
  // growing and warm the newcomers during idle time rather than on the frame
  // that needs them.
  useFrame(() => {
    if (!done.current || warming.current) return
    const total = count(scene)
    if (total <= counted.current + 8) return
    counted.current = total
    warming.current = true
    const warm = () => {
      void withTimeout(gl.compileAsync(scene, camera), COMPILE_TIMEOUT_MS).finally(() => { warming.current = false })
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 500 })
    else setTimeout(warm, 0)
  })

  return null
}

const count = (scene: THREE.Object3D) => {
  let total = 0
  scene.traverse(() => { total += 1 })
  return total
}
