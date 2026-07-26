import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { emitShake } from './beats'
import { Burst, Shockwave } from './Particles'
import { easeOutQuart, saturate, scaled, seededFrom } from './spring'
import { DICE_FLIGHT as FLIGHT, DICE_LIFE as LIFE, DICE_SETTLE as SETTLE } from './timing'

// The engine decides the roll. This is a puppet show that is contractually
// obliged to end on the number it was handed.
//
// The tumble is scripted, not simulated: orientation is
// `target * spin(t)` where `spin(1) = identity`, so at the end of the
// animation the die is *exactly* on its face by construction. There is no
// physics solver to disagree with the game state, and no retry loop pretending
// to be one. A dice library here would be a lie with extra steps.

const SIZE = 0.155
const PIP = 0.026

/** Local face normals, by pip count. Opposite faces sum to seven. */
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
}

const PIP_GRID: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
}

const UP = new THREE.Vector3(0, 1, 0)

/** Orientation that puts `value` face up, with a seeded yaw so it never twins. */
const restingQuaternion = (value: number, yaw: number) => {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[value], UP)
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(quaternion)
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
  const mesh = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(pipMatrices, [])
  useMemo(() => matrices, [matrices])
  return <instancedMesh
    ref={(instance) => {
      mesh.current = instance
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

type DieProps = {
  value: number
  seed: string
  land: [number, number, number]
  reducedMotion: boolean
  onImpact: (at: [number, number, number], strength: number) => void
}

function Die({ value, seed, land, reducedMotion, onImpact }: DieProps) {
  const group = useRef<THREE.Group>(null)
  const started = useRef<number | undefined>(undefined)
  const bounced = useRef(0)

  const plan = useMemo(() => {
    const random = seededFrom(seed)
    const throwAngle = Math.PI * 0.62 + random() * Math.PI * 0.5
    return {
      from: new THREE.Vector3(
        land[0] + Math.cos(throwAngle) * (1.5 + random() * 0.7),
        land[1] + 2.4 + random() * 0.5,
        land[2] + Math.sin(throwAngle) * (1.5 + random() * 0.7),
      ),
      target: restingQuaternion(value, random() * Math.PI * 2),
      axisA: new THREE.Vector3(random() - 0.5, random() * 0.4 - 0.2, random() - 0.5).normalize(),
      axisB: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      turnsA: 3 + Math.floor(random() * 3),
      turnsB: 1 + Math.floor(random() * 2),
      arc: 0.9 + random() * 0.5,
      // Two decaying hops after the first contact.
      hops: [0.42 + random() * 0.12, 0.17 + random() * 0.06],
    }
  }, [land, seed, value])

  const spinA = useMemo(() => new THREE.Quaternion(), [])
  const spinB = useMemo(() => new THREE.Quaternion(), [])

  useFrame(({ clock }) => {
    const node = group.current
    if (!node) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)

    if (reducedMotion) {
      node.position.set(land[0], land[1], land[2])
      node.quaternion.copy(plan.target)
      node.visible = true
      return
    }

    if (elapsed > LIFE) { node.visible = false; return }
    node.visible = true

    // --- position: one throw, then two decaying hops.
    if (elapsed < FLIGHT) {
      const t = elapsed / FLIGHT
      node.position.lerpVectors(plan.from, new THREE.Vector3(...land), t)
      node.position.y += Math.sin(t * Math.PI) * plan.arc
    } else {
      let hopTime = elapsed - FLIGHT
      let height = plan.hops[0]
      let index = 0
      // Each hop lasts as long as the ballistic time for its height.
      let duration = Math.sqrt(height / 4.9) * 2
      while (index < plan.hops.length && hopTime > duration) {
        hopTime -= duration
        index += 1
        if (bounced.current <= index) {
          bounced.current = index + 1
          onImpact([land[0], land[1], land[2]], index === 0 ? 0.06 : 0.03)
        }
        height = plan.hops[index] ?? 0
        duration = height ? Math.sqrt(height / 4.9) * 2 : 1
      }
      if (bounced.current === 0) {
        bounced.current = 1
        onImpact([land[0], land[1], land[2]], 0.12)
      }
      const lift = height ? Math.max(0, height * Math.sin(saturate(hopTime / duration) * Math.PI)) : 0
      node.position.set(land[0], land[1] + lift, land[2])
    }

    // --- orientation: spin that decays to exactly zero, so the target face is
    // guaranteed rather than hoped for.
    const u = saturate(elapsed / SETTLE)
    const decay = 1 - easeOutQuart(u)
    spinA.setFromAxisAngle(plan.axisA, plan.turnsA * Math.PI * 2 * decay)
    spinB.setFromAxisAngle(plan.axisB, plan.turnsB * Math.PI * 2 * decay)
    node.quaternion.copy(plan.target).multiply(spinA).multiply(spinB)

    // --- a last settle wobble once it is down, then dead still.
    if (u >= 1) {
      const rest = saturate((elapsed - SETTLE) / 0.4)
      const wobble = (1 - rest) ** 2 * 0.05 * Math.sin((elapsed - SETTLE) * 34)
      node.rotateOnAxis(plan.axisA, wobble)
    }

    // --- sink and shrink away rather than blinking out.
    const exit = saturate((elapsed - (LIFE - 0.55)) / 0.55)
    node.scale.setScalar(Math.max(0.001, 1 - exit))
    node.position.y -= exit * 0.12
  })

  return <group ref={group} position={plan.from} scale={reducedMotion ? 1 : 1}>
    <RoundedBox args={[SIZE * 2, SIZE * 2, SIZE * 2]} radius={SIZE * 0.28} smoothness={3} castShadow receiveShadow>
      <meshStandardMaterial color="#e4d6b6" roughness={0.46} metalness={0.02} />
    </RoundedBox>
    <Pips />
  </group>
}

export function DiceRoll({ roll, revision, land, reducedMotion }: { roll: [number, number]; revision: number; land: [number, number]; reducedMotion: boolean }) {
  const ground = 0.5
  const spots = useMemo<[number, number, number][]>(() => [
    [land[0] - 0.31, ground + SIZE, land[1] - 0.2],
    [land[0] + 0.29, ground + SIZE, land[1] + 0.24],
  ], [land, ground])

  const onImpact = (_at: [number, number, number], strength: number) => emitShake(strength)

  return <group>
    {spots.map((spot, index) => <Die
      key={index}
      value={roll[index]}
      seed={`dice-${revision}-${index}`}
      land={spot}
      reducedMotion={reducedMotion}
      onImpact={onImpact}
    />)}
    {spots.map((spot, index) => <group key={`fx-${index}`}>
      <Shockwave origin={[spot[0], ground + 0.012, spot[2]]} color="#f6e6c0" radius={0.62} life={0.5} thickness={0.16} delay={FLIGHT} reducedMotion={reducedMotion} />
      <Burst
        id={`dice-dust-${revision}-${index}`}
        origin={[spot[0], ground + 0.02, spot[2]]}
        count={9}
        color="#d9c8a4"
        speed={1.1}
        spread={0.92}
        gravity={3.2}
        life={0.85}
        size={0.045}
        delay={FLIGHT}
        reducedMotion={reducedMotion}
      />
    </group>)}
  </group>
}
