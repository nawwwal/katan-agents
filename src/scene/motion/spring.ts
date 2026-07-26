// Shared motion maths for the Katan camera, placement and effect systems.
//
// Everything here is deterministic: seeds come from stable board ids, never
// `Math.random()`. Springs are integrated with fixed substeps so a dropped
// frame cannot make a stiff spring explode.

export type Spring = { value: number; velocity: number }

export const spring = (value = 0): Spring => ({ value, velocity: 0 })

const SUBSTEP = 1 / 120
const MAX_SUBSTEPS = 8

/**
 * Damped harmonic oscillator.
 *
 * `frequency` is the undamped natural frequency in Hz — how fast the thing
 * wants to move. `ratio` is the damping ratio: 1 is critically damped (no
 * overshoot), 0.7 gives a ~5% overshoot and one clean settle, 0.4 rings.
 */
export const stepSpring = (state: Spring, target: number, frequency: number, ratio: number, dt: number) => {
  const omega = 2 * Math.PI * frequency
  const stiffness = omega * omega
  const damping = 2 * ratio * omega
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SUBSTEP)))
  const h = dt / steps
  for (let index = 0; index < steps; index += 1) {
    state.velocity += (-stiffness * (state.value - target) - damping * state.velocity) * h
    state.value += state.velocity * h
  }
  return state.value
}

/** Snap a spring with no motion — the reduced-motion path. */
export const setSpring = (state: Spring, value: number) => {
  state.value = value
  state.velocity = 0
  return value
}

/** Kick a spring's velocity: impacts, punches, recoil. */
export const impulse = (state: Spring, amount: number) => {
  state.velocity += amount
}

export const clampDelta = (delta: number) => Math.min(delta, 1 / 24)

/**
 * Global time scale for effect clocks. Always 1 unless `?motionSpeed=` is set
 * on the visual-QA route — a 0.4s dust puff cannot be graded from a screenshot
 * tool with a half-second round trip, so QA can run the same curves slowly.
 */
export const MOTION_SPEED = (() => {
  if (typeof window === 'undefined') return 1
  const raw = Number(new URLSearchParams(window.location.search).get('motionSpeed'))
  return Number.isFinite(raw) && raw > 0 ? raw : 1
})()

/** Effect-local elapsed time, in the scale above. */
export const scaled = (seconds: number) => seconds * MOTION_SPEED

// ---------------------------------------------------------------- easing

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
export const easeOutQuart = (t: number) => 1 - (1 - t) ** 4
export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5
export const easeInQuad = (t: number) => t * t
export const easeInOutSine = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2
export const saturate = (t: number) => Math.min(1, Math.max(0, t))
export const range = (value: number, from: number, to: number) => saturate((value - from) / (to - from))
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Falls off from 1 to 0 over the tail of a window — used to fade effects out. */
export const fadeOut = (elapsed: number, life: number, tail: number) => saturate((life - elapsed) / tail)

// ---------------------------------------------------------------- seeding

export const hashSeed = (text: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, good enough for scatter and tumble. */
export const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const seededFrom = (id: string) => seededRandom(hashSeed(id))
