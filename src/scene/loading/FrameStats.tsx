import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Hitch instrumentation.
 *
 * Average frame rate is close to useless for the complaint this exists to
 * answer. A session that renders 3600 frames at a clean 16ms and one 400ms
 * shader stall still averages 59fps, and it feels broken. What matters is the
 * tail: the worst frame, and how many frames missed the budget at all.
 *
 * Read it from the console at any time:
 *
 *   __katanFrames.report()   // summary since the last reset
 *   __katanFrames.reset()    // start a fresh window
 */

const BUDGET_MS = 1000 / 60
const BAD_MS = 1000 / 30

export type FrameReport = {
  frames: number
  seconds: number
  fps: number
  meanMs: number
  p95Ms: number
  p99Ms: number
  worstMs: number
  /** Frames slower than 16.7ms -- a missed 60fps refresh. */
  over16: number
  /** Frames slower than 33ms -- a visible hitch. */
  over33: number
  over16Percent: number
  over33Percent: number
  /** Every frame over 33ms, in order, so stalls can be located in time. */
  hitches: { atSeconds: number; ms: number }[]
  drawCalls: number
  triangles: number
  programs: number
  geometries: number
  textures: number
  /**
   * Shadow wiring, because "the scene looks flat" has two very different
   * causes and they are indistinguishable from a screenshot: a light that is
   * not casting, or geometry that is not receiving.
   */
  shadows: {
    enabled: boolean
    casters: number
    receivers: number
    lights: { type: string; intensity: number; castShadow: boolean; mapped: boolean }[]
  }
}

type FrameProbe = {
  reset: () => void
  report: () => FrameReport
  shadowProbe: () => unknown
  /**
   * Live handles on the renderer and the scene graph.
   *
   * React Three Fiber keeps both entirely inside React, so from a devtools
   * console or a screenshot harness there is otherwise no way to reach them.
   * Every render defect found in this scene so far needed exactly this: drop a
   * probe mesh in, A/B a light, read a uniform. The shadow bug was diagnosed in
   * four steps through this handle after two sessions of static reading.
   */
  gl: THREE.WebGLRenderer
  scene: THREE.Scene
  THREE: typeof THREE
}

declare global {
  // eslint-disable-next-line no-var
  var __katanFrames: FrameProbe | undefined
}

const percentile = (sorted: number[], fraction: number) => {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return sorted[index]
}

const surveyShadows = (gl: THREE.WebGLRenderer, scene: THREE.Scene): FrameReport['shadows'] => {
  let casters = 0
  let receivers = 0
  const lights: FrameReport['shadows']['lights'] = []
  scene.traverse((object) => {
    const light = object as THREE.Light & { shadow?: { map?: unknown } }
    if (light.isLight) {
      lights.push({ type: object.type, intensity: Number(light.intensity.toFixed(2)), castShadow: light.castShadow, mapped: Boolean(light.shadow?.map) })
      return
    }
    if (!(object as THREE.Mesh).isMesh) return
    if (object.castShadow) casters += 1
    if (object.receiveShadow) receivers += 1
  })
  return { enabled: gl.shadowMap.enabled, casters, receivers, lights }
}

/**
 * Deep shadow diagnostics, on demand.
 *
 * The question this answers is whether `light.shadow.matrix` -- the transform
 * the fragment shader uses to look a pixel up in the shadow map -- still
 * agrees with the camera the map was actually rendered from. When it does not,
 * every lookup lands somewhere plausible but wrong, and the result is noise
 * that dims the whole surface instead of a shadow with a shape.
 */
const shadowProbe = (gl: THREE.WebGLRenderer, scene: THREE.Scene) => {
  const report: unknown[] = []
  scene.traverse((object) => {
    const light = object as unknown as THREE.DirectionalLight
    if (!(light as unknown as { isDirectionalLight?: boolean }).isDirectionalLight || !light.castShadow) return
    const shadow = light.shadow
    const camera = shadow.camera
    // What the shader will use, versus what the map was rendered with right
    // now. `shadow.matrix` also carries the bias that remaps clip space to
    // texture space, so compare the projection*view part separately.
    const expected = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
    const bias = new (camera.projectionMatrix.constructor as typeof THREE.Matrix4)().set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    )
    const rebuilt = bias.multiply(expected)
    const drift = shadow.matrix.elements.reduce((worst, value, index) => Math.max(worst, Math.abs(value - rebuilt.elements[index])), 0)
    report.push({
      lightPosition: light.position.toArray().map((v) => Number(v.toFixed(4))),
      lightWorldPosition: new (light.position.constructor as typeof THREE.Vector3)().setFromMatrixPosition(light.matrixWorld).toArray().map((v) => Number(v.toFixed(4))),
      targetPosition: light.target.position.toArray(),
      targetInScene: Boolean(light.target.parent),
      cameraNear: camera.near,
      cameraFar: camera.far,
      cameraBounds: [camera.left, camera.right, camera.top, camera.bottom],
      mapSize: [shadow.mapSize.x, shadow.mapSize.y],
      mapAllocated: Boolean(shadow.map),
      bias: shadow.bias,
      normalBias: shadow.normalBias,
      radius: shadow.radius,
      intensity: shadow.intensity,
      /** Zero means the lookup transform matches the render transform. */
      shadowMatrixDrift: Number(drift.toFixed(6)),
      autoUpdate: gl.shadowMap.autoUpdate,
      needsUpdate: gl.shadowMap.needsUpdate,
      type: gl.shadowMap.type,
    })
  })
  return report
}

export function FrameStats() {
  const gl = useThree((three) => three.gl)
  const scene = useThree((three) => three.scene)
  const samples = useRef<number[]>([])
  const hitches = useRef<{ atSeconds: number; ms: number }[]>([])
  const started = useRef(performance.now())
  const last = useRef(0)

  useEffect(() => {
    const reset = () => {
      samples.current = []
      hitches.current = []
      started.current = performance.now()
      last.current = 0
    }
    const report = (): FrameReport => {
      const list = samples.current
      const sorted = [...list].sort((a, b) => a - b)
      const seconds = (performance.now() - started.current) / 1000
      const sum = list.reduce((total, ms) => total + ms, 0)
      const over16 = list.filter((ms) => ms > BUDGET_MS).length
      const over33 = list.filter((ms) => ms > BAD_MS).length
      return {
        frames: list.length,
        seconds: Number(seconds.toFixed(2)),
        fps: seconds > 0 ? Number((list.length / seconds).toFixed(1)) : 0,
        meanMs: list.length ? Number((sum / list.length).toFixed(2)) : 0,
        p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
        p99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
        worstMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
        over16,
        over33,
        over16Percent: list.length ? Number(((over16 / list.length) * 100).toFixed(2)) : 0,
        over33Percent: list.length ? Number(((over33 / list.length) * 100).toFixed(2)) : 0,
        hitches: hitches.current.slice(-40),
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? 0,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        shadows: surveyShadows(gl, scene),
      }
    }
    globalThis.__katanFrames = { reset, report, shadowProbe: () => shadowProbe(gl, scene), gl, scene, THREE }
    return () => { globalThis.__katanFrames = undefined }
  }, [gl, scene])

  useFrame(() => {
    const now = performance.now()
    if (last.current) {
      const ms = now - last.current
      // Tab-switches and debugger pauses are not hitches; a frame that took
      // longer than a second is the browser having been away.
      if (ms < 1000) {
        samples.current.push(ms)
        if (ms > BAD_MS) hitches.current.push({ atSeconds: Number(((now - started.current) / 1000).toFixed(2)), ms: Number(ms.toFixed(1)) })
        if (samples.current.length > 20000) samples.current.splice(0, 10000)
      }
    }
    last.current = now
  })

  return null
}
