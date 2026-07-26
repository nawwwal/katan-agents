// The second channel.
//
// `beats.ts` reports the past: something landed, something was won, go and
// look at it. It is emitted from a `useEffect` on the presentation revision,
// which means the only sentence it can form is "that happened". There was no
// way at all to say "this is now possible", and that single absence is why the
// camera never moved until after a commit, why arming a build mode changed
// nothing on the board, and why the robber sat unlit on a tile the player
// could not find.
//
// A prompt is the other half. It fires on the *edge* where a decision opens,
// not on the event that closes one, and it stays current for as long as the
// decision does. Three things consume it:
//
//   CameraRig      frames the subject of the decision while it is still open
//   the board      lights the family of targets the decision is about
//   the robber     arms, and knows when to stop being armed
//
// Everything here is presentation. Nothing in this file may write game state,
// and nothing that reads it may treat a prompt as permission — the server is
// still the only thing that decides what is legal.

/** Which decision is open. `none` is a real value: the board is not asking. */
export type PromptKind =
  | 'none'
  | 'roll'
  | 'place'
  | 'robber'
  | 'discard'
  | 'victim'
  | 'trade'

/**
 * Which family of board target the prompt offers, when it offers one.
 *
 * Separate from `kind` because `place` covers four different marker families
 * and each arrives with its own stagger. `hex` is the robber's.
 */
export type PromptFamily = 'settlement' | 'road' | 'city' | 'hex'

export type Prompt = {
  kind: PromptKind
  family?: PromptFamily
  /** Board point the decision is about, when there is one. */
  at?: [number, number]
  /** Board ids the player can act on, for highlight-follows-focus. */
  targets?: string[]
  /**
   * A committed action is in flight. The decision has not reopened and it has
   * not resolved either, so listeners hold their last state at reduced
   * strength rather than clearing it. A board that empties for the length of a
   * round trip reads as a click that failed.
   */
  sending: boolean
  /** Bumped on every emit that changes anything, so React listeners rerender. */
  revision: number
  /**
   * Seconds on the shared performance clock at the moment this decision
   * opened. The stagger clock: markers arrive relative to it rather than to
   * their own mount, so a set that gains one late member does not restart.
   *
   * Deliberately *not* reset by `sending` flipping. A round trip is not a new
   * question, and re-running a 400ms arrival on every submit would be the
   * blink this channel exists to remove.
   */
  since: number
}

const EMPTY: Prompt = { kind: 'none', sending: false, revision: 0, since: 0 }

let current: Prompt = EMPTY

type Listener = (prompt: Prompt) => void
const listeners = new Set<Listener>()

const now = () => (typeof performance === 'undefined' ? 0 : performance.now() / 1000)

/** Two prompts are the same question if they offer the same thing about the same place. */
const sameQuestion = (a: Prompt, b: Prompt) =>
  a.kind === b.kind
  && a.family === b.family
  && a.at?.[0] === b.at?.[0]
  && a.at?.[1] === b.at?.[1]
  && a.targets?.length === b.targets?.length
  && (a.targets ?? []).every((id, index) => b.targets?.[index] === id)

export type PromptInput = Omit<Prompt, 'revision' | 'since' | 'sending'> & { sending?: boolean }

/**
 * State the current decision. Idempotent: emitting the same question twice
 * changes nothing and notifies nobody, so callers are free to run this from an
 * effect that fires on every revision.
 */
export const emitPrompt = (input: PromptInput) => {
  const next: Prompt = {
    ...input,
    sending: Boolean(input.sending),
    revision: current.revision + 1,
    since: current.since,
  }
  const opened = !sameQuestion(current, next)
  if (!opened && next.sending === current.sending) return current
  if (opened) next.since = now()
  current = next
  for (const listener of listeners) listener(next)
  return next
}

export const clearPrompt = () => emitPrompt({ kind: 'none' })

/** Read without subscribing — the `useFrame` path, called sixty times a second. */
export const latestPrompt = () => current

/** Seconds since the current decision opened. The stagger clock. */
export const promptElapsed = () => (current.kind === 'none' ? 0 : now() - current.since)

export const onPrompt = (listener: Listener) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Stagger, as one shared curve.
 *
 * Markers arrive ordered by distance from board centre so the set unfurls
 * outward instead of popping on one frame. `step` is deliberately small: the
 * whole point is that fifty markers take four hundred milliseconds, not four
 * seconds. Returns 0 before this marker's turn and 1 once it has fully landed;
 * the caller decides what to do with the middle, because a road overshoots
 * along its length and a pad overshoots in plan.
 */
export const STAGGER_STEP = 0.012
const STAGGER_RISE = 0.26

export const staggerProgress = (elapsed: number, rank: number, reducedMotion: boolean) => {
  if (reducedMotion) return 1
  return Math.min(1, Math.max(0, (elapsed - rank * STAGGER_STEP) / STAGGER_RISE))
}

/**
 * The arrival curve itself: a scale from nothing to slightly past one and back.
 * Kept here rather than in `spring.ts` because it is specific to "a marker the
 * board just offered you", and every family has to use the same one or the
 * board answers in two accents.
 */
export const arrivalScale = (progress: number) => {
  if (progress >= 1) return 1
  if (progress <= 0) return 0
  // Back-out with a small overshoot. The constants are the standard pair minus
  // a third of the kick: a marker that visibly bounces reads as jelly, and
  // there are fifty of them.
  const t = progress - 1
  return 1 + 2.2 * t ** 3 + 1.2 * t ** 2
}
