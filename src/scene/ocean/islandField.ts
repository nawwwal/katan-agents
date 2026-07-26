import * as THREE from 'three'
import type { Board } from '../../game/types'
import { coastlineAt } from '../terrain/IslandBody'
import { FIELD_EXTENT, FIELD_RESOLUTION, SEA_LEVEL } from './oceanConfig'

export type OceanRock = {
  x: number
  z: number
  radius: number
  height: number
  rotation: number
  tilt: number
  variant: number
}

export type IslandField = {
  /** R16F signed distance to the wet silhouette. Negative inside rock. */
  texture: THREE.DataTexture
  extent: number
  /** Smoothed waterline used by the distance field and the surf skirt. */
  outline: THREE.Vector2[]
  rocks: OceanRock[]
}

const TAU = Math.PI * 2

const hashSeed = (board: Board) => {
  let value = 0x811c9dc5
  for (const hex of board.hexes) {
    for (const char of `${hex.id}${hex.terrain}${hex.number ?? 0}`) {
      value ^= char.charCodeAt(0)
      value = Math.imul(value, 0x01000193)
    }
  }
  return value >>> 0
}

const rng = (seed: number) => {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Where the sea meets the island skirt.
 *
 * This used to keep its own copy of the IslandBody profile rings and arc noise,
 * which meant any terrain re-tune silently detached the surf from the rock.
 * `coastlineAt` is now the shared source of truth.
 */
const coastRing = (board: Board) =>
  coastlineAt(board, SEA_LEVEL, 5).map((point) => new THREE.Vector2(point.x, point.z))

/** Chaikin-style smoothing so the silhouette reads as eroded rock, not a saw. */
const smoothRing = (points: THREE.Vector2[], passes: number) => {
  let ring = points
  for (let pass = 0; pass < passes; pass += 1) {
    const next: THREE.Vector2[] = []
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      next.push(new THREE.Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25))
      next.push(new THREE.Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75))
    }
    ring = next
  }
  return ring
}

const polygonDistance = (px: number, pz: number, ring: THREE.Vector2[]) => {
  let best = Infinity
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j]
    const b = ring[i]
    const ex = b.x - a.x
    const ez = b.y - a.y
    const wx = px - a.x
    const wz = pz - a.y
    const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / (ex * ex + ez * ez)))
    const cx = wx - ex * t
    const cz = wz - ez * t
    const sq = cx * cx + cz * cz
    if (sq < best) best = sq
    if ((a.y > pz) !== (b.y > pz) && px < ((b.x - a.x) * (pz - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return (inside ? -1 : 1) * Math.sqrt(best)
}

/** Radius along `angle` where the coast distance field equals `offset`. */
const radiusAtOffset = (angle: number, offset: number, ring: THREE.Vector2[]) => {
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  let low = 0
  let high = FIELD_EXTENT
  for (let i = 0; i < 28; i += 1) {
    const mid = (low + high) / 2
    if (polygonDistance(dx * mid, dz * mid, ring) < offset) low = mid
    else high = mid
  }
  return (low + high) / 2
}

const scatterRocks = (ring: THREE.Vector2[], seed: number): OceanRock[] => {
  const random = rng(seed)
  const rocks: OceanRock[] = []
  const count = 40
  for (let i = 0; i < count; i += 1) {
    // Golden-angle spread keeps the ring evenly covered without clumping.
    const angle = (i * 2.39996323 + random() * 0.34) % TAU
    const stack = i % 11 === 3
    const offset = stack
      ? 0.30 + random() * 0.55
      : 0.07 + random() * random() * 1.25
    const radius = stack ? 0.15 + random() * 0.10 : 0.05 + random() * random() * 0.17
    const base = radiusAtOffset(angle, offset, ring)
    rocks.push({
      x: Math.cos(angle) * base,
      z: Math.sin(angle) * base,
      radius,
      height: stack ? radius * (2.0 + random() * 1.3) : radius * (0.7 + random() * 0.8),
      rotation: random() * TAU,
      tilt: (random() - 0.5) * 0.32,
      variant: Math.floor(random() * 3),
    })
  }
  return rocks
}

/**
 * R: distance to the whole wet silhouette, island and offshore rocks together.
 * G: distance to the island alone.
 *
 * The surf needs both. A metre-wide band of white water reads right against
 * the coast and absurd around a twenty-centimetre rock, so the shader draws a
 * wide wash off G and a tight collar off R.
 */
const bakeField = (ring: THREE.Vector2[], rocks: OceanRock[]) => {
  const size = FIELD_RESOLUTION
  const data = new Uint16Array(size * size * 2)
  const step = (FIELD_EXTENT * 2) / (size - 1)
  const clampD = (d: number) => Math.max(-8, Math.min(FIELD_EXTENT, d))
  for (let row = 0; row < size; row += 1) {
    const z = -FIELD_EXTENT + row * step
    for (let col = 0; col < size; col += 1) {
      const x = -FIELD_EXTENT + col * step
      const island = polygonDistance(x, z, ring)
      let d = island
      for (const rock of rocks) {
        const dx = x - rock.x
        const dz = z - rock.z
        // Waterline radius of a rock is a little under its geometric radius.
        const rd = Math.sqrt(dx * dx + dz * dz) - rock.radius * 0.92
        if (rd < d) d = rd
      }
      const index = (row * size + col) * 2
      data[index] = THREE.DataUtils.toHalfFloat(clampD(d))
      data[index + 1] = THREE.DataUtils.toHalfFloat(clampD(island))
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.HalfFloatType)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

const cache = new WeakMap<Board, IslandField>()

export const buildIslandField = (board: Board): IslandField => {
  const cached = cache.get(board)
  if (cached) return cached
  // One smoothing pass takes the polygonal jitter off without losing the
  // headlands; Chaikin pulls corners in, so nudge the ring back out a touch.
  const outline = smoothRing(coastRing(board), 1).map((point) => point.multiplyScalar(1.006))
  const rocks = scatterRocks(outline, hashSeed(board))
  const field: IslandField = { texture: bakeField(outline, rocks), extent: FIELD_EXTENT, outline, rocks }
  cache.set(board, field)
  return field
}

// The ocean surface lives beside the island in the scene graph and never sees
// the board, so the shoreline publishes the field here and the ocean listens.
let current: IslandField | null = null
const listeners = new Set<() => void>()

export const publishIslandField = (field: IslandField) => {
  if (current === field) return
  current = field
  for (const listener of listeners) listener()
}

export const subscribeIslandField = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const getIslandField = () => current

export const seaLevel = SEA_LEVEL
