// A one-way channel from "something happened in the game" to "the camera
// reacts". ActionEffects knows the presentation; CameraRig knows the camera.
// Neither should have to grow a prop for the other, and GameScene should not
// have to be edited to wire them together, so they meet here.

export type BeatKind =
  | 'roll'
  | 'handoff'
  | 'place'
  | 'city'
  | 'robber'
  | 'trade'
  | 'award'
  | 'victory'
  | 'quiet'

export type CameraBeat = {
  kind: BeatKind
  /** Presentation revision that produced the beat; dedupes the focus fallback. */
  revision: number
  /** Board-space point the beat happened at, when there is one. */
  at?: [number, number]
}

type Listener = (beat: CameraBeat) => void

const listeners = new Set<Listener>()
let latest: CameraBeat | undefined

export const emitBeat = (beat: CameraBeat) => {
  latest = beat
  for (const listener of listeners) listener(beat)
}

export const latestBeat = () => latest

export const onBeat = (listener: Listener) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Impact impulses are separate from framing beats: a dice landing or a
// settlement hitting the ground should shove the camera without retargeting it.
type Shake = (strength: number) => void
const shakes = new Set<Shake>()

export const emitShake = (strength: number) => {
  for (const shake of shakes) shake(strength)
}

export const onShake = (shake: Shake) => {
  shakes.add(shake)
  return () => { shakes.delete(shake) }
}
