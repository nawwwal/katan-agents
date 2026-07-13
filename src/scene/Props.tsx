import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Board, HexTile } from '../game/types'

type Instance = { position: [number, number, number]; rotation: number; scale: number }

const hash = (value: string) => [...value].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 2166136261)

const scatter = (tiles: HexTile[], count: number, minRadius: number, maxRadius: number): Instance[] => tiles.flatMap((tile) => {
  const seed = hash(tile.id)
  return Array.from({ length: count }, (_, index) => {
    const phase = ((seed % 97) / 97) * Math.PI * 2
    const angle = phase + (index / count) * Math.PI * 2
    const variation = ((seed >> (index % 16)) & 7) / 7
    const radius = minRadius + (maxRadius - minRadius) * variation
    return {
      position: [tile.x + Math.cos(angle) * radius, 0, tile.z + Math.sin(angle) * radius],
      rotation: angle + variation,
      scale: 0.88 + variation * 0.2,
    }
  })
})

function Trees({ tiles }: { tiles: HexTile[] }) {
  const instances = useMemo(() => scatter(tiles, 6, 0.38, 0.56), [tiles])
  const trunks = useRef<THREE.InstancedMesh>(null)
  const crowns = useRef<THREE.InstancedMesh>(null)
  const upperCrowns = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const object = new THREE.Object3D()
    instances.forEach((instance, index) => {
      const [x, , z] = instance.position
      object.position.set(x, 0.58, z)
      object.rotation.set(0, instance.rotation, 0)
      object.scale.set(instance.scale * 0.9, instance.scale, instance.scale * 0.9)
      object.updateMatrix()
      trunks.current?.setMatrixAt(index, object.matrix)

      object.position.y = 0.75
      object.rotation.set(instance.rotation * 0.08, instance.rotation, instance.rotation * 0.05)
      object.scale.set(instance.scale, instance.scale * 0.9, instance.scale)
      object.updateMatrix()
      crowns.current?.setMatrixAt(index, object.matrix)
      crowns.current?.setColorAt(index, new THREE.Color(index % 3 === 0 ? '#2e8d52' : index % 2 === 0 ? '#257647' : '#3a9858'))

      object.position.y = 0.9
      object.scale.setScalar(instance.scale * 0.78)
      object.updateMatrix()
      upperCrowns.current?.setMatrixAt(index, object.matrix)
      upperCrowns.current?.setColorAt(index, new THREE.Color(index % 2 === 0 ? '#51ad5e' : '#3f9b53'))
    })
    for (const mesh of [trunks.current, crowns.current, upperCrowns.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [instances])

  return <>
    <instancedMesh ref={trunks} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      <cylinderGeometry args={[0.04, 0.062, 0.27, 7]} />
      <meshStandardMaterial color="#6c3f24" roughness={0.78} />
    </instancedMesh>
    <instancedMesh ref={crowns} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.2, 1]} />
      <meshStandardMaterial roughness={0.72} />
    </instancedMesh>
    <instancedMesh ref={upperCrowns} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.16, 1]} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  </>
}

function Sheep({ tiles }: { tiles: HexTile[] }) {
  const instances = useMemo(() => scatter(tiles, 2, 0.4, 0.54), [tiles])
  const bodies = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const body = new THREE.Object3D()
    const head = new THREE.Object3D()
    instances.forEach((instance, index) => {
      const [x, , z] = instance.position
      body.position.set(x, 0.56, z)
      body.rotation.set(0, instance.rotation, 0)
      body.scale.set(instance.scale * 1.15, instance.scale * 0.82, instance.scale * 0.9)
      body.updateMatrix()
      bodies.current?.setMatrixAt(index, body.matrix)

      head.position.set(x + Math.cos(instance.rotation) * 0.13, 0.57, z + Math.sin(instance.rotation) * 0.13)
      head.rotation.set(0, instance.rotation, 0)
      head.scale.setScalar(instance.scale * 0.72)
      head.updateMatrix()
      heads.current?.setMatrixAt(index, head.matrix)
    })
    for (const mesh of [bodies.current, heads.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true
  }, [instances])

  return <>
    <instancedMesh ref={bodies} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.105, 1]} />
      <meshStandardMaterial color="#fff4dc" roughness={0.84} />
    </instancedMesh>
    <instancedMesh ref={heads} args={[undefined, undefined, instances.length]} castShadow>
      <dodecahedronGeometry args={[0.072, 1]} />
      <meshStandardMaterial color="#5b4939" roughness={0.8} />
    </instancedMesh>
  </>
}

function ClayCuts({ tiles }: { tiles: HexTile[] }) {
  const instances = useMemo(() => scatter(tiles, 3, 0.39, 0.55), [tiles])
  const mesh = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const object = new THREE.Object3D()
    instances.forEach((instance, index) => {
      const height = 0.07 + (index % 3) * 0.018
      object.position.set(instance.position[0], 0.455 + height, instance.position[2])
      object.rotation.set(0, instance.rotation + (index % 2 ? 0.16 : -0.1), (index % 3 - 1) * 0.08)
      object.scale.set(instance.scale * 0.18, height, instance.scale * 0.13)
      object.updateMatrix()
      mesh.current?.setMatrixAt(index, object.matrix)
      mesh.current?.setColorAt(index, new THREE.Color(index % 2 === 0 ? '#db713c' : '#a94529'))
    })
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    }
  }, [instances])

  return <instancedMesh ref={mesh} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
    <boxGeometry args={[1.55, 1.2, 1]} />
    <meshStandardMaterial roughness={0.76} />
  </instancedMesh>
}

function FieldBands({ tiles }: { tiles: HexTile[] }) {
  const bands = useMemo(() => tiles.flatMap((tile) => [-0.56, -0.43, -0.3].map((offset, index) => ({
    x: tile.x + (index - 1) * 0.035,
    z: tile.z + offset,
    rotation: ((hash(tile.id) % 9) - 4) * 0.012,
  }))), [tiles])
  const mesh = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const object = new THREE.Object3D()
    bands.forEach((band, index) => {
      object.position.set(band.x, 0.478 + (index % 2) * 0.004, band.z)
      object.rotation.set(0, band.rotation, 0)
      object.scale.set(1 - (index % 3) * 0.05, 1, 1)
      object.updateMatrix()
      mesh.current?.setMatrixAt(index, object.matrix)
      mesh.current?.setColorAt(index, new THREE.Color(index % 2 === 0 ? '#f8c53e' : '#dc9722'))
    })
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    }
  }, [bands])

  return <instancedMesh ref={mesh} args={[undefined, undefined, bands.length]} castShadow receiveShadow>
    <boxGeometry args={[1.02, 0.035, 0.065]} />
    <meshStandardMaterial roughness={0.72} />
  </instancedMesh>
}

function OreRidges({ tiles }: { tiles: HexTile[] }) {
  const instances = useMemo(() => scatter(tiles, 3, 0.4, 0.53), [tiles])
  const mesh = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const object = new THREE.Object3D()
    instances.forEach((instance, index) => {
      const height = 0.32 + (index % 3) * 0.07
      object.position.set(instance.position[0], 0.458 + height / 2, instance.position[2])
      object.rotation.set((index % 2 ? -1 : 1) * 0.04, instance.rotation, (index % 3 - 1) * 0.055)
      object.scale.set(instance.scale * 0.2, height, instance.scale * 0.18)
      object.updateMatrix()
      mesh.current?.setMatrixAt(index, object.matrix)
      mesh.current?.setColorAt(index, new THREE.Color(index % 3 === 0 ? '#9eb4c5' : index % 2 === 0 ? '#6e879b' : '#506a80'))
    })
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    }
  }, [instances])

  return <instancedMesh ref={mesh} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
    <coneGeometry args={[1, 1, 6]} />
    <meshStandardMaterial roughness={0.7} />
  </instancedMesh>
}

function DesertDunes({ tiles }: { tiles: HexTile[] }) {
  return <>{tiles.flatMap((tile) => [
    <mesh key={`${tile.id}-a`} position={[tile.x - 0.43, 0.465, tile.z + 0.18]} scale={[0.3, 0.07, 0.19]} rotation={[0, 0.45, 0]} receiveShadow castShadow><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color="#f4c65f" roughness={0.76} /></mesh>,
    <mesh key={`${tile.id}-b`} position={[tile.x + 0.43, 0.46, tile.z - 0.2]} scale={[0.25, 0.055, 0.17]} rotation={[0, -0.52, 0]} receiveShadow><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color="#dfa846" roughness={0.8} /></mesh>,
  ])}</>
}

export function TerrainProps({ board }: { board: Board; reducedMotion?: boolean }) {
  return <>
    <Trees tiles={board.hexes.filter((tile) => tile.terrain === 'lumber')} />
    <Sheep tiles={board.hexes.filter((tile) => tile.terrain === 'wool')} />
    <FieldBands tiles={board.hexes.filter((tile) => tile.terrain === 'grain')} />
    <ClayCuts tiles={board.hexes.filter((tile) => tile.terrain === 'brick')} />
    <OreRidges tiles={board.hexes.filter((tile) => tile.terrain === 'ore')} />
    <DesertDunes tiles={board.hexes.filter((tile) => tile.terrain === 'desert')} />
  </>
}
