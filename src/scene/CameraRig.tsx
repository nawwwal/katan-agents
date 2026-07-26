import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { onBeat, onShake, type BeatKind, type CameraBeat } from './motion/beats'
import { motionDemoMode } from './motion/demo'
import { clampDelta, easeInOutCubic, easeInOutSine, impulse, saturate, setSpring, spring, stepSpring, type Spring } from './motion/spring'

// The board stays readable because the rig is expressed in spherical framing
// terms — target, distance, polar, azimuth, fov — and every one of them is
// clamped before it ever reaches the camera. MapControls still owns the
// pointer; the director only drives when the player is not touching it.
const LIMITS = {
  polar: [0.34, 1.05] as const,
  azimuth: [-1.25, 1.25] as const,
  distance: [8.5, 32] as const,
  fov: [22, 48] as const,
  pan: 6.2,
}

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value))

type Framing = { tx: number; ty: number; tz: number; distance: number; polar: number; azimuth: number; fov: number }

const baseFraming = (width: number, height: number): Framing => {
  const narrow = width / height < 0.72
  return narrow
    ? { tx: 0, ty: 0.32, tz: 0, distance: 23.4, polar: 0.5, azimuth: 0.22, fov: 43 }
    : { tx: 0, ty: 0.3, tz: 0, distance: 15.3, polar: 0.58, azimuth: 0.28, fov: 31 }
}

/**
 * How each kind of game beat reframes the board.
 *
 * `distance` is a multiplier on the resting distance; `polar` and `azimuth`
 * are deltas in radians; `follow` is how far the look-at slides toward the
 * point the event happened at (1 would abandon the board, 0 ignores it).
 */
type Recipe = {
  distance: number
  polar: number
  azimuth: number
  fov: number
  follow: number
  hold: number
  frequency: number
  ratio: number
  /**
   * Wind-up. `kick` is an outward velocity impulse in metres per second —
   * a spring target alone is too polite to read as anticipation in 0.2s.
   */
  anticipate?: { distance: number; duration: number; kick: number }
}

const RECIPES: Record<BeatKind, Recipe> = {
  // Dice want air: settle wide and a touch more top-down so every tile reads.
  roll: { distance: 1.14, polar: -0.05, azimuth: -0.03, fov: 1.5, follow: 0, hold: 3.1, frequency: 0.62, ratio: 0.82 },
  // Turn handoff. The most repeated beat in the game — sixty times a match —
  // so it gets the smallest move in the table: half a degree of drift and a
  // two-percent breath out, critically damped so it never bounces. Enough to
  // register as "the board changed hands", not enough to notice twice.
  handoff: { distance: 1.02, polar: -0.012, azimuth: 0.028, fov: 0, follow: 0, hold: 1.1, frequency: 0.75, ratio: 1 },
  // Placement pushes in on the contact point, after a short pull-back.
  place: { distance: 0.81, polar: 0.06, azimuth: 0.05, fov: -1, follow: 0.56, hold: 2.4, frequency: 0.9, ratio: 0.68, anticipate: { distance: 1.16, duration: 0.24, kick: 3.4 } },
  city: { distance: 0.74, polar: 0.05, azimuth: 0.09, fov: -1.5, follow: 0.62, hold: 2.7, frequency: 0.85, ratio: 0.64, anticipate: { distance: 1.2, duration: 0.28, kick: 4.1 } },
  robber: { distance: 0.87, polar: 0.1, azimuth: -0.12, fov: 0, follow: 0.5, hold: 2.5, frequency: 0.78, ratio: 0.74 },
  // A considered three-quarter: the table-talk angle.
  trade: { distance: 0.94, polar: 0.11, azimuth: 0.36, fov: 0, follow: 0, hold: 3, frequency: 0.5, ratio: 0.95 },
  award: { distance: 1.05, polar: -0.04, azimuth: -0.18, fov: 0, follow: 0.3, hold: 2.8, frequency: 0.55, ratio: 0.88 },
  victory: { distance: 1.34, polar: -0.14, azimuth: 0.3, fov: 2, follow: 0, hold: 9, frequency: 0.34, ratio: 1 },
  quiet: { distance: 1, polar: 0, azimuth: 0, fov: 0, follow: 0, hold: 0, frequency: 0.5, ratio: 0.95 },
}

// Title sequence. Four shots with different lengths, altitudes and easings so
// the orbit has a shape instead of a constant angular velocity.
type Shot = { polar: number; azimuth: number; distance: number; fov: number; duration: number; ease: (t: number) => number }

const CINEMATIC: Shot[] = [
  // Low and wide: the island against open water.
  { polar: 0.95, azimuth: -1.02, distance: 1.34, fov: 32, duration: 8, ease: easeInOutSine },
  // Crane to near-vertical so the whole board reads at once.
  { polar: 0.42, azimuth: -0.22, distance: 1.1, fov: 30, duration: 6, ease: easeInOutCubic },
  // Drop into a close three-quarter and let the terrain have depth.
  { polar: 0.66, azimuth: 0.62, distance: 0.97, fov: 27, duration: 5.5, ease: easeInOutCubic },
  // Hero: the framing the game actually plays in. Held the longest.
  { polar: 0.56, azimuth: 0.3, distance: 1.04, fov: 31, duration: 10.5, ease: easeInOutSine },
]
const CINEMATIC_LENGTH = CINEMATIC.reduce((total, shot) => total + shot.duration, 0)
const HERO = CINEMATIC[CINEMATIC.length - 1]

// Motion QA needs the actual easing curve, not a guess from screenshots. With
// `?motion=…` the rig publishes its spherical framing and frame time so a
// harness can read overshoot, settle time and fps as numbers. Off otherwise.
type Probe = (spherical: THREE.Spherical, delta: number) => void

type Telemetry = { trace: number[][]; frames: number; worst: number; scene?: THREE.Object3D; renderer?: THREE.WebGLRenderer }
type ProbeHost = { __katanMotion?: Telemetry; __katanProbe?: Probe }

const createProbe = (): Probe | undefined => {
  if (!motionDemoMode()) return undefined
  const host = globalThis as unknown as ProbeHost
  // StrictMode renders twice; one telemetry object, or the harness reads the
  // half that never got wired up.
  if (host.__katanProbe) return host.__katanProbe
  const trace: number[][] = []
  const telemetry: Telemetry = { trace, frames: 0, worst: 0 }
  host.__katanMotion = telemetry
  host.__katanProbe = (spherical, delta) => {
    telemetry.frames += 1
    telemetry.worst = Math.max(telemetry.worst, delta)
    trace.push([performance.now(), spherical.radius, spherical.phi, spherical.theta, delta])
    if (trace.length > 1800) trace.shift()
  }
  return host.__katanProbe
}

/** Let the QA harness walk the live scene graph, only under `?motion=`. */
const telemetryScene = (scene: THREE.Object3D, renderer: THREE.WebGLRenderer) => {
  const host = globalThis as unknown as ProbeHost
  if (!host.__katanMotion) return
  host.__katanMotion.scene = scene
  host.__katanMotion.renderer = renderer
}

const springSet = () => ({
  tx: spring(), ty: spring(), tz: spring(), distance: spring(), polar: spring(), azimuth: spring(), fov: spring(),
})

export function CameraRig({ cinematic = false, reducedMotion = false, focus, focusRevision }: { cinematic?: boolean; reducedMotion?: boolean; focus?: [number, number]; focusRevision?: number }) {
  const { camera, size, invalidate } = useThree()
  const controls = useRef<MapControlsImpl>(null)
  const springs = useRef(springSet()).current
  const punch = useRef<Spring>(spring()).current
  const base = useRef<Framing>(baseFraming(size.width, size.height))
  const beat = useRef<{ recipe: Recipe; at?: [number, number]; started: number; remaining: number } | undefined>(undefined)
  const beatRevision = useRef(-1)
  const userUntil = useRef(0)
  const clock = useRef(0)
  const cineTime = useRef(0)
  const ready = useRef(false)
  const spherical = useMemo(() => new THREE.Spherical(), [])
  const offset = useMemo(() => new THREE.Vector3(), [])
  const probe = useMemo(createProbe, [])
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const applyFraming = useCallback((framing: Framing) => {
    for (const key of ['tx', 'ty', 'tz', 'distance', 'polar', 'azimuth', 'fov'] as const) setSpring(springs[key], framing[key])
  }, [springs])

  // Resting framing follows the viewport. Re-derive it, but never stomp a
  // framing the player has panned or zoomed to themselves.
  useEffect(() => {
    const next = baseFraming(size.width, size.height)
    base.current = next
    if (!ready.current) {
      applyFraming(next)
      ready.current = true
    }
    invalidate()
  }, [applyFraming, invalidate, size.height, size.width])

  const start = useCallback((kind: BeatKind, at: [number, number] | undefined, revision: number) => {
    if (revision === beatRevision.current) return
    beatRevision.current = revision
    const recipe = RECIPES[kind]
    if (!recipe.hold) { beat.current = undefined; return }
    beat.current = { recipe, at, started: clock.current, remaining: recipe.hold }
    if (recipe.anticipate && !reducedMotionRef.current) impulse(springs.distance, recipe.anticipate.kick)
    invalidate()
  }, [invalidate, springs])

  useEffect(() => onBeat((next: CameraBeat) => start(next.kind, next.at, next.revision)), [start])

  useEffect(() => onShake((strength) => {
    if (reducedMotion) return
    impulse(punch, strength)
    invalidate()
  }), [invalidate, punch, reducedMotion])

  // Fallback for callers that only hand us a focus point (GameScene still
  // does). A real beat for the same revision always wins because ActionEffects
  // renders earlier in the tree.
  useEffect(() => {
    if (!focus || focusRevision === undefined) return
    start('place', focus, focusRevision)
  }, [focus?.[0], focus?.[1], focusRevision, start])

  const onUserStart = useCallback(() => { userUntil.current = Infinity }, [])
  const onUserEnd = useCallback(() => { userUntil.current = clock.current + 0.6 }, [])

  useFrame((state, rawDelta) => {
    const rig = controls.current
    if (!rig) return
    if (probe) telemetryScene(state.scene, state.gl)
    const delta = clampDelta(rawDelta)
    clock.current += delta

    // While the player is driving, the springs shadow the controls so that
    // handing control back never snaps.
    if (clock.current < userUntil.current) {
      offset.copy(camera.position).sub(rig.target)
      spherical.setFromVector3(offset)
      const framing: Framing = {
        tx: rig.target.x, ty: rig.target.y, tz: rig.target.z,
        distance: spherical.radius, polar: spherical.phi, azimuth: spherical.theta,
        fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : base.current.fov,
      }
      applyFraming(framing)
      base.current = { ...framing, tx: clamp(framing.tx, [-LIMITS.pan, LIMITS.pan]), tz: clamp(framing.tz, [-LIMITS.pan, LIMITS.pan]) }
      beat.current = undefined
      return
    }

    const rest = base.current
    let want: Framing
    let frequency = 0.5
    let ratio = 0.95

    if (reducedMotion) {
      // The accessibility contract, honoured literally: the camera does not
      // move on its own at all. No reframing, no cut, no orbit, no drift, no
      // punch. Whatever the player last set is what they keep looking at.
      applyFraming(cinematic ? { ...rest, polar: HERO.polar, azimuth: HERO.azimuth, distance: rest.distance * HERO.distance, fov: HERO.fov } : rest)
      setSpring(punch, 0)
      spherical.set(
        clamp(springs.distance.value, LIMITS.distance),
        clamp(springs.polar.value, LIMITS.polar),
        clamp(springs.azimuth.value, LIMITS.azimuth),
      )
      rig.target.set(springs.tx.value, springs.ty.value, springs.tz.value)
      camera.position.copy(rig.target).add(offset.setFromSpherical(spherical))
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - springs.fov.value) > 0.001) {
        camera.fov = springs.fov.value
        camera.updateProjectionMatrix()
      }
      camera.lookAt(rig.target)
      rig.update()
      if (probe) probe(spherical, delta)
      return
    }

    if (cinematic) {
      cineTime.current = reducedMotion ? 0 : (cineTime.current + delta) % CINEMATIC_LENGTH
      want = cinematicFraming(rest, cineTime.current, reducedMotion)
      frequency = 1.4
      ratio = 1
    } else {
      const active = beat.current
      if (active) {
        active.remaining -= delta
        if (active.remaining <= 0) beat.current = undefined
      }
      const recipe = active?.recipe
      if (recipe) {
        const since = clock.current - active!.started
        const winding = recipe.anticipate && since < recipe.anticipate.duration
        const scale = winding ? recipe.anticipate!.distance : recipe.distance
        const follow = winding ? 0 : recipe.follow
        const at = active!.at
        want = {
          tx: clamp(rest.tx + (at ? (at[0] - rest.tx) * follow : 0), [-LIMITS.pan, LIMITS.pan]),
          ty: rest.ty + (winding ? 0 : 0.12),
          tz: clamp(rest.tz + (at ? (at[1] - rest.tz) * follow : 0), [-LIMITS.pan, LIMITS.pan]),
          distance: rest.distance * scale,
          polar: rest.polar + (winding ? -recipe.polar * 0.4 : recipe.polar),
          azimuth: rest.azimuth + (winding ? 0 : recipe.azimuth),
          fov: rest.fov + (winding ? 0 : recipe.fov),
        }
        frequency = recipe.frequency
        ratio = recipe.ratio
      } else {
        want = rest
        frequency = 0.56
        ratio = 1
      }
    }

    want = {
      ...want,
      distance: clamp(want.distance, LIMITS.distance),
      polar: clamp(want.polar, LIMITS.polar),
      azimuth: clamp(want.azimuth, LIMITS.azimuth),
      fov: clamp(want.fov, LIMITS.fov),
    }

    for (const key of ['tx', 'ty', 'tz'] as const) stepSpring(springs[key], want[key], frequency * 1.15, Math.min(1, ratio + 0.12), delta)
    stepSpring(springs.distance, want.distance, frequency, ratio, delta)
    stepSpring(springs.polar, want.polar, frequency * 1.1, ratio + 0.05, delta)
    stepSpring(springs.azimuth, want.azimuth, frequency, ratio, delta)
    stepSpring(springs.fov, want.fov, frequency * 1.3, 1, delta)
    stepSpring(punch, 0, 3.1, 0.36, delta)

    // Breathing. Tiny, slow, mutually irrational frequencies so the drift never
    // repeats visibly and a parked board is never dead-still.
    const t = clock.current
    const alive = cinematic ? 0.55 : 1
    const driftAzimuth = alive * (0.019 * Math.sin(t * 0.107) + 0.011 * Math.sin(t * 0.0431 + 1.7))
    const driftPolar = alive * (0.0092 * Math.sin(t * 0.083 + 0.6) + 0.0041 * Math.sin(t * 0.19 + 2.4))
    const driftDistance = alive * (0.17 * Math.sin(t * 0.061 + 2.2) + 0.06 * Math.sin(t * 0.148))

    spherical.set(
      clamp(springs.distance.value + driftDistance + punch.value * 0.42, LIMITS.distance),
      clamp(springs.polar.value + driftPolar, LIMITS.polar),
      clamp(springs.azimuth.value + driftAzimuth, LIMITS.azimuth),
    )
    rig.target.set(springs.tx.value, springs.ty.value + punch.value * 0.06, springs.tz.value)
    camera.position.copy(rig.target).add(offset.setFromSpherical(spherical))
    if (camera instanceof THREE.PerspectiveCamera) {
      const fov = clamp(springs.fov.value - punch.value * 1.9, LIMITS.fov)
      if (Math.abs(camera.fov - fov) > 0.001) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    }
    camera.lookAt(rig.target)
    rig.update()
    if (probe) probe(spherical, delta)
  })

  return <MapControls
    ref={controls}
    makeDefault
    enableDamping
    dampingFactor={0.085}
    enableRotate
    onStart={onUserStart}
    onEnd={onUserEnd}
    minPolarAngle={LIMITS.polar[0]}
    maxPolarAngle={LIMITS.polar[1]}
    minAzimuthAngle={LIMITS.azimuth[0]}
    maxAzimuthAngle={LIMITS.azimuth[1]}
    minDistance={LIMITS.distance[0]}
    maxDistance={LIMITS.distance[1]}
    zoomSpeed={0.6}
    panSpeed={0.45}
  />
}

function cinematicFraming(rest: Framing, time: number, reducedMotion: boolean): Framing {
  if (reducedMotion) return { ...rest, polar: HERO.polar, azimuth: HERO.azimuth, distance: rest.distance * HERO.distance, fov: HERO.fov }
  let elapsed = time
  let index = 0
  while (elapsed >= CINEMATIC[index].duration) {
    elapsed -= CINEMATIC[index].duration
    index = (index + 1) % CINEMATIC.length
  }
  const shot = CINEMATIC[index]
  const previous = CINEMATIC[(index + CINEMATIC.length - 1) % CINEMATIC.length]
  // Each shot spends its first 62% travelling and the rest holding, so the
  // camera arrives at a composition and lets you look at it.
  const travel = shot.ease(saturate(elapsed / (shot.duration * 0.62)))
  const drift = saturate(elapsed / shot.duration) * 0.06
  return {
    tx: rest.tx, ty: rest.ty + 0.25, tz: rest.tz,
    polar: previous.polar + (shot.polar - previous.polar) * travel,
    azimuth: previous.azimuth + (shot.azimuth - previous.azimuth) * travel + drift,
    distance: rest.distance * (previous.distance + (shot.distance - previous.distance) * travel),
    fov: previous.fov + (shot.fov - previous.fov) * travel,
  }
}
