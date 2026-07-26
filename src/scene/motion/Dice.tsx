import { RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { emitShake } from './beats'
import { diceThrowPlan, DIE_HALF as SIZE, FACE_NORMALS, sampleDie, type DiceContact, type DiceThrowPlan } from './diceThrow'
import { Burst, Shockwave } from './Particles'
import { saturate, scaled } from './spring'
import { DICE_LIFE as LIFE } from './timing'

// Two dice, thrown at the board from the player's side of the table.
//
// The trajectory, the bounces, the die-on-die knock and the final teeter all
// come from `diceThrow.ts`, which plans the whole roll once from a seed seeded
// on the roll and the revision. This file only plays the plan back, yaws it to
// face the camera, and hangs dust, shadow and sound cues off its contact list.
//
// The die still cannot show the wrong number: the plan relabels each cube by an
// exact rotational symmetry so its resting face is the engine's value, with a
// face-up dot product of 1.000. See the header of `diceThrow.ts` for why that
// is a construction rather than a correction, and `diceThrow.check.ts` for the
// 8,640-die proof.

const PIP = 0.026

const PIP_GRID: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
}

/** Pip transforms for all six faces of one die, in local space. */
const pipMatrices = () => {
  const dummy = new THREE.Object3D()
  const inset = SIZE - PIP * 0.55
  const step = SIZE * 0.5
  const matrices: THREE.Matrix4[] = []
  for (const [key, grid] of Object.entries(PIP_GRID)) {
    const normal = FACE_NORMALS[Number(key)]
    const basisA = new THREE.Vector3()
    const basisB = new THREE.Vector3()
    if (Math.abs(normal.y) > 0.5) { basisA.set(1, 0, 0); basisB.set(0, 0, 1) }
    else if (Math.abs(normal.x) > 0.5) { basisA.set(0, 1, 0); basisB.set(0, 0, 1) }
    else { basisA.set(1, 0, 0); basisB.set(0, 1, 0) }
    for (const [u, v] of grid) {
      dummy.position.copy(normal).multiplyScalar(inset)
        .addScaledVector(basisA, u * step)
        .addScaledVector(basisB, v * step)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      matrices.push(dummy.matrix.clone())
    }
  }
  return matrices
}

function Pips() {
  const matrices = useMemo(pipMatrices, [])
  return <instancedMesh
    ref={(instance) => {
      if (!instance) return
      matrices.forEach((matrix, index) => instance.setMatrixAt(index, matrix))
      instance.instanceMatrix.needsUpdate = true
    }}
    args={[undefined, undefined, matrices.length]}
    frustumCulled={false}
  >
    <sphereGeometry args={[PIP, 8, 6]} />
    <meshStandardMaterial color="#3a2a1c" roughness={0.55} metalness={0.05} />
  </instancedMesh>
}

// ------------------------------------------------------------------- a die

type DieProps = {
  plan: DiceThrowPlan
  index: number
  ground: number
  reducedMotion: boolean
}

const position = new THREE.Vector3()
const orientation = new THREE.Quaternion()

function Die({ plan, index, ground, reducedMotion }: DieProps) {
  const group = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const started = useRef<number | undefined>(undefined)
  const track = plan.dice[index]

  useFrame(({ clock }) => {
    const node = group.current
    const patch = shadow.current
    if (!node) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)

    if (reducedMotion) {
      // The number is information, so the die is on the table showing it from
      // the first frame: no throw, no tumble, no teeter, nothing that moves.
      // It still clears on the same schedule a rolled die would, so the board
      // does not accumulate dice for anyone who asked for less motion.
      node.position.set(track.rest[0], track.rest[1], track.rest[2])
      node.quaternion.set(...track.restQuaternion)
      node.scale.setScalar(1)
      node.visible = elapsed < LIFE
      if (patch) patch.visible = false
      return
    }

    if (elapsed > LIFE) { node.visible = false; if (patch) patch.visible = false; return }
    node.visible = true

    sampleDie(track, plan, elapsed, position, orientation)
    node.position.copy(position)
    node.quaternion.copy(orientation)

    // The reveal: one short, small swell as the die comes to rest, so the eye
    // is pulled to the number at the exact moment it becomes readable.
    const reveal = saturate((elapsed - plan.duration) / 0.26)
    const swell = reveal > 0 && reveal < 1 ? Math.sin(reveal * Math.PI) * 0.055 : 0

    // Contact darkening. The scene's shadow map only refreshes every few
    // frames, so a fast die outruns its own shadow on the way down. This is a
    // short-range patch that tightens and deepens over the last half metre —
    // close enough to the die to read as contact, not as a second shadow.
    if (patch) {
      const height = saturate((position.y - ground - SIZE) / 0.55)
      patch.visible = height < 1
      patch.position.set(position.x, ground + 0.008, position.z)
      patch.scale.setScalar(SIZE * (1 + height * 0.9))
      ;(patch.material as THREE.MeshBasicMaterial).opacity = (1 - height) ** 1.5 * 0.3
    }

    // Sink and shrink away rather than blinking out.
    const exit = saturate((elapsed - (LIFE - 0.55)) / 0.55)
    node.scale.setScalar(Math.max(0.001, 1 + swell - exit))
    node.position.y -= exit * 0.12
  })

  return <group>
    <group ref={group}>
      <RoundedBox args={[SIZE * 2, SIZE * 2, SIZE * 2]} radius={SIZE * 0.28} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#e4d6b6" roughness={0.46} metalness={0.02} />
      </RoundedBox>
      <Pips />
    </group>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial color="#241a10" transparent opacity={0} depthWrite={false} />
    </mesh>
  </group>
}

// -------------------------------------------------------------- the throw

/**
 * Shoves the camera on the knocks that had weight behind them.
 *
 * A shake on every planned contact would turn a settle into an earthquake, so
 * only the hard ones are passed on, scaled by impact energy: one solid hit as
 * the dice land, a couple of lighter ones as they run out, and nothing at all
 * for the taps at the end.
 */
function ContactShakes({ contacts, reducedMotion }: { contacts: DiceContact[]; reducedMotion: boolean }) {
  const heavy = useMemo(() => contacts.filter((contact) => contact.strength > 0.4), [contacts])
  const started = useRef<number | undefined>(undefined)
  const fired = useRef(0)
  useFrame(({ clock }) => {
    if (reducedMotion) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)
    while (fired.current < heavy.length && heavy[fired.current].time <= elapsed) {
      emitShake(0.025 + heavy[fired.current].strength * 0.1)
      fired.current += 1
    }
  })
  return null
}

export function DiceRoll({ roll, revision, land, reducedMotion }: { roll: [number, number]; revision: number; land: [number, number]; reducedMotion: boolean }) {
  const ground = 0.5
  const camera = useThree((state) => state.camera)

  // The throw is planned in a local frame that releases on -Z and travels to
  // +Z, so one yaw points the whole roll at whoever is watching. A yaw about
  // the vertical axis cannot disturb which face is up, so the guarantee rides
  // through it untouched.
  const yaw = useMemo(() => {
    const dx = camera.position.x - land[0]
    const dz = camera.position.z - land[1]
    return Math.hypot(dx, dz) < 1e-4 ? 0 : Math.atan2(-dx, -dz)
    // Sampled once, at mount: a roll that re-planned itself because the player
    // nudged the camera would not be deterministic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useMemo(() => diceThrowPlan(roll, revision, 0), [roll, revision])

  // Contacts worth spending a particle system on, in world space.
  const cue = useMemo(() => {
    const rotation = new THREE.Matrix4().makeRotationY(yaw)
    const point = new THREE.Vector3()
    return plan.contacts
      .filter((contact) => contact.strength > 0.28)
      .slice(0, 7)
      .map((contact, order) => {
        point.set(contact.at[0], contact.at[1], contact.at[2]).applyMatrix4(rotation)
        return {
          key: `${revision}-${order}`,
          delay: contact.time,
          strength: contact.strength,
          kind: contact.kind,
          at: [land[0] + point.x, ground + point.y, land[1] + point.z] as [number, number, number],
        }
      })
  }, [ground, land, plan, revision, yaw])

  const settle = useMemo(() => {
    const rotation = new THREE.Matrix4().makeRotationY(yaw)
    const point = new THREE.Vector3()
    const spots = plan.dice.map((track) => {
      point.set(track.rest[0], 0, track.rest[2]).applyMatrix4(rotation)
      return [land[0] + point.x, ground, land[1] + point.z] as [number, number, number]
    })
    return { spots }
  }, [ground, land, plan, yaw])

  return <group>
    {/* The roll itself, planned on -Z and yawed to come in from the camera. */}
    <group position={[land[0], ground, land[1]]} rotation={[0, yaw, 0]}>
      {plan.dice.map((_, index) => <Die key={index} plan={plan} index={index} ground={0} reducedMotion={reducedMotion} />)}
    </group>

    {/* Contact cues, already resolved to world space. */}
    <group>
      <ContactShakes contacts={plan.contacts} reducedMotion={reducedMotion} />

      {cue.map((contact) => <group key={contact.key}>
        {/* Grit, not smoke. A 3cm die kicks up specks that stay near the
            table for a third of a second; anything bigger reads as a bug. */}
        <Burst
          id={`dice-grit-${contact.key}`}
          origin={[contact.at[0], contact.at[1] + 0.01, contact.at[2]]}
          count={Math.round(3 + contact.strength * 5)}
          color="#cbb894"
          speed={0.45 + contact.strength * 0.9}
          spread={0.99}
          gravity={5.4}
          life={0.3 + contact.strength * 0.24}
          size={0.011 + contact.strength * 0.007}
          delay={contact.delay}
          reducedMotion={reducedMotion}
        />
        {contact.strength > 0.6 && contact.kind === 'ground'
          ? <Shockwave
            origin={[contact.at[0], contact.at[1] + 0.008, contact.at[2]]}
            color="#e8d6ad"
            radius={0.16 + contact.strength * 0.26}
            life={0.26}
            thickness={0.26}
            delay={contact.delay}
            reducedMotion={reducedMotion}
          />
          : null}
      </group>)}

      {/* The reveal beat. Small on purpose: a player sees this dozens of times
          a match, so it is a nod at the number rather than a firework. */}
      {settle.spots.map((spot, index) => <Shockwave
        key={`reveal-${index}`}
        origin={[spot[0], ground + 0.012, spot[2]]}
        color="#ffdf9e"
        radius={0.3}
        life={0.42}
        thickness={0.14}
        delay={plan.duration + 0.02}
        reducedMotion={reducedMotion}
      />)}
    </group>
  </group>
}
