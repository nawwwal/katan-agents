// One clock for the whole feedback system. The dice animation, the impact
// particles and the audio all read these, so a sound never lands on a frame
// where nothing happened.

/** Dice: airborne from throw to first contact. */
export const DICE_FLIGHT = 0.62
/** Dice: spin fully decayed and the face is final. */
export const DICE_SETTLE = 1.16
/** Dice: shrink away and clear the board. */
export const DICE_LIFE = 3.1
/** Dice: the two decaying hops after first contact, as offsets from throw. */
export const DICE_BOUNCES = [DICE_FLIGHT, DICE_FLIGHT + 0.29, DICE_FLIGHT + 0.47]

/** Resource motes start once the rolled number is readable. */
export const PRODUCTION_DELAY = 1.35

/** A dropped piece touches down: anticipation plus fall from `placement.ts`. */
export const CONTACT = 0.37
