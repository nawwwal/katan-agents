// One state machine for moving the robber, with three ways in.
//
// Drag is the right gesture here and only here: the robber is the only board
// action where the thing being moved already exists on screen, and the only
// one where where it is leaving matters as much as where it lands. But a
// drag-only affordance is an accessibility regression dressed as a feature, so
// pointer, tap and keyboard all drive this same object. They share the armed
// state, the same candidate, the same commit, and the same refusal.
//
// It lives in a module rather than in React state because the three entry
// points are in three different trees: the pointer is on a mesh inside the
// canvas, the tap-target hexes are nineteen sibling meshes, and the keyboard
// handles are `.board-targets` buttons in the DOM outside the canvas
// altogether. Prop-drilling a shared machine through all three is how you end
// up with three machines. `beats.ts` set the precedent for this shape.

export type RobberStage =
  /** The phase is open and the piece is lit, but nobody has touched it. */
  | 'called'
  /** Picked up. Waiting for a destination, whatever the input. */
  | 'armed'
  /** Armed, and a pointer is down and moving. A strict subset of armed. */
  | 'dragging'
  /** Dropped and submitted; the server has not answered yet. */
  | 'sending'
  /** Not the viewer's problem. */
  | 'idle'

export type RobberPose = {
  stage: RobberStage
  /**
   * Where the piece is being held, in board space, while a pointer drags it.
   * Undefined at every other stage, where the piece belongs to a hex.
   */
  held?: [number, number]
  /** The hex a commit would land on. Undefined over water, HUD or its own tile. */
  candidateHexId?: string
  /** Where the piece must spring back to if this is refused. */
  originHexId?: string
  revision: number
}

const IDLE: RobberPose = { stage: 'idle', revision: 0 }

let current: RobberPose = IDLE

type Listener = (pose: RobberPose) => void
const listeners = new Set<Listener>()

export const robberPose = () => current

export const setRobberPose = (patch: Partial<Omit<RobberPose, 'revision'>>) => {
  const next: RobberPose = { ...current, ...patch, revision: current.revision + 1 }
  // Held is a live pointer position and changes every frame; everything else is
  // discrete. Only notify React when something discrete moved, or a drag would
  // rerender nineteen tiles sixty times a second. The piece itself reads
  // `robberPose()` directly from `useFrame` and never needs the notification.
  const quiet = next.stage === current.stage
    && next.candidateHexId === current.candidateHexId
    && next.originHexId === current.originHexId
  current = next
  if (quiet) return next
  for (const listener of listeners) listener(next)
  return next
}

export const onRobberPose = (listener: Listener) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** True when the piece is picked up, by any of the three inputs. */
export const robberArmed = () => current.stage === 'armed' || current.stage === 'dragging'

/**
 * Refusals are a one-shot: a horizontal shake and the spring home. The piece
 * owns the animation, so this is only the trigger, and it carries a token so a
 * second refusal during the first one still reads.
 */
let refusals = 0
const refusalListeners = new Set<(token: number) => void>()

export const refuseRobber = () => {
  refusals += 1
  for (const listener of refusalListeners) listener(refusals)
}

export const onRobberRefused = (listener: (token: number) => void) => {
  refusalListeners.add(listener)
  return () => { refusalListeners.delete(listener) }
}
