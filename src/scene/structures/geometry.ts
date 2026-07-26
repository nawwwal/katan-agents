import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeRng } from './textures'

// Small kit of geometry helpers. Every piece is authored once at module scope
// and shared across instances, so a settlement costs one draw call per material
// no matter how many are on the board.

export type Part = {
  geo: THREE.BufferGeometry
  pos?: [number, number, number]
  rot?: [number, number, number]
  scale?: [number, number, number]
  /** Multiplies the part's UVs so texel density stays even across sizes. */
  uv?: [number, number]
  /**
   * Per-part vertex tint, multiplied into the material colour. Merged geometry
   * always carries a colour attribute, so a material with `vertexColors` can
   * give every stone in a wall its own value without a second draw call.
   */
  tint?: [number, number, number]
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
export const cyl = (rt: number, rb: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg)
export const cone = (r: number, h: number, seg = 4) => new THREE.ConeGeometry(r, h, seg)

/** Triangular prism, extruded along +Z and centred on the origin. */
export const prism = (width: number, height: number, depth: number) => {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, -height / 2)
  shape.lineTo(width / 2, -height / 2)
  shape.lineTo(0, height / 2)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/**
 * Gable roof: two tiled slabs plus a ridge cap. `width` runs along the ridge,
 * `depth` across it. The ridge sits at `rise` above the wall top, and the whole
 * thing is authored around the origin at the top of the wall.
 */
export const gableRoof = (
  width: number,
  depth: number,
  rise: number,
  thickness: number,
  overhang: number,
  ridge: 'x' | 'z' = 'x',
): Part[] => {
  const run = depth / 2 + overhang
  const slope = Math.hypot(run, rise)
  const angle = Math.atan2(rise, run)
  const length = width + overhang * 2
  const uv: [number, number] = [length * 9, slope * 9]
  if (ridge === 'x') {
    const slab = box(length, thickness, slope)
    return [
      { geo: slab, pos: [0, rise / 2, run / 2], rot: [angle, 0, 0], uv },
      { geo: slab.clone(), pos: [0, rise / 2, -run / 2], rot: [-angle, 0, 0], uv },
      { geo: box(length + thickness, thickness * 1.3, thickness * 2.4), pos: [0, rise + thickness * 0.3, 0], uv: [length * 9, 1] },
    ]
  }
  const slab = box(slope, thickness, length)
  return [
    { geo: slab, pos: [run / 2, rise / 2, 0], rot: [0, 0, -angle], uv: [slope * 9, length * 9] },
    { geo: slab.clone(), pos: [-run / 2, rise / 2, 0], rot: [0, 0, angle], uv: [slope * 9, length * 9] },
    { geo: box(thickness * 2.4, thickness * 1.3, length + thickness), pos: [0, rise + thickness * 0.3, 0], uv: [1, length * 9] },
  ]
}

export const merge = (parts: Part[]) => {
  const geometries = parts.map((part) => {
    const geometry = part.geo.clone().toNonIndexed()
    if (part.uv) {
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
      for (let index = 0; index < uv.count; index += 1) {
        uv.setXY(index, uv.getX(index) * part.uv[0], uv.getY(index) * part.uv[1])
      }
      uv.needsUpdate = true
    }
    const count = geometry.getAttribute('position').count
    const tint = part.tint ?? [1, 1, 1]
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = tint[0]
      colors[index * 3 + 1] = tint[1]
      colors[index * 3 + 2] = tint[2]
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.pos ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(part.scale ?? [1, 1, 1])),
    )
    geometry.applyMatrix4(matrix)
    return geometry
  })
  const merged = mergeGeometries(geometries, false)
  if (!merged) throw new Error('Failed to merge structure geometry')
  for (const geometry of geometries) geometry.dispose()
  // Normals come along from the sources, so smooth-shaded parts stay smooth.
  merged.computeBoundingSphere()
  return merged
}

/**
 * Revolved profile with per-column radial wobble — cheap cloth folds for the
 * robber's cloak. Deterministic: the wobble comes from a fixed seed.
 */
export const foldedLathe = (
  profile: Array<[number, number]>,
  segments: number,
  foldAmount: number,
  foldCount: number,
  seed: number,
) => {
  const random = makeRng(seed)
  const phases = Array.from({ length: segments }, () => random() * Math.PI * 2)
  const positions: number[] = []
  const uvs: number[] = []
  const radiusAt = (radius: number, theta: number, t: number) => {
    // Two beat frequencies keep the folds from looking like a fluted column.
    const fold = Math.sin(theta * foldCount + phases[0]) * 0.55
      + Math.sin(theta * (foldCount * 2 + 1) + phases[1]) * 0.3
      + Math.sin(theta * (foldCount + 3) + phases[2]) * 0.15
    return radius * (1 + fold * foldAmount * t)
  }
  const point = (index: number, segment: number) => {
    const [radius, y] = profile[index]
    const t = index / (profile.length - 1)
    const theta = (segment / segments) * Math.PI * 2
    const r = radiusAt(radius, theta, 1 - Math.abs(t - 0.55) * 1.2)
    return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r)
  }
  for (let index = 0; index < profile.length - 1; index += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = point(index, segment)
      const b = point(index + 1, segment)
      const c = point(index + 1, segment + 1)
      const d = point(index, segment + 1)
      const u0 = segment / segments
      const u1 = (segment + 1) / segments
      const v0 = index / (profile.length - 1)
      const v1 = (index + 1) / (profile.length - 1)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      uvs.push(u0, v0, u0, v1, u1, v1)
      positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z)
      uvs.push(u0, v0, u1, v1, u1, v0)
    }
  }
  const raw = new THREE.BufferGeometry()
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  raw.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Weld before shading so cloth reads as a smooth surface, not facets.
  const geometry = mergeVertices(raw, 1e-4)
  geometry.computeVertexNormals()
  raw.dispose()
  return geometry
}

/** Shears a geometry forward along +Z, more the higher up it is. */
export const lean = (geometry: THREE.BufferGeometry, amount: number, height: number) => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    const t = Math.max(0, y / height)
    position.setZ(index, position.getZ(index) + t * t * amount)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Swallow-tail pennant that flies along +X from a mast at the origin, with a
 * baked ripple so it never reads as a flat card.
 */
export const pennant = (length: number, height: number, ripple = 0.014) => {
  const shape = new THREE.Shape()
  shape.moveTo(0, -height / 2)
  shape.lineTo(length, -height / 2)
  shape.lineTo(length * 0.78, 0)
  shape.lineTo(length, height / 2)
  shape.lineTo(0, height / 2)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 1 })
  const dense = geometry.toNonIndexed()
  geometry.dispose()
  const position = dense.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const t = position.getX(index) / length
    position.setZ(index, position.getZ(index) + Math.sin(t * Math.PI * 2.2) * ripple * t)
  }
  position.needsUpdate = true
  dense.computeVertexNormals()
  return dense
}

/** Hanging banner: a vertical cloth with a weighted, slightly curled tail. */
export const banner = (width: number, height: number) => {
  const geometry = new THREE.PlaneGeometry(width, height, 3, 6)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const drop = (height / 2 - y) / height
    position.setZ(index, Math.cos((x / width) * Math.PI) * 0.008 + drop * drop * 0.02)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** Ring of merlons around a battlement, returned as merge-ready parts. */
export const merlons = (radius: number, count: number, size: number, height: number, y: number): Part[] =>
  Array.from({ length: count }, (_, index) => {
    const theta = (index / count) * Math.PI * 2
    return {
      geo: box(size, height, size * 0.7),
      pos: [Math.cos(theta) * radius, y, Math.sin(theta) * radius] as [number, number, number],
      rot: [0, -theta, 0] as [number, number, number],
      uv: [3, 3] as [number, number],
    }
  })
