import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameDisplayState, Harbor } from '../../game/types'
import { coastlineAt } from '../terrain/IslandBody'
import { GROUND_Y } from '../terrain/hex'
import { box, cyl, merge, type Part } from './geometry'
import { ironMaterial, plankMaterial, quayMaterial, ropeMaterial, timberMaterial } from './materials'
import { harborSignMaps, hashString, makeRng } from './textures'

// Timber piers on stone-footed pilings that run out from the coast, with
// mooring posts, rope, crates and a moored boat. Every pier shares one merged
// geometry per material and is drawn instanced, so nine harbours cost five
// draw calls plus one painted trade board each.

const DECK = 0.44
const lazy = <T,>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

type PierGroups = {
  plank: THREE.BufferGeometry
  timber: THREE.BufferGeometry
  stone: THREE.BufferGeometry
  rope: THREE.BufferGeometry
  iron: THREE.BufferGeometry
  boat: THREE.BufferGeometry
}

// Local frame: +X points out to sea, the island is at -X.
const buildPier = (): PierGroups => {
  const random = makeRng(5501)
  const plank: Part[] = []
  const timber: Part[] = []
  const stone: Part[] = []
  const rope: Part[] = []
  const iron: Part[] = []

  // Stepped stone quay where the pier meets the shore.
  stone.push({ geo: box(0.3, 0.3, 0.4), pos: [-0.18, DECK - 0.16, 0], uv: [4, 3.4] })
  stone.push({ geo: box(0.24, 0.1, 0.44), pos: [-0.05, DECK - 0.11, 0], uv: [3, 1.2] })
  stone.push({ geo: box(0.34, 0.045, 0.44), pos: [-0.18, DECK - 0.012, 0], uv: [4, 0.7] })

  // Approach walkway and the main deck.
  plank.push({ geo: box(0.22, 0.028, 0.24), pos: [0.02, DECK, 0], uv: [2, 2.4] })
  plank.push({ geo: box(0.44, 0.03, 0.44), pos: [0.34, DECK, 0], uv: [3.4, 3.4] })
  plank.push({ geo: box(0.2, 0.028, 0.18), pos: [0.36, DECK - 0.075, 0.3], uv: [1.8, 1.8] })
  // Deck edge beams.
  for (const side of [-1, 1]) {
    plank.push({ geo: box(0.46, 0.038, 0.032), pos: [0.34, DECK + 0.012, side * 0.222], uv: [4, 1] })
  }
  plank.push({ geo: box(0.03, 0.038, 0.44), pos: [0.555, DECK + 0.012, 0], uv: [1, 4] })

  // Pilings driven into the water, with cross bracing.
  const pilings: Array<[number, number]> = [[0.14, 0.19], [0.14, -0.19], [0.53, 0.19], [0.53, -0.19], [0.36, 0.34]]
  for (const [x, z] of pilings) {
    timber.push({ geo: cyl(0.026, 0.032, 0.62, 8), pos: [x, DECK - 0.31, z], uv: [1, 4] })
  }
  for (const side of [-1, 1]) {
    timber.push({ geo: box(0.42, 0.022, 0.022), pos: [0.335, DECK - 0.19, side * 0.19], rot: [0, 0, 0.16], uv: [4, 1] })
  }

  // Mooring bollards with rope wraps and a coil on the deck.
  for (const [x, z] of [[0.12, 0.2], [0.55, 0.2], [0.55, -0.2]] as Array<[number, number]>) {
    timber.push({ geo: cyl(0.038, 0.042, 0.12, 10), pos: [x, DECK + 0.07, z], uv: [1.4, 1] })
    timber.push({ geo: cyl(0.05, 0.05, 0.018, 10), pos: [x, DECK + 0.135, z], uv: [1.4, 0.3] })
    rope.push({ geo: new THREE.TorusGeometry(0.041, 0.008, 6, 14), pos: [x, DECK + 0.09, z], rot: [Math.PI / 2, 0, 0] })
  }
  rope.push({ geo: new THREE.TorusGeometry(0.052, 0.011, 6, 18), pos: [0.42, DECK + 0.026, -0.13], rot: [Math.PI / 2, 0, 0] })
  rope.push({ geo: new THREE.TorusGeometry(0.033, 0.01, 6, 16), pos: [0.42, DECK + 0.028, -0.13], rot: [Math.PI / 2, 0, 0] })

  // Cargo: crates and a barrel, jittered but deterministic.
  for (let index = 0; index < 3; index += 1) {
    const size = 0.07 + random() * 0.03
    plank.push({
      geo: box(size, size, size),
      pos: [0.2 + random() * 0.16, DECK + size / 2 + 0.015, -0.05 - random() * 0.12],
      rot: [0, random() * Math.PI, 0],
      uv: [1, 1],
    })
  }
  timber.push({ geo: cyl(0.045, 0.05, 0.09, 12), pos: [0.24, DECK + 0.06, 0.11], uv: [1.4, 1] })
  iron.push({ geo: new THREE.TorusGeometry(0.047, 0.005, 5, 14), pos: [0.24, DECK + 0.09, 0.11], rot: [Math.PI / 2, 0, 0] })
  iron.push({ geo: new THREE.TorusGeometry(0.05, 0.005, 5, 14), pos: [0.24, DECK + 0.035, 0.11], rot: [Math.PI / 2, 0, 0] })

  // Sign posts. The board itself is drawn per harbour with its own painted face.
  for (const side of [-1, 1]) {
    timber.push({ geo: cyl(0.014, 0.016, 0.34, 6), pos: [0.06, DECK + 0.17, side * 0.13], uv: [1, 3] })
  }
  timber.push({ geo: box(0.024, 0.024, 0.3), pos: [0.06, DECK + 0.33, 0], uv: [1, 2] })

  // Moored rowing boat.
  const hull: Part[] = [
    { geo: box(0.24, 0.062, 0.1), pos: [0, 0, 0], uv: [2.4, 1] },
    { geo: cyl(0.0, 0.05, 0.1, 6), pos: [0.16, 0, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.62], uv: [1, 1] },
    { geo: cyl(0.0, 0.05, 0.08, 6), pos: [-0.155, 0, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.62], uv: [1, 1] },
    { geo: box(0.06, 0.014, 0.1), pos: [0.03, 0.028, 0], uv: [1, 1] },
    { geo: box(0.014, 0.012, 0.19), pos: [-0.06, 0.05, 0.02], rot: [0.1, 0.35, 0], uv: [1, 1] },
  ]

  return {
    plank: merge(plank),
    timber: merge(timber),
    stone: merge(stone),
    rope: merge(rope),
    iron: merge(iron),
    boat: merge(hull),
  }
}

const pierGroups = lazy(buildPier)

const signGeometry = lazy(() => new THREE.BoxGeometry(0.42, 0.235, 0.022))

const signMaterialCache = new Map<string, THREE.Material[]>()
const signMaterials = (harbor: Harbor) => {
  const key = `${harbor.ratio}:${harbor.resource ?? 'any'}`
  const hit = signMaterialCache.get(key)
  if (hit) return hit
  const maps = harborSignMaps(harbor.ratio, harbor.resource)
  const face = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: 0.82,
  })
  const edge = new THREE.MeshStandardMaterial({ color: '#553a22', roughness: 0.88 })
  // Box material order: +x, -x, +y, -y, +z, -z. Only the front face is painted,
  // and the yaw billboard below keeps that face pointed at the camera.
  const materials = [edge, edge, edge, edge, face, edge]
  signMaterialCache.set(key, materials)
  return materials
}

type Placement = { harbor: Harbor; x: number; z: number; yaw: number; jitter: number }

const world = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const euler = new THREE.Euler()

/**
 * The painted trade board. A fixed-yaw board sat edge-on to the camera at half
 * the harbours, which meant the one piece of information a harbour exists to
 * carry was unreadable. It now yaws to face the camera on its post and leans
 * back, so the ratio reads from every azimuth the rig allows.
 */
function TradeBoard({ harbor }: { harbor: Harbor }) {
  const pivot = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    const node = pivot.current
    if (!node) return
    node.getWorldPosition(world)
    let parentYaw = 0
    if (node.parent) {
      node.parent.getWorldQuaternion(quaternion)
      euler.setFromQuaternion(quaternion, 'YXZ')
      parentYaw = euler.y
    }
    node.rotation.y = Math.atan2(camera.position.x - world.x, camera.position.z - world.z) - parentYaw
  })
  return <group ref={pivot} position={[0.06, DECK + 0.33, 0]}>
    <group rotation={[-0.5, 0, 0]}>
      <mesh geometry={signGeometry()} material={signMaterials(harbor)} castShadow />
    </group>
  </group>
}

/** Local X of the back face of the stone quay, which is what has to bite land. */
const QUAY_BACK = -0.33

export function HarborPiers({ game }: { game: GameDisplayState }) {
  const placements = useMemo<Placement[]>(() => {
    // The hex-union boundary reaches further out at the flats than at the
    // corners, so scaling the edge midpoint by any single factor lands some
    // piers in open water and buries others. Project onto the real beach-shelf
    // polyline instead, and take the shore's own normal while we are there so
    // the pier runs perpendicular to the coast rather than to the board edge.
    const coast = coastlineAt(game.board, GROUND_Y - 0.06)
    return game.board.harbors.map((harbor) => {
      const edge = game.board.edges[harbor.edgeId]
      const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      const bearing = Math.atan2(mz, mx)
      let best = coast[0]
      let bestGap = Infinity
      for (const point of coast) {
        // Angular distance, wrapped: the island is star-shaped about the
        // origin, so the nearest bearing is the nearest stretch of coast.
        const delta = Math.abs(((Math.atan2(point.z, point.x) - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (delta < bestGap) { bestGap = delta; best = point }
      }
      const random = makeRng(hashString(harbor.id))
      return {
        harbor,
        // Sit the quay's back face a little inside the shelf so the steps bite
        // the beach instead of hovering over the last centimetre of it.
        x: best.x - best.nx * (QUAY_BACK + 0.06),
        z: best.z - best.nz * (QUAY_BACK + 0.06),
        yaw: Math.atan2(-best.nz, best.nx),
        jitter: (random() - 0.5) * 0.9,
      }
    })
  }, [game.board])

  const groups = pierGroups()
  const refs = {
    plank: useRef<THREE.InstancedMesh>(null),
    timber: useRef<THREE.InstancedMesh>(null),
    stone: useRef<THREE.InstancedMesh>(null),
    rope: useRef<THREE.InstancedMesh>(null),
    iron: useRef<THREE.InstancedMesh>(null),
    boat: useRef<THREE.InstancedMesh>(null),
  }
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    placements.forEach((placement, index) => {
      dummy.position.set(placement.x, 0, placement.z)
      dummy.rotation.set(0, placement.yaw, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      for (const key of ['plank', 'timber', 'stone', 'rope', 'iron'] as const) {
        refs[key].current?.setMatrixAt(index, dummy.matrix)
      }
      // The boat rides just off the deck, rocked a little per harbour.
      dummy.position.set(placement.x, 0, placement.z)
      dummy.rotation.set(0, placement.yaw, 0)
      dummy.updateMatrix()
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(0.36, 0.062, -0.36),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03 * placement.jitter, 0.2 + placement.jitter * 0.3, 0.05 * placement.jitter)),
        new THREE.Vector3(1, 1, 1),
      )
      refs.boat.current?.setMatrixAt(index, dummy.matrix.multiply(local))
    })
    for (const key of ['plank', 'timber', 'stone', 'rope', 'iron', 'boat'] as const) {
      const mesh = refs[key].current
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  })

  const count = placements.length
  return <group>
    <instancedMesh ref={refs.plank} args={[groups.plank, plankMaterial(), count]} castShadow receiveShadow />
    <instancedMesh ref={refs.timber} args={[groups.timber, timberMaterial(), count]} castShadow receiveShadow />
    <instancedMesh ref={refs.stone} args={[groups.stone, quayMaterial(), count]} castShadow receiveShadow />
    <instancedMesh ref={refs.rope} args={[groups.rope, ropeMaterial(), count]} castShadow />
    <instancedMesh ref={refs.iron} args={[groups.iron, ironMaterial(), count]} castShadow />
    <instancedMesh ref={refs.boat} args={[groups.boat, plankMaterial(), count]} castShadow receiveShadow />
    {placements.map((placement) => <group key={placement.harbor.id} position={[placement.x, 0, placement.z]} rotation={[0, placement.yaw, 0]}>
      <TradeBoard harbor={placement.harbor} />
    </group>)}
  </group>
}
