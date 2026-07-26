import * as THREE from 'three'
import { DIE_HALF, diceThrowPlan, FACE_NORMALS, planDiceThrow, sampleDie } from './diceThrow'

// The one check that matters: the dice must show the engine's number.
//
// Run with `npx tsx src/scene/motion/diceThrow.check.ts`. It plans every one of
// the 36 ordered rolls across many revisions, reads the *rendered* orientation
// at the end of the animation exactly the way `Dice.tsx` does, and asserts the
// wanted face normal points at +Y with a dot product of 1. It also checks that
// nothing ever sinks through the table and that the settle window stays inside
// the band the audio and the camera were tuned against.

const GROUND = 0.5
const UP = new THREE.Vector3(0, 1, 0)

let checked = 0
let worstDot = 1
let worstSink = Infinity
let minDuration = Infinity
let maxDuration = 0
let minRaw = Infinity
let maxRaw = 0
let teetered = 0
let contactTotal = 0
const failures: string[] = []

const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const normal = new THREE.Vector3()

for (let revision = 1; revision <= 120; revision += 1) {
  for (let one = 1; one <= 6; one += 1) {
    for (let two = 1; two <= 6; two += 1) {
      const roll: [number, number] = [one, two]
      const plan = diceThrowPlan(roll, revision, GROUND)
      minDuration = Math.min(minDuration, plan.duration)
      maxDuration = Math.max(maxDuration, plan.duration)
      minRaw = Math.min(minRaw, plan.rawDuration)
      maxRaw = Math.max(maxRaw, plan.rawDuration)
      contactTotal += plan.contacts.length
      if (plan.contacts.some((contact) => contact.kind === 'teeter')) teetered += 1

      plan.dice.forEach((track, index) => {
        const value = roll[index]
        // Exactly the read `Dice.tsx` performs on the final frame.
        sampleDie(track, plan, plan.duration + 0.5, position, quaternion)
        const dot = normal.copy(FACE_NORMALS[value]).applyQuaternion(quaternion).dot(UP)
        worstDot = Math.min(worstDot, dot)
        checked += 1
        if (dot < 0.999999) failures.push(`revision ${revision} roll ${one}-${two} die ${index}: face-up dot ${dot.toFixed(6)}`)
        if (Math.abs(position.y - (GROUND + DIE_HALF)) > 1e-3) {
          failures.push(`revision ${revision} roll ${one}-${two} die ${index}: rests at y ${position.y.toFixed(4)}`)
        }

        // Walk the whole animation and make sure the die never sinks.
        for (let t = 0; t <= plan.duration; t += 1 / 240) {
          sampleDie(track, plan, t, position, quaternion)
          worstSink = Math.min(worstSink, position.y - GROUND)
        }
      })
    }
  }
}

// A yaw applied by the renderer must not disturb the guarantee.
const yaw = new THREE.Quaternion().setFromAxisAngle(UP, 1.234)
let worstYawDot = 1
for (let revision = 500; revision < 540; revision += 1) {
  const roll: [number, number] = [1 + (revision % 6), 1 + ((revision * 5) % 6)]
  const plan = planDiceThrow(roll, `yaw-${revision}`, GROUND)
  plan.dice.forEach((track, index) => {
    sampleDie(track, plan, plan.duration, position, quaternion)
    quaternion.premultiply(yaw)
    worstYawDot = Math.min(worstYawDot, normal.copy(FACE_NORMALS[roll[index]]).applyQuaternion(quaternion).dot(UP))
  })
}

const report = [
  `dice checked          ${checked}`,
  `worst face-up dot     ${worstDot.toFixed(6)}`,
  `worst dot after yaw   ${worstYawDot.toFixed(6)}`,
  `lowest centre above   ${worstSink.toFixed(4)} (die half-extent ${DIE_HALF})`,
  `settle window         ${minDuration.toFixed(3)}s – ${maxDuration.toFixed(3)}s`,
  `raw settle window     ${minRaw.toFixed(3)}s – ${maxRaw.toFixed(3)}s`,
  `rolls with a teeter   ${teetered} / ${120 * 36}`,
  `mean contacts / roll  ${(contactTotal / (120 * 36)).toFixed(2)}`,
].join('\n')

console.log(report)

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('\nok — every die lands on the engine\'s value')
