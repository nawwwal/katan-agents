import * as THREE from 'three'
import {
  clothMaps,
  cobbleMaps,
  gravelMaps,
  masonryMaps,
  plankMaps,
  plasterMaps,
  quayMaps,
  roofMaps,
  timberMaps,
  type SurfaceMaps,
} from './textures'

// Materials are built lazily on first render (they need a DOM canvas) and then
// shared by every piece that uses them.

type Tuning = {
  color?: string
  roughness?: number
  metalness?: number
  normalScale?: number
  envMapIntensity?: number
}

const standard = (maps: SurfaceMaps, tuning: Tuning = {}) => {
  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: tuning.roughness ?? 0.85,
    metalness: tuning.metalness ?? 0.04,
  })
  if (tuning.color) material.color.set(tuning.color)
  material.normalScale.setScalar(tuning.normalScale ?? 1)
  material.envMapIntensity = tuning.envMapIntensity ?? 1
  return material
}

const lazy = <T>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

export const masonryMaterial = lazy(() => standard(masonryMaps(), { roughness: 0.88, normalScale: 1.1 }))
export const plasterMaterial = lazy(() => standard(plasterMaps(), { roughness: 0.94, normalScale: 0.75 }))
export const timberMaterial = lazy(() => standard(timberMaps(), { roughness: 0.82, color: '#8a6440' }))
export const plankMaterial = lazy(() => standard(plankMaps(), { roughness: 0.86, color: '#c19468' }))
/**
 * Planking that reads its value from vertex colour, so one boat hull can carry
 * a tarred outer skin, a lighter inner skin and a bright rail cap in a single
 * draw call. Without that value break the hull reads as a grey blob.
 */
export const variedPlankMaterial = lazy(() => {
  const material = standard(plankMaps(), { roughness: 0.88, color: '#b58a5f' })
  material.vertexColors = true
  return material
})

export const cobbleMaterial = lazy(() => standard(cobbleMaps(), { roughness: 0.9, normalScale: 1.15 }))
export const gravelMaterial = lazy(() => standard(gravelMaps(), { roughness: 0.97, normalScale: 1.3 }))
export const quayMaterial = lazy(() => standard(quayMaps(), { roughness: 0.92, normalScale: 1.1 }))

/** Cobble at a finer texel density, for the terraces buildings sit on. */
export const terraceMaterial = lazy(() => {
  const maps = cobbleMaps()
  const tighten = (texture: THREE.Texture) => {
    const copy = texture.clone()
    copy.repeat.set(3, 3)
    copy.needsUpdate = true
    return copy
  }
  return standard(
    { map: tighten(maps.map), normalMap: tighten(maps.normalMap), roughnessMap: tighten(maps.roughnessMap) },
    { roughness: 0.92, normalScale: 0.9, color: '#b9ac92' },
  )
})

/**
 * Masonry that reads its per-stone value from the merged geometry's vertex
 * colours. Uniformly pale stonework is what made the city look like a
 * sandcastle; this lets each course and quoin carry its own tone and lets
 * crevice blocks be dirtied down without extra draw calls.
 */
export const variedMasonryMaterial = lazy(() => {
  const material = standard(masonryMaps(), { color: '#b3a688', roughness: 0.91, normalScale: 1.5 })
  material.vertexColors = true
  return material
})

export const variedPlasterMaterial = lazy(() => {
  const material = standard(plasterMaps(), { color: '#c2b79b', roughness: 0.95, normalScale: 1.1 })
  material.vertexColors = true
  return material
})

/** Dark basalt. Vertex-tinted per block. */
export const basaltMaterial = lazy(() => {
  const material = standard(cobbleMaps(), { color: '#4b4339', roughness: 0.93, normalScale: 1.4 })
  material.vertexColors = true
  return material
})

/**
 * Pale limestone for road plinths and kerbs. Deliberately light: every hex
 * boundary on this island is a dark stone wall, so a dark road edge reads as
 * more border. Vertex-tinted per block.
 */
export const paleStoneMaterial = lazy(() => {
  const material = standard(cobbleMaps(), { color: '#c4bda9', roughness: 0.92, normalScale: 1.4 })
  material.vertexColors = true
  return material
})

/** Player-coloured road paving. Vertex-tinted per setts so it is never flat. */
const pavingCache = new Map<string, THREE.MeshStandardMaterial>()
export const pavingMaterial = (color: string) => {
  const hit = pavingCache.get(color)
  if (hit) return hit
  const material = standard(cobbleMaps(), { color, roughness: 0.86, normalScale: 1.35 })
  material.vertexColors = true
  pavingCache.set(color, material)
  return material
}

/** Turned earth around a building platform. */
export const apronMaterial = lazy(() => standard(gravelMaps(), { color: '#6b5842', roughness: 0.98, normalScale: 1.2 }))

/** Painted kerb ring set into a building terrace. Carries ownership top-down. */
const kerbRingCache = new Map<string, THREE.MeshStandardMaterial>()
export const kerbRingMaterial = (color: string) => {
  const hit = kerbRingCache.get(color)
  if (hit) return hit
  const material = standard(cobbleMaps(), { color, roughness: 0.88, normalScale: 1.1 })
  kerbRingCache.set(color, material)
  return material
}

export const ironMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#3b3630', roughness: 0.48, metalness: 0.72 }))
export const brassMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#b08a3c', roughness: 0.36, metalness: 0.85 }))
export const glassMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#1d5b63', roughness: 0.22, metalness: 0.1, emissive: '#0d2b33', emissiveIntensity: 0.35 }))
export const ropeMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#b39a6c', roughness: 0.96 }))
/**
 * Robber cloak. Lifted off near-black and stripped of most of its metalness:
 * a dark specular cloth swallowed the cloak folds entirely, and folds you
 * cannot see at board scale are folds you did not model.
 */
export const bronzeMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#544632', roughness: 0.82, metalness: 0.06 }))
export const voidMaterial = lazy(() => new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 1, metalness: 0 }))

const roofCache = new Map<string, THREE.MeshStandardMaterial>()
export const roofMaterial = (color: string) => {
  const hit = roofCache.get(color)
  if (hit) return hit
  const material = standard(roofMaps(), { color, roughness: 0.8, normalScale: 1.2 })
  roofCache.set(color, material)
  return material
}

/** Owner-coloured paint over timber: doors, shutters and eaves boards. */
const trimCache = new Map<string, THREE.MeshStandardMaterial>()
export const paintedTrimMaterial = (color: string) => {
  const hit = trimCache.get(color)
  if (hit) return hit
  const material = standard(timberMaps(), { color, roughness: 0.72 })
  trimCache.set(color, material)
  return material
}

const clothCache = new Map<string, THREE.MeshStandardMaterial>()
export const clothMaterial = (color: string) => {
  const hit = clothCache.get(color)
  if (hit) return hit
  const material = standard(clothMaps(), { color, roughness: 0.93 })
  material.side = THREE.DoubleSide
  clothCache.set(color, material)
  return material
}
