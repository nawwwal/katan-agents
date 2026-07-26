import * as THREE from 'three'
import { seededFrom } from './spring'

// A thrown pair of dice, planned once and played back.
//
// ---------------------------------------------------------------------------
// The contract: the engine's number, never the physics'.
// ---------------------------------------------------------------------------
//
// This file *does* simulate. It integrates two rigid cubes under gravity with
// real contact impulses, friction and cube-on-cube collision, because a
// scripted parabola cannot produce a die that skids, catches a corner and
// topples. But the number it lands on is still guaranteed by construction, not
// by luck, and there is no retry loop anywhere.
//
// The trick is that a cube has 24 rotational symmetries. Let `s(t)` be the
// simulated orientation and let `s(T)` be its orientation at rest, which is
// flat on some face. Pick `D`, the cube symmetry that carries the *wanted*
// face normal onto whichever body normal `s(T)` happens to leave pointing up.
// Then render the die at
//
//     q(t) = s(t) ⊗ D
//
// Because `D` is an exact symmetry of the cube, `s(t) ⊗ D` occupies the *same
// world-space volume* as `s(t)` at every instant — the simulation's contact
// geometry stays valid frame for frame. And at rest,
//
//     q(T) · faceNormal(value) = s(T) · (D · faceNormal(value))
//                              = s(T) · upBodyNormal
//                              = +Y, exactly.
//
// So the die shows the engine's value with a face-up dot product of 1, for the
// same reason a relabelled die is still a die. The simulation never gets a
// vote; it only decides *how* the number arrives.
//
// ---------------------------------------------------------------------------
// The settle
// ---------------------------------------------------------------------------
//
// The free simulation is cut the moment the die is spent, which leaves it
// tilted by some small angle `α` about a horizontal axis `â`. That residual
// tilt is not corrected away — it is handed to a one-degree-of-freedom teeter
// that pivots the die about its contact edge, lets the last of its angular
// momentum carry it *up* onto that edge, hangs there, and drops it flat with
// one or two clacks. The teeter is `Rot(â, φ) ⊗ flat ⊗ D` with `φ → 0`, so the
// final frame is the exact resting orientation above. That half second is the
// whole point of the roll.

const HALF = 0.155
/** Corner rounding of the rendered `RoundedBox`, so contacts touch where the mesh does. */
const CORNER = HALF * 0.28
const INNER = HALF - CORNER
/** A cube's inertia tensor is isotropic, which makes the impulse maths scalar. */
const INV_INERTIA = 1 / ((2 / 3) * HALF * HALF)
const GRAVITY = 30
const DT = 1 / 240
/** Playback keyframe rate. Sampled once, slerped at draw time. */
export const DICE_SAMPLE_RATE = 120
const MAX_STEPS = Math.ceil(2.8 / DT)

const RESTITUTION = 0.34
const FRICTION = 0.6
const PAIR_RESTITUTION = 0.5
const PAIR_RADIUS = HALF * 1.34

/** Teeter: angular gravity about the contact edge, in rad/s². */
const TEETER_GRAVITY = 34
const TEETER_RESTITUTION = 0.3

/** Local face normals, by pip count. Opposite faces sum to seven. */
export const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
}

const BODY_NORMALS: { value: number; normal: THREE.Vector3 }[] =
  Object.entries(FACE_NORMALS).map(([value, normal]) => ({ value: Number(value), normal }))

const UP = new THREE.Vector3(0, 1, 0)

const clampValue = (value: number) => Math.min(6, Math.max(1, Math.round(value) || 1))

export type ContactKind = 'ground' | 'pair' | 'teeter'

export type DiceContact = {
  /** Seconds from release, in animation time. */
  time: number
  die: number
  kind: ContactKind
  /** 0–1, normalised impact energy. Drives dust, shake and clack level. */
  strength: number
  at: [number, number, number]
}

export type DieTrack = {
  /** Keyframes at `DICE_SAMPLE_RATE`, packed as px,py,pz,qx,qy,qz,qw. */
  frames: Float32Array
  count: number
  /** Local-frame resting centre and final orientation, for reduced motion. */
  rest: [number, number, number]
  restQuaternion: [number, number, number, number]
}

export type DiceThrowPlan = {
  /** Animation seconds from release to the face being final. */
  duration: number
  /** Raw simulated seconds, before the settle window was normalised. */
  rawDuration: number
  timeScale: number
  contacts: DiceContact[]
  dice: DieTrack[]
}

// ------------------------------------------------------------------ helpers

type Body = {
  index: number
  p: THREE.Vector3
  v: THREE.Vector3
  w: THREE.Vector3
  q: THREE.Quaternion
  calm: number
  restAt: number
  frames: number[]
}

const scratch = {
  ax: new THREE.Vector3(),
  ay: new THREE.Vector3(),
  az: new THREE.Vector3(),
  r: new THREE.Vector3(),
  n: new THREE.Vector3(),
  t: new THREE.Vector3(),
  vp: new THREE.Vector3(),
  cross: new THREE.Vector3(),
  impulse: new THREE.Vector3(),
  spin: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
}

/** World-space body axes of a rotation. */
const axesOf = (q: THREE.Quaternion) => {
  scratch.matrix.makeRotationFromQuaternion(q)
  const e = scratch.matrix.elements
  scratch.ax.set(e[0], e[1], e[2])
  scratch.ay.set(e[4], e[5], e[6])
  scratch.az.set(e[8], e[9], e[10])
  return scratch
}

/** Distance from the centre to the lowest point of the rounded cube. */
const supportDrop = (q: THREE.Quaternion) => {
  const { ax, ay, az } = axesOf(q)
  return INNER * (Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y)) + CORNER
}

/** Offset from the centre to that lowest point. */
const supportPoint = (q: THREE.Quaternion, out: THREE.Vector3) => {
  const { ax, ay, az } = axesOf(q)
  out.set(0, 0, 0)
    .addScaledVector(ax, -INNER * Math.sign(ax.y || 1))
    .addScaledVector(ay, -INNER * Math.sign(ay.y || 1))
    .addScaledVector(az, -INNER * Math.sign(az.y || 1))
  out.y -= CORNER
  return out
}

/**
 * One contact impulse: normal restitution plus a Coulomb-clamped tangential
 * impulse. The tangential term is what turns a skid into a roll and a roll
 * into a tumble, so it is the reason the dice look like they have weight.
 */
const applyContact = (body: Body, r: THREE.Vector3, n: THREE.Vector3, restitution: number, friction: number) => {
  const vp = scratch.vp.copy(body.v).add(scratch.cross.copy(body.w).cross(r))
  const vn = vp.dot(n)
  if (vn >= 0) return 0
  const rn = scratch.cross.copy(r).cross(n)
  const jn = -(1 + restitution) * vn / (1 + INV_INERTIA * rn.lengthSq())
  body.v.addScaledVector(n, jn)
  body.w.addScaledVector(scratch.cross.copy(r).cross(scratch.impulse.copy(n).multiplyScalar(jn)), INV_INERTIA)

  vp.copy(body.v).add(scratch.cross.copy(body.w).cross(r))
  const tangent = scratch.t.copy(vp).addScaledVector(n, -vp.dot(n))
  const speed = tangent.length()
  if (speed > 1e-4) {
    tangent.divideScalar(speed)
    const rt = scratch.cross.copy(r).cross(tangent)
    const jt = Math.max(-speed / (1 + INV_INERTIA * rt.lengthSq()), -friction * jn)
    body.v.addScaledVector(tangent, jt)
    body.w.addScaledVector(scratch.cross.copy(r).cross(scratch.impulse.copy(tangent).multiplyScalar(jt)), INV_INERTIA)
  }
  return jn
}

const integrateSpin = (body: Body, dt: number) => {
  const { x, y, z } = body.w
  const q = body.q
  const dx = 0.5 * dt * (x * q.w + y * q.z - z * q.y)
  const dy = 0.5 * dt * (y * q.w + z * q.x - x * q.z)
  const dz = 0.5 * dt * (z * q.w + x * q.y - y * q.x)
  const dw = 0.5 * dt * (-x * q.x - y * q.y - z * q.z)
  q.set(q.x + dx, q.y + dy, q.z + dz, q.w + dw).normalize()
}

const pushFrame = (body: Body) => {
  body.frames.push(body.p.x, body.p.y, body.p.z, body.q.x, body.q.y, body.q.z, body.q.w)
}

// -------------------------------------------------------------------- plan

/**
 * Plan a throw in a local frame: the dice are released low and behind the
 * origin on -Z and travel toward +Z, so the caller only has to yaw the frame
 * to face the camera. Everything is seeded, so the same roll always throws the
 * same way and audio planned from this function lands on the same frames.
 */
export function planDiceThrow(input: [number, number], seed: string, ground = 0, targetDuration = 1.32): DiceThrowPlan {
  // A missing dice event must not be able to throw from inside a render.
  const values: [number, number] = [clampValue(input[0]), clampValue(input[1])]
  const random = seededFrom(seed)
  const contacts: DiceContact[] = []

  const spread = 0.27 + random() * 0.1
  const back = 2.05 + random() * 0.3
  const height = ground + 1.55 + random() * 0.4
  const forward = 4.5 + random() * 0.8
  const rise = 1.15 + random() * 0.7

  const bodies: Body[] = [0, 1].map((index) => {
    const lateral = (index === 0 ? -spread : spread) * (0.85 + random() * 0.4)
    const body: Body = {
      index,
      p: new THREE.Vector3(lateral, height + (random() - 0.5) * 0.22, -back - random() * 0.3),
      v: new THREE.Vector3((random() - 0.5) * 1.5, rise * (0.85 + random() * 0.3), forward * (0.92 + random() * 0.16)),
      // A hand release spins the die on a messy axis, never a clean one.
      w: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
        .normalize()
        .multiplyScalar(15 + random() * 13),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28)),
      calm: 0,
      restAt: Number.POSITIVE_INFINITY,
      frames: [],
    }
    return body
  })

  const sampleEvery = Math.round((1 / DICE_SAMPLE_RATE) / DT)
  const delta = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const inward = new THREE.Vector3()
  const contactPoint = new THREE.Vector3()
  const r1 = new THREE.Vector3()
  const r2 = new THREE.Vector3()

  for (let step = 0; step <= MAX_STEPS; step += 1) {
    const time = step * DT
    if (step % sampleEvery === 0) for (const body of bodies) if (time <= body.restAt) pushFrame(body)
    if (bodies.every((body) => Number.isFinite(body.restAt))) break

    for (const body of bodies) {
      if (Number.isFinite(body.restAt)) continue
      body.v.y -= GRAVITY * DT
      body.p.addScaledVector(body.v, DT)
      integrateSpin(body, DT)
      body.w.multiplyScalar(1 - 0.55 * DT)

      const drop = supportDrop(body.q)
      const penetration = ground + drop - body.p.y
      if (penetration > 0) {
        body.p.y += penetration
        const r = supportPoint(body.q, scratch.r)
        // Restitution bleeds away as the die runs out of energy, so the last
        // contacts read as a settle rather than a trampoline.
        const energy = Math.min(1, body.v.length() / 5)
        const jn = applyContact(body, r, UP, RESTITUTION * (0.35 + 0.65 * energy), FRICTION)
        if (jn > 0.16) {
          contacts.push({
            time,
            die: body.index,
            kind: 'ground',
            strength: Math.min(1, jn / 4.6),
            at: [body.p.x + r.x, ground, body.p.z + r.z],
          })
        }
        // Rolling resistance: a die on felt does not keep spinning forever.
        body.w.multiplyScalar(1 - 13 * DT)
        body.v.x *= 1 - 6.5 * DT
        body.v.z *= 1 - 6.5 * DT
      }

      const settled = penetration > -0.004 && body.v.length() < 0.5 && body.w.length() < 4.2
      body.calm = settled ? body.calm + DT : 0
      if (body.calm > 0.04 && time > 0.42) body.restAt = time
    }

    // Cube-on-cube, as bounding spheres. Cheap, and the only thing that
    // matters is that they knock each other off course instead of ghosting.
    const [a, b] = bodies
    if (!Number.isFinite(a.restAt) || !Number.isFinite(b.restAt)) {
      delta.subVectors(b.p, a.p)
      const distance = delta.length()
      if (distance > 1e-5 && distance < PAIR_RADIUS * 2) {
        normal.copy(delta).divideScalar(distance)
        const overlap = PAIR_RADIUS * 2 - distance
        const movableA = !Number.isFinite(a.restAt)
        const movableB = !Number.isFinite(b.restAt)
        const share = movableA && movableB ? 0.5 : 1
        if (movableA) a.p.addScaledVector(normal, -overlap * share)
        if (movableB) b.p.addScaledVector(normal, overlap * share)
        contactPoint.copy(a.p).addScaledVector(normal, PAIR_RADIUS)
        r1.subVectors(contactPoint, a.p)
        r2.subVectors(contactPoint, b.p)
        const closing = scratch.vp.copy(b.v).sub(a.v).dot(normal)
        if (closing < 0) {
          // `normal` runs a → b, so a is pushed against it and b along it.
          const away = inward.copy(normal).negate()
          const jnA = movableA ? applyContact(a, r1, away, PAIR_RESTITUTION, 0.3) : 0
          const jnB = movableB ? applyContact(b, r2, normal, PAIR_RESTITUTION, 0.3) : 0
          const strength = Math.min(1, Math.max(jnA, jnB) / 3.4)
          if (strength > 0.06) {
            contacts.push({ time, die: movableA ? a.index : b.index, kind: 'pair', strength, at: [contactPoint.x, contactPoint.y, contactPoint.z] })
          }
        }
      }
    }
  }

  for (const body of bodies) if (!Number.isFinite(body.restAt)) body.restAt = MAX_STEPS * DT

  // ------------------------------------------------------------ the settle

  const tracks: DieTrack[] = []
  let rawDuration = 0

  bodies.forEach((body, index) => {
    const value = values[index]
    // Which body face did the simulation leave pointing up?
    let up = BODY_NORMALS[0]
    let best = -2
    const world = new THREE.Vector3()
    for (const candidate of BODY_NORMALS) {
      const dot = world.copy(candidate.normal).applyQuaternion(body.q).y
      if (dot > best) { best = dot; up = candidate }
    }
    // D: the exact cube symmetry that relabels `value` onto that face. Being a
    // symmetry, it changes nothing about the die's world-space geometry.
    const relabel = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[value], up.normal)

    // Residual tilt at cut: the rotation that would lay the die flat.
    const worldUp = world.copy(up.normal).applyQuaternion(body.q).normalize()
    const lay = new THREE.Quaternion().setFromUnitVectors(worldUp, UP)
    const flat = lay.clone().multiply(body.q)
    // Read `lay` as an axis-angle on its short arc, then invert it: the teeter
    // is `lay⁻¹` unwinding to identity, so `Rot(axis, alpha) ⊗ flat` is exactly
    // the orientation the simulation stopped at, and `Rot(axis, 0) ⊗ flat` is
    // exactly flat.
    const sign = lay.w < 0 ? -1 : 1
    const axis = new THREE.Vector3(lay.x, lay.y, lay.z).multiplyScalar(-sign)
    let alpha = 2 * Math.acos(Math.min(1, Math.max(-1, lay.w * sign)))
    if (axis.lengthSq() < 1e-10 || !Number.isFinite(alpha)) {
      // Already dead flat: pick a seeded horizontal edge to rock over.
      const angle = random() * Math.PI * 2
      axis.set(Math.cos(angle), 0, Math.sin(angle))
      alpha = 0
    } else {
      // `lay` maps a near-vertical vector onto +Y, so its axis is horizontal
      // to within rounding. Flatten it anyway; a tilted teeter axis would lift
      // the die off the table.
      axis.y = 0
      if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0)
      axis.normalize()
    }

    // Let the last of the spin carry it up onto the edge, then drop.
    const carried = Math.abs(body.w.dot(axis)) * 0.35
    const peak = Math.min(0.55, Math.max(alpha + 0.08, 0.26 + random() * 0.26))
    const launch = Math.max(carried, Math.sqrt(Math.max(0, 2 * TEETER_GRAVITY * (peak - alpha))))

    // Where the flat die ends up. Solved backwards from the simulated centre
    // so the teeter is continuous with the last simulated frame.
    const pivot = new THREE.Vector3()
    const rotated = new THREE.Vector3()
    const spin = new THREE.Quaternion()
    const side = new THREE.Vector3().crossVectors(axis, UP).normalize()
    const edgeFor = (phi: number, out: THREE.Vector3) => {
      spin.setFromAxisAngle(axis, phi)
      let bestY = Number.POSITIVE_INFINITY
      for (const sign of [1, -1]) {
        pivot.copy(side).multiplyScalar(INNER * sign)
        pivot.y = -INNER
        rotated.copy(pivot).applyQuaternion(spin)
        if (rotated.y < bestY) { bestY = rotated.y; out.copy(pivot) }
      }
      return out
    }
    const edge = edgeFor(alpha, new THREE.Vector3())
    const shifted = edge.clone().applyQuaternion(spin.setFromAxisAngle(axis, alpha))
    const centre = new THREE.Vector3(
      body.p.x - (edge.x - shifted.x),
      ground + HALF,
      body.p.z - (edge.z - shifted.z),
    )

    // Integrate the one-degree-of-freedom teeter to zero, exactly.
    let phi = alpha
    let rate = launch
    let time = body.restAt
    const step = 1 / DICE_SAMPLE_RATE
    const tilt = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const edgeNow = new THREE.Vector3()
    let guard = 0
    while (guard < 400) {
      guard += 1
      // Sub-step so a clack never lands between keyframes.
      for (let sub = 0; sub < 8; sub += 1) {
        rate -= TEETER_GRAVITY * (step / 8)
        phi += rate * (step / 8)
        if (phi <= 0) {
          phi = 0
          if (rate < -0.55) {
            contacts.push({
              time: time + (sub + 1) * (step / 8),
              die: index,
              kind: 'teeter',
              strength: Math.min(0.85, Math.abs(rate) / 5.5),
              at: [body.p.x, ground, body.p.z],
            })
            rate = -rate * TEETER_RESTITUTION
          } else {
            rate = 0
          }
        }
      }
      time += step
      tilt.setFromAxisAngle(axis, phi)
      const orientation = tilt.clone().multiply(flat)
      edgeFor(phi, edgeNow)
      rotated.copy(edgeNow).applyQuaternion(tilt)
      position.set(
        centre.x + edgeNow.x - rotated.x,
        ground + supportDrop(orientation),
        centre.z + edgeNow.z - rotated.z,
      )
      body.frames.push(position.x, position.y, position.z, orientation.x, orientation.y, orientation.z, orientation.w)
      if (phi === 0 && rate === 0) break
    }

    // The last keyframe is the exact resting orientation, by construction.
    const settled = flat.clone()
    body.frames.push(centre.x, ground + HALF, centre.z, settled.x, settled.y, settled.z, settled.w)
    time += step

    // Fold the relabel into every stored orientation. It is a cube symmetry,
    // so the world-space box the simulation collided with is unchanged.
    const frames = new Float32Array(body.frames.length)
    const q = new THREE.Quaternion()
    for (let i = 0; i < body.frames.length; i += 7) {
      frames[i] = body.frames[i]
      frames[i + 1] = body.frames[i + 1]
      frames[i + 2] = body.frames[i + 2]
      q.set(body.frames[i + 3], body.frames[i + 4], body.frames[i + 5], body.frames[i + 6]).multiply(relabel)
      frames[i + 3] = q.x
      frames[i + 4] = q.y
      frames[i + 5] = q.z
      frames[i + 6] = q.w
    }

    rawDuration = Math.max(rawDuration, time)
    tracks.push({
      frames,
      count: frames.length / 7,
      rest: [centre.x, ground + HALF, centre.z],
      restQuaternion: [frames[frames.length - 4], frames[frames.length - 3], frames[frames.length - 2], frames[frames.length - 1]],
    })
  })

  // Recentre on the landing point. A skid that runs long is good motion and a
  // terrible place to leave a die — the target is one hex of desert, and two
  // hexes away is inside a mountain. Sliding the whole plan (release included,
  // and it is in the air anyway) keeps every skid and every bounce exactly as
  // simulated while guaranteeing the pair comes to rest straddling the mark.
  const centreX = tracks.reduce((total, track) => total + track.rest[0], 0) / tracks.length
  const centreZ = tracks.reduce((total, track) => total + track.rest[2], 0) / tracks.length
  for (const track of tracks) {
    for (let i = 0; i < track.frames.length; i += 7) {
      track.frames[i] -= centreX
      track.frames[i + 2] -= centreZ
    }
    track.rest[0] -= centreX
    track.rest[2] -= centreZ
  }
  for (const contact of contacts) {
    contact.at[0] -= centreX
    contact.at[2] -= centreZ
  }

  // Normalise the settle window. The simulation is allowed to vary, but only
  // inside a band, so the reveal beat and the production motes stay on time.
  const timeScale = Math.min(1.14, Math.max(0.78, targetDuration / Math.max(rawDuration, 0.2)))
  for (const contact of contacts) contact.time *= timeScale

  return {
    duration: rawDuration * timeScale,
    rawDuration,
    timeScale,
    contacts: coalesce(contacts),
    dice: tracks,
  }
}

/**
 * A cube toppling over a corner really does hit the table four times in forty
 * milliseconds. That is honest physics and terrible audio, so hits from the
 * same die inside one window collapse into the loudest of them. What survives
 * is the set of knocks a person would actually hear.
 */
const COALESCE_WINDOW = 0.055
const AUDIBLE = 0.11

function coalesce(contacts: DiceContact[]): DiceContact[] {
  const kept: DiceContact[] = []
  for (const contact of contacts.slice().sort((a, b) => a.time - b.time)) {
    if (contact.strength < AUDIBLE) continue
    const previous = kept.findLast((candidate) => candidate.die === contact.die)
    if (previous && contact.time - previous.time < COALESCE_WINDOW) {
      if (contact.strength > previous.strength) {
        previous.strength = contact.strength
        previous.kind = contact.kind
        previous.at = contact.at
      }
      continue
    }
    kept.push({ ...contact })
  }
  return kept
}

// ------------------------------------------------------------------ readout

const sampleQuaternion = new THREE.Quaternion()
const nextQuaternion = new THREE.Quaternion()

/** Read a track at animation time `t`, writing into `position` and `quaternion`. */
export function sampleDie(track: DieTrack, plan: DiceThrowPlan, t: number, position: THREE.Vector3, quaternion: THREE.Quaternion) {
  const raw = Math.max(0, t / plan.timeScale) * DICE_SAMPLE_RATE
  const index = Math.min(track.count - 1, Math.floor(raw))
  const next = Math.min(track.count - 1, index + 1)
  const blend = index === next ? 0 : raw - index
  const a = index * 7
  const b = next * 7
  position.set(
    track.frames[a] + (track.frames[b] - track.frames[a]) * blend,
    track.frames[a + 1] + (track.frames[b + 1] - track.frames[a + 1]) * blend,
    track.frames[a + 2] + (track.frames[b + 2] - track.frames[a + 2]) * blend,
  )
  sampleQuaternion.set(track.frames[a + 3], track.frames[a + 4], track.frames[a + 5], track.frames[a + 6])
  if (blend > 0) {
    nextQuaternion.set(track.frames[b + 3], track.frames[b + 4], track.frames[b + 5], track.frames[b + 6])
    sampleQuaternion.slerp(nextQuaternion, blend)
  }
  quaternion.copy(sampleQuaternion)
}

/** Stable id for one roll, shared by the renderer and the audio scheduler. */
export const diceSeed = (roll: readonly [number, number], revision: number) => `dice-${revision}-${roll[0]}-${roll[1]}`

const planCache = new Map<string, DiceThrowPlan>()

/** Memoised plan, so the audio hook and the renderer agree to the frame. */
export function diceThrowPlan(roll: readonly [number, number], revision: number, ground = 0.5): DiceThrowPlan {
  const seed = diceSeed(roll, revision)
  const key = `${seed}-${ground}`
  const cached = planCache.get(key)
  if (cached) return cached
  const plan = planDiceThrow([roll[0], roll[1]], seed, ground)
  if (planCache.size > 24) planCache.clear()
  planCache.set(key, plan)
  return plan
}

export { HALF as DIE_HALF }
