import * as THREE from 'three'
import type { Terrain } from '../../game/types'

/**
 * Terrain materials come off disk, not out of a loop.
 *
 * This module used to paint six biomes of 512px albedo, normal and roughness in
 * JavaScript on every page load -- about 580ms of main-thread work for maps
 * that were too soft to survive being stretched across a hex, and that were
 * *seamed*: tile UVs run -0.28..1.28 under RepeatWrapping while the runtime
 * noise sampled an unbounded lattice, so every hex carried a hard discontinuity
 * across its own face.
 *
 * `scripts/bake` now paints the same six biomes offline at 2048px albedo and
 * 1024px normal, wraps every generator's lattice by frequency so the maps tile
 * exactly, and channel-packs occlusion, roughness and height into one ARH map.
 * Loading them is both sharper and cheaper, which is not a trade.
 *
 * See `art/bake-pipeline.md`. The five rules it states are enforced below.
 */

const MANIFEST_URL = '/assets/baked/manifest.json'

const TERRAINS = ['lumber', 'wool', 'grain', 'brick', 'ore', 'desert'] as const

type TextureEntry = { file: string }

type MaterialEntry = {
  textures: { map: TextureEntry; normalMap: TextureEntry; arhMap: TextureEntry }
  runtime: {
    anisotropy: number
    normalScale: number
    aoMapIntensity: number
    roughness: number
    metalness: number
  }
}

type Manifest = {
  basePath: string
  materials: Record<string, MaterialEntry>
}

/** Last-resort flat colours, used only if the bake output is missing entirely. */
const FALLBACK_TINT: Record<Terrain, string> = {
  lumber: '#4a6b2f',
  wool: '#7ba338',
  grain: '#d0a63c',
  brick: '#a8512c',
  ore: '#6d7480',
  desert: '#dcbc80',
}

const fallbackMaterial = (terrain: Terrain) => new THREE.MeshStandardMaterial({
  color: new THREE.Color(FALLBACK_TINT[terrain]).convertSRGBToLinear(),
  vertexColors: true,
  roughness: 0.94,
  metalness: 0,
  dithering: true,
})

const loader = new THREE.TextureLoader()

const loadTexture = async (url: string, srgb: boolean, anisotropy: number) => {
  const texture = await loader.loadAsync(url)
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  // Rule 4: terrain UVs overshoot 0..1, so clamping would smear the hex rim.
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = anisotropy
  texture.generateMipmaps = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

const buildMaterial = async (basePath: string, entry: MaterialEntry) => {
  const { runtime } = entry
  const [map, normalMap, arh] = await Promise.all([
    loadTexture(basePath + entry.textures.map.file, true, runtime.anisotropy),
    loadTexture(basePath + entry.textures.normalMap.file, false, runtime.anisotropy),
    loadTexture(basePath + entry.textures.arhMap.file, false, runtime.anisotropy),
  ])
  // Rule 2: one texture bound twice. Without channel = 0 three.js goes looking
  // for a uv1 attribute the hex geometry does not carry, and the aoMap silently
  // renders black.
  arh.channel = 0
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    aoMap: arh,
    roughnessMap: arh,
    // Rule 3: B is height, not metalness. Metalness stays scalar.
    roughness: runtime.roughness,
    metalness: runtime.metalness,
    vertexColors: true,
    dithering: true,
  })
  material.normalScale.setScalar(runtime.normalScale)
  material.aoMapIntensity = runtime.aoMapIntensity
  return material
}

const materials = new Map<Terrain, THREE.MeshStandardMaterial>()
let loading: Promise<void> | undefined
let ready = false

const load = async () => {
  let manifest: Manifest | undefined
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'force-cache' })
    const type = response.headers.get('content-type') ?? ''
    if (response.ok && type.includes('json')) manifest = (await response.json()) as Manifest
  } catch {
    manifest = undefined
  }

  for (const terrain of TERRAINS) {
    const entry = manifest?.materials?.[terrain]
    if (!entry) {
      console.warn(`[terrain] no baked material for "${terrain}"; falling back to flat colour`)
      materials.set(terrain, fallbackMaterial(terrain))
      continue
    }
    try {
      materials.set(terrain, await buildMaterial(manifest?.basePath ?? '/assets/baked/', entry))
    } catch (error) {
      console.warn(`[terrain] baked material "${terrain}" failed to load:`, error)
      materials.set(terrain, fallbackMaterial(terrain))
    }
  }
  ready = true
}

/**
 * Fetch the manifest and every terrain map exactly once. Safe to call from the
 * preloader, from a component, or both.
 */
export const preloadTerrainMaterials = (): Promise<void> => (loading ??= load())

/**
 * Suspend the calling component until the maps are decoded. React catches the
 * thrown promise, so the loading screen stays up rather than the board flashing
 * a frame of untextured hexes.
 */
export const suspendForTerrainMaterials = () => {
  if (ready) return
  throw preloadTerrainMaterials()
}

export const terrainMaterial = (terrain: Terrain): THREE.MeshStandardMaterial => {
  const material = materials.get(terrain)
  if (!material) throw new Error(`terrain material "${terrain}" requested before load`)
  return material
}
