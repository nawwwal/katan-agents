import * as THREE from 'three'

/**
 * Ribbon that leans out from the rock face down to the waterline. The inner
 * edge tucks behind the cliff so the spray reads as thrown up the rock rather
 * than as a flat ring painted on the sea.
 */
export const createSurfSkirt = (outline: THREE.Vector2[], inset: number, reach: number, rise: number) => {
  const count = outline.length
  const positions = new Float32Array(count * 2 * 3)
  const uvs = new Float32Array(count * 2 * 2)
  const indices = new Uint32Array(count * 6)

  const normals: THREE.Vector2[] = outline.map((point, i) => {
    const prev = outline[(i - 1 + count) % count]
    const next = outline[(i + 1) % count]
    const tangent = new THREE.Vector2(next.x - prev.x, next.y - prev.y).normalize()
    const normal = new THREE.Vector2(tangent.y, -tangent.x)
    if (normal.dot(point) < 0) normal.negate()
    return normal
  })

  let p = 0
  let u = 0
  for (let i = 0; i < count; i += 1) {
    const point = outline[i]
    const normal = normals[i]
    // Inner edge: behind the rock, lifted.
    positions[p++] = point.x - normal.x * inset
    positions[p++] = rise
    positions[p++] = point.y - normal.y * inset
    // Outer edge: out on the water.
    positions[p++] = point.x + normal.x * reach
    positions[p++] = 0
    positions[p++] = point.y + normal.y * reach
    const along = i / count
    uvs[u++] = along
    uvs[u++] = 0
    uvs[u++] = along
    uvs[u++] = 1
  }

  let index = 0
  for (let i = 0; i < count; i += 1) {
    const a = i * 2
    const b = ((i + 1) % count) * 2
    indices[index++] = a
    indices[index++] = a + 1
    indices[index++] = b
    indices[index++] = b
    indices[index++] = a + 1
    indices[index++] = b + 1
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

/** Deterministically lumpy rock, faceted enough to catch the key light. */
export const createRockGeometry = (variant: number) => {
  const geometry = new THREE.IcosahedronGeometry(1, 2)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const seed = 13.71 + variant * 5.29
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const n = Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed) + Math.sin(y * 4.3 + seed * 1.7) * 0.6
      + Math.sin(x * 8.7 - z * 7.1 + seed) * 0.34 + Math.cos(y * 9.3 + x * 6.1 - seed) * 0.26
    const scale = 1 + n * 0.16
    position.setXYZ(i, x * scale, y * scale * 0.86, z * scale)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}
