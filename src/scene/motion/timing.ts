// One clock for the whole feedback system. The dice animation, the impact
// particles and the audio all read these, so a sound never lands on a frame
// where nothing happened.

/**
 * Dice: the settle window the rest of the app is tuned against.
 *
 * The throw itself is simulated, so a given roll finishes somewhere in
 * `DICE_SETTLE_RANGE` rather than on a fixed beat — a die that skids finishes
 * later than one that lands dead. Anything that has to line up with an actual
 * bounce reads the plan instead of a constant: `diceThrowPlan(roll, revision)`
 * returns the real contact times, and both `Dice.tsx` and `useGameAudio` call
 * it, so the knock and the dust are on the same frame by construction.
 *
 * `DICE_SETTLE` is the worst case. Use it only where being early would be
 * wrong and being a little late is fine.
 */
export const DICE_SETTLE_TARGET = 1.32
export const DICE_SETTLE_RANGE = [0.93, 1.33] as const
export const DICE_SETTLE = DICE_SETTLE_RANGE[1]

/** Dice: shrink away and clear the board. Matches the camera's `roll` hold. */
export const DICE_LIFE = 3.1

/** Resource motes start once the rolled number has had its beat. */
export const PRODUCTION_DELAY = 1.66

/** A dropped piece touches down: anticipation plus fall from `placement.ts`. */
export const CONTACT = 0.37
