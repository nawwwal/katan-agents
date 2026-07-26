import * as THREE from 'three'
import { OCEAN_RADIUS } from './oceanConfig'

/**
 * Radial disc laid out in the XZ plane with power-law ring spacing, so vertex
 * density concentrates around the island and thins out toward the horizon.
 */
export const createOceanDisc = (rings = 208, segments = 256, radius = OCEAN_RADIUS, falloff = 3.4) => {
  const vertexCount = (rings + 1) * (segments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(rings * segments * 6)

  let p = 0
  let n = 0
  let u = 0
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings
    const r = Math.pow(t, falloff) * radius
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2
      positions[p++] = Math.cos(angle) * r
      positions[p++] = 0
      positions[p++] = Math.sin(angle) * r
      normals[n++] = 0
      normals[n++] = 1
      normals[n++] = 0
      uvs[u++] = segment / segments
      uvs[u++] = t
    }
  }

  let i = 0
  const stride = segments + 1
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * stride + segment
      const b = a + stride
      // Counter-clockwise seen from above, or the whole disc is backfacing.
      indices[i++] = a
      indices[i++] = a + 1
      indices[i++] = b
      indices[i++] = a + 1
      indices[i++] = b + 1
      indices[i++] = b
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.05)
  return geometry
}
