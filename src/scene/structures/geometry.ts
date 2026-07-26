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
 * Vertical prism from a polygon drawn on the ground plane. Points are `[x, z]`
 * in world axes and the solid runs from `top - thickness` up to `top`.
 *
 * Road joinery needs shapes a box cannot express — mitred kerb ends and hexagon
 * sectors at a junction — and every one of them is a flat plate with an
 * arbitrary outline, so they all come from here.
 */
export const plate = (points: Array<[number, number]>, top: number, thickness: number) => {
  // ExtrudeGeometry wants a counter-clockwise outline in its own XY plane, and
  // mapping z to -y flips the winding, so measure it after the flip.
  const flipped = points.map(([x, z]) => [x, -z] as [number, number])
  let area = 0
  for (let index = 0; index < flipped.length; index += 1) {
    const [x0, y0] = flipped[index]
    const [x1, y1] = flipped[(index + 1) % flipped.length]
    area += x0 * y1 - x1 * y0
  }
  const outline = area < 0 ? [...flipped].reverse() : flipped
  const shape = new THREE.Shape()
  outline.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, top - thickness, 0)
  return geometry
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
    // Folds are deepest at the hem and fade towards the shoulders. The old
    // weighting peaked in the middle of the profile, which put the cloth
    // movement where nothing sees it: at board scale the only fold that reads
    // is one that bites the silhouette, and the silhouette is the hem.
    const r = radiusAt(radius, theta, 0.3 + 0.7 * (1 - t) ** 0.8)
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

/**
 * A slack line between two points, built as a chain of short cylinders with a
 * parabolic sag. Used for mooring warps: a rope that visibly runs from a
 * bollard to a boat is what makes the boat read as moored rather than adrift.
 */
export const ropeLine = (
  from: [number, number, number],
  to: [number, number, number],
  sag: number,
  radius = 0.006,
  segments = 5,
): Part[] => {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const at = (t: number) => {
    const point = a.clone().lerp(b, t)
    point.y -= sag * 4 * t * (1 - t)
    return point
  }
  const parts: Part[] = []
  const up = new THREE.Vector3(0, 1, 0)
  for (let index = 0; index < segments; index += 1) {
    const p0 = at(index / segments)
    const p1 = at((index + 1) / segments)
    const mid = p0.clone().add(p1).multiplyScalar(0.5)
    const dir = p1.clone().sub(p0)
    const length = dir.length()
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize())
    const euler = new THREE.Euler().setFromQuaternion(quaternion)
    parts.push({
      geo: cyl(radius, radius, length, 5),
      pos: [mid.x, mid.y, mid.z],
      rot: [euler.x, euler.y, euler.z],
      uv: [1, 1],
    })
  }
  return parts
}

/**
 * A clinker-built open boat hull: outer skin, inner skin, rail cap and floor,
 * so a camera looking down into it sees planking rather than straight through
 * the far side. `+X` is the bow. The waterline sits at local `y = 0`.
 */
export const openHull = (
  length: number,
  beam: number,
  freeboard: number,
  draft: number,
  segments = 20,
): Part[] => {
  const plan = (theta: number, xScale: number, zScale: number) => {
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    // Raising the sine exponent pulls the beam in near the ends, which is what
    // turns an ellipse into something with a stem and a stern post.
    const x = length * Math.sign(c) * Math.abs(c) ** 0.82 * (c > 0 ? 1 : 0.88)
    const z = beam * Math.sign(s) * Math.abs(s) ** 1.55
    return new THREE.Vector3(x * xScale, 0, z * zScale)
  }
  const sheerY = (theta: number) => freeboard + Math.abs(Math.cos(theta)) ** 3 * freeboard * 0.85
  const ring = (xScale: number, zScale: number, y: (theta: number) => number) =>
    Array.from({ length: segments }, (_, index) => {
      const theta = (index / segments) * Math.PI * 2
      const point = plan(theta, xScale, zScale)
      point.y = y(theta)
      return point
    })

  const outerSheer = ring(1, 1, sheerY)
  const outerKeel = ring(0.9, 0.66, () => -draft)
  const innerSheer = ring(0.94, 0.84, (theta) => sheerY(theta) - 0.004)
  const innerKeel = ring(0.84, 0.5, () => -draft + 0.016)

  const positions: number[] = []
  const uvs: number[] = []
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    uvs.push(u, 0, u, 1, u + 0.5, 1)
  }
  const strip = (top: THREE.Vector3[], bottom: THREE.Vector3[], flip: boolean) => {
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments
      const u = index / segments
      if (flip) {
        tri(top[index], bottom[index], bottom[next], u)
        tri(top[index], bottom[next], top[next], u)
      } else {
        tri(top[index], bottom[next], bottom[index], u)
        tri(top[index], top[next], bottom[next], u)
      }
    }
  }
  const fan = (loop: THREE.Vector3[], y: number, up: boolean) => {
    const centre = new THREE.Vector3(0, y, 0)
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments
      const a = loop[index].clone(); a.y = y
      const b = loop[next].clone(); b.y = y
      if (up) tri(centre, b, a, index / segments)
      else tri(centre, a, b, index / segments)
    }
  }

  strip(outerSheer, outerKeel, false)
  strip(innerSheer, innerKeel, true)
  fan(outerKeel, -draft, false)
  fan(innerKeel, -draft + 0.016, true)
  const railFrom = positions.length
  strip(outerSheer, innerSheer, true)

  const build = (start: number, end: number) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.slice(start, end), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.slice((start / 3) * 2, (end / 3) * 2), 2))
    geometry.computeVertexNormals()
    return geometry
  }
  return [
    { geo: build(0, railFrom), tint: [0.5, 0.44, 0.4] },
    { geo: build(railFrom, positions.length), tint: [1.15, 1.08, 0.98] },
  ]
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
