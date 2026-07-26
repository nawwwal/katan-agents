import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Board } from '../../game/types'
import { GROUND_Y } from './hex'
import { fbm, makeRng, ridge, valueNoise } from './noise'
import { boulderGeometry, tussockGeometry } from './props'

// The island body replaces the extruded prism the kit shipped. It is a skirt
// lofted from the hex-union boundary: turf lip, beach shelf, stratified cliff
// with an undercut, and a submerged base. Every offset is noise-driven off the
// boundary arc length, so the coast silhouette is irregular but deterministic.

type Ring = {
  /** Outward offset from the boundary, in board units. */
  offset: number
  y: number
  color: string
  /** How strongly the per-point noise deforms this ring. */
  wobble: number
}

const PROFILE: Ring[] = [
  // Turf lip rolling over the edge, then a sand shelf, then stratified rock
  // stepping down past the waterline. Offsets alternate in and out so the
  // silhouette has undercuts instead of reading as one smooth cone.
  { offset: -0.03, y: GROUND_Y + 0.004, color: '#75963f', wobble: 0.012 },
  { offset: 0.07, y: GROUND_Y - 0.022, color: '#638033', wobble: 0.06 },
  { offset: 0.115, y: GROUND_Y - 0.06, color: '#b6a077', wobble: 0.1 },
  { offset: 0.175, y: GROUND_Y - 0.12, color: '#93917f', wobble: 0.16 },
  { offset: 0.14, y: GROUND_Y - 0.26, color: '#767770', wobble: 0.16 },
  { offset: 0.315, y: GROUND_Y - 0.44, color: '#6b6c66', wobble: 0.21 },
  { offset: 0.24, y: GROUND_Y - 0.6, color: '#4f524e', wobble: 0.17 },
  { offset: 0.36, y: GROUND_Y - 0.8, color: '#3d3f3d', wobble: 0.2 },
  { offset: 0.26, y: GROUND_Y - 1.35, color: '#282a2a', wobble: 0.1 },
]

export type BoundaryPoint = { x: number; z: number; nx: number; nz: number; t: number }

const boundary = (board: Board, subdivisions = 5): BoundaryPoint[] => {
  const corners = Object.values(board.vertices)
    .filter((vertex) => vertex.hexes.length < 3)
    .toSorted((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x))
  const dense: Array<{ x: number; z: number }> = []
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    for (let s = 0; s < subdivisions; s += 1) {
      const t = s / subdivisions
      dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    }
  }
  const count = dense.length
  return dense.map((point, i) => {
    const prev = dense[(i - 1 + count) % count]
    const next = dense[(i + 1) % count]
    // Outward normal of the polygon, averaged across the two incident segments.
    const nx = (point.z - prev.z) + (next.z - point.z)
    const nz = -((point.x - prev.x) + (next.x - point.x))
    const len = Math.hypot(nx, nz) || 1
    return { x: point.x, z: point.z, nx: nx / len, nz: nz / len, t: i / count }
  })
}

/**
 * Where the coast silhouette sits at a given world Y, in board units.
 *
 * The ocean and surf modules need the same outline the skirt is lofted from,
 * and they cannot import the mesh. This is the single source of truth: it runs
 * the exact ring interpolation and arc noise `buildSkirt` uses, so anything
 * drawn against it stays welded to the rock when the profile is re-tuned.
 *
 * `y` is clamped to the profile's range (turf lip down to the submerged base).
 * The returned points are ordered counter-clockwise and closed implicitly.
 */
export const coastlineAt = (board: Board, y: number, subdivisions = 7): Array<{ x: number; z: number; nx: number; nz: number; t: number }> => {
  const points = boundary(board, subdivisions)
  // Locate the profile band containing y. Ring Y decreases monotonically.
  let upper = 0
  while (upper < PROFILE.length - 2 && PROFILE[upper + 1].y > y) upper += 1
  const a = PROFILE[upper]
  const b = PROFILE[upper + 1]
  const span = a.y - b.y || 1
  const k = Math.max(0, Math.min(1, (a.y - y) / span))
  const offset = a.offset + (b.offset - a.offset) * k
  const wobble = a.wobble + (b.wobble - a.wobble) * k
  const r = upper + k
  return points.map((p) => {
    const push = ringPush(p.t, r, wobble)
    return { x: p.x + p.nx * (offset + push), z: p.z + p.nz * (offset + push), nx: p.nx, nz: p.nz, t: p.t }
  })
}

/** Outward noise displacement for a boundary point on ring `r`. Shared by the skirt and `coastlineAt`. */
const ringPush = (t: number, r: number, wobble: number) => {
  const arc = t * 40
  const head = fbm(arc * 0.32, r * 0.7, 3, 8101) - 0.5
  const crenel = ridge(arc * 1.35, r * 0.4 + 3, 3, 9203) - 0.5
  return (head * 1.5 + crenel * 0.9) * wobble * 2.6
}

const buildSkirt = (points: BoundaryPoint[]) => {
  const rings = PROFILE.length
  const count = points.length
  const positions = new Float32Array(count * rings * 3)
  const colors = new Float32Array(count * rings * 3)
  const color = new THREE.Color()
  const neighbourColor = new THREE.Color()

  for (let r = 0; r < rings; r += 1) {
    const ring = PROFILE[r]
    for (let i = 0; i < count; i += 1) {
      const p = points[i]
      const arc = p.t * 40
      // Two octaves of coast noise: broad headlands plus a rocky crenellation.
      const push = ringPush(p.t, r, ring.wobble)
      const drop = (valueNoise(arc * 0.9, r * 1.7, 7307) - 0.5) * ring.wobble * 0.9
      const offset = ring.offset + push
      const index = (r * count + i) * 3
      positions[index] = p.x + p.nx * offset
      positions[index + 1] = ring.y + drop
      positions[index + 2] = p.z + p.nz * offset
      // Bleed each band into its neighbour along a noisy front, so turf runs
      // down into the sand in tongues and rock outcrops break the beach.
      const bleed = fbm(arc * 0.75, r * 2.3, 3, 5501)
      const neighbour = PROFILE[bleed > 0.5 ? Math.min(rings - 1, r + 1) : Math.max(0, r - 1)]
      const shade = 0.84 + fbm(arc * 2.1, r * 1.3, 3, 6101) * 0.38
      color.set(ring.color).convertSRGBToLinear()
        .lerp(neighbourColor.set(neighbour.color).convertSRGBToLinear(), Math.abs(bleed - 0.5) * 1.5)
        .multiplyScalar(shade)
      colors[index] = color.r
      colors[index + 1] = color.g
      colors[index + 2] = color.b
    }
  }

  const indices: number[] = []
  for (let r = 0; r < rings - 1; r += 1) {
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count
      const a = r * count + i
      const b = r * count + j
      const c = (r + 1) * count + i
      const d = (r + 1) * count + j
      indices.push(a, b, c, b, d, c)
    }
  }
  // Cap the bottom so the island is not see-through from a low camera.
  const base = (rings - 1) * count
  const centerIndex = count * rings
  const capped = new Float32Array((count * rings + 1) * 3)
  const cappedColors = new Float32Array((count * rings + 1) * 3)
  capped.set(positions)
  cappedColors.set(colors)
  capped[centerIndex * 3] = 0
  capped[centerIndex * 3 + 1] = PROFILE[rings - 1].y - 0.05
  capped[centerIndex * 3 + 2] = 0
  color.set(PROFILE[rings - 1].color).convertSRGBToLinear()
  cappedColors[centerIndex * 3] = color.r
  cappedColors[centerIndex * 3 + 1] = color.g
  cappedColors[centerIndex * 3 + 2] = color.b
  for (let i = 0; i < count; i += 1) {
    indices.push(base + i, base + ((i + 1) % count), centerIndex)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(capped, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(cappedColors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export type CoastRock = { x: number; y: number; z: number; ry: number; tilt: number; s: number; sy: number; shade: number }

/** Boulders and stacks along the waterline, so the coast is never a clean edge. */
export const coastRocks = (board: Board): CoastRock[] => {
  const points = boundary(board, 5)
  const rng = makeRng(0x1f351d)
  const rocks: CoastRock[] = []
  for (const p of points) {
    const clumps = rng() > 0.45 ? 2 : 1
    for (let i = 0; i < clumps; i += 1) {
      const out = 0.14 + rng() * 0.32
      const along = (rng() - 0.5) * 0.22
      const s = 0.3 + rng() * 0.95
      // Rocks near the water are bigger and sit lower; the ones hugging the
      // cliff are smaller rubble caught on the ledges.
      const depth = 0.1 + out * 1.1
      rocks.push({
        x: p.x + p.nx * out - p.nz * along,
        y: GROUND_Y - depth - rng() * 0.12,
        z: p.z + p.nz * out + p.nx * along,
        ry: rng() * 6.283,
        tilt: (rng() - 0.5) * 0.5,
        s,
        sy: s * (0.7 + rng() * 1.1),
        shade: 0.72 + rng() * 0.5,
      })
    }
  }
  return rocks
}

/** Grass tufts clinging to the turf lip, so the clifftop is not a clean line. */
const coastTufts = (points: BoundaryPoint[]) => {
  const rng = makeRng(0x77c103)
  const tufts: Array<{ x: number; y: number; z: number; ry: number; s: number }> = []
  for (const p of points) {
    for (let i = 0; i < 3; i += 1) {
      if (rng() > 0.62) continue
      const out = 0.01 + rng() * 0.13
      const along = (rng() - 0.5) * 0.2
      tufts.push({
        x: p.x + p.nx * out - p.nz * along,
        y: GROUND_Y - 0.005 - out * 0.28,
        z: p.z + p.nz * out + p.nx * along,
        ry: rng() * 6.283,
        s: 0.5 + rng() * 0.7,
      })
    }
  }
  return tufts
}

const instanced = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  entries: Array<{ x: number; y: number; z: number; ry: number; tilt?: number; s: number; sy?: number; shade?: number }>,
  name: string,
) => {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length)
  mesh.name = name
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const color = new THREE.Color()
  entries.forEach((entry, index) => {
    quaternion.setFromEuler(new THREE.Euler(entry.tilt ?? 0, entry.ry, (entry.tilt ?? 0) * 0.6))
    matrix.compose(new THREE.Vector3(entry.x, entry.y, entry.z), quaternion, new THREE.Vector3(entry.s, entry.sy ?? entry.s, entry.s))
    mesh.setMatrixAt(index, matrix)
    color.setScalar(entry.shade ?? 1)
    mesh.setColorAt(index, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  return mesh
}

export function IslandBody({ board }: { board: Board }) {
  const built = useMemo(() => {
    const points = boundary(board, 7)
    const geometry = buildSkirt(points)
    const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })
    const tuftMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    const rocks = instanced(boulderGeometry(1), rockMaterial, coastRocks(board), 'coast-rocks')
    const tufts = instanced(tussockGeometry(), tuftMaterial, coastTufts(points), 'coast-tufts')
    return { geometry, meshes: [rocks, tufts], materials: [rockMaterial, tuftMaterial] }
  }, [board])

  useEffect(() => () => {
    built.geometry.dispose()
    for (const mesh of built.meshes) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    for (const material of built.materials) material.dispose()
  }, [built])

  return <group>
    <mesh geometry={built.geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.94} metalness={0} />
    </mesh>
    {built.meshes.map((mesh) => <primitive key={mesh.name} object={mesh} />)}
  </group>
}
