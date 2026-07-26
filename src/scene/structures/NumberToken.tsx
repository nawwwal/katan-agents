import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { masonryMaterial, timberMaterial } from './materials'
import { tokenFaceMaps } from './textures'

// A real turned-wood disc with a painted stone face, lit by the scene like
// everything else. The numeral lives in a texture with a matching normal map so
// the paint sits in an engraved recess.

// Trimmed from 0.3: at the default camera the old disc was the loudest object
// on the board while carrying less contrast than the DOM token it replaced.
const RADIUS = 0.272

const lazy = <T,>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

/**
 * Turned rim. The lip now stands proud of the painted face and returns inwards
 * over it, so the numeral sits in a recess with its own shading instead of
 * flush on a plate.
 */
const rimGeometry = lazy(() => {
  const profile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(RADIUS - 0.014, 0.0),
    new THREE.Vector2(RADIUS - 0.002, 0.014),
    new THREE.Vector2(RADIUS + 0.004, 0.038),
    new THREE.Vector2(RADIUS - 0.004, 0.058),
    new THREE.Vector2(RADIUS - 0.024, 0.07),
    new THREE.Vector2(RADIUS - 0.042, 0.063),
  ]
  const geometry = new THREE.LatheGeometry(profile, 64)
  geometry.computeVertexNormals()
  return geometry
})

const bodyGeometry = lazy(() => new THREE.CylinderGeometry(RADIUS - 0.04, RADIUS - 0.038, 0.056, 64))
const faceGeometry = lazy(() => {
  const geometry = new THREE.CircleGeometry(RADIUS - 0.044, 64)
  geometry.rotateX(-Math.PI / 2)
  return geometry
})

const woodMaterial = lazy(() => {
  const material = timberMaterial().clone()
  material.color.set('#6d4c2c')
  material.roughness = 0.55
  return material
})

const stoneMaterial = lazy(() => {
  const material = masonryMaterial().clone()
  material.color.set('#cbbc98')
  return material
})

const faceCache = new Map<number, THREE.MeshStandardMaterial>()
const faceMaterial = (value: number) => {
  const hit = faceCache.get(value)
  if (hit) return hit
  const maps = tokenFaceMaps(value)
  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: 0.72,
    metalness: 0.02,
  })
  material.normalScale.setScalar(1.7)
  faceCache.set(value, material)
  return material
}

/**
 * Drop-in replacement for the old `<Html>` token. `height` keeps the same
 * meaning: local Y offset above the tile group's origin.
 */
export function NumberTokenMesh({ number, height = 0.095 }: { number: number; height?: number }) {
  const face = useRef<THREE.Mesh>(null)
  const world = useMemo(() => new THREE.Vector3(), [])

  // Yaw-only billboard. The disc is round, so turning it only rotates the
  // numeral — it stays upright and legible at every azimuth in the rig's range.
  useFrame(({ camera }) => {
    const mesh = face.current
    if (!mesh) return
    mesh.getWorldPosition(world)
    const parent = mesh.parent
    let parentYaw = 0
    if (parent) {
      parent.getWorldQuaternion(quaternion)
      euler.setFromQuaternion(quaternion, 'YXZ')
      parentYaw = euler.y
    }
    mesh.rotation.y = Math.atan2(camera.position.x - world.x, camera.position.z - world.z) - parentYaw
  })

  return <group position={[0, height, 0]}>
    <mesh geometry={rimGeometry()} material={woodMaterial()} castShadow receiveShadow />
    <mesh geometry={bodyGeometry()} material={stoneMaterial()} position={[0, 0.028, 0]} receiveShadow />
    <mesh ref={face} geometry={faceGeometry()} material={faceMaterial(number)} position={[0, 0.0565, 0]} receiveShadow />
  </group>
}

const quaternion = new THREE.Quaternion()
const euler = new THREE.Euler()
