import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Board } from '../game/types'

const coastalVertices = (board: Board, scale: number) => Object.values(board.vertices)
  .filter((vertex) => vertex.hexes.length < 3)
  .toSorted((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x))
  .map((vertex) => new THREE.Vector2(vertex.x * scale, vertex.z * scale))

const makeShape = (points: THREE.Vector2[]) => {
  const shape = new THREE.Shape()
  const last = points.at(-1)!
  const first = points[0]
  shape.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    shape.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
  })
  shape.closePath()
  return shape
}

const makeRing = (outer: THREE.Vector2[], inner: THREE.Vector2[]) => {
  const shape = makeShape(outer)
  const holeShape = makeShape(inner)
  const hole = new THREE.Path(holeShape.getPoints(96))
  shape.holes.push(hole)
  return shape
}

export function ShallowWater({ board }: { board: Board }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(makeRing(coastalVertices(board, 1.22), coastalVertices(board, 1.045))), [board])
  const foam = useMemo(() => new THREE.ShapeGeometry(makeRing(coastalVertices(board, 1.115), coastalVertices(board, 1.055))), [board])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => foam.dispose(), [foam])
  return <group position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <mesh geometry={geometry} renderOrder={-2}>
      <meshStandardMaterial color="#54c6bc" transparent opacity={0.24} roughness={0.22} depthWrite={false} />
    </mesh>
    <mesh geometry={foam} position={[0, 0, 0.006]} renderOrder={-1}>
      <shaderMaterial
        transparent
        depthWrite={false}
        toneMapped={false}
        vertexShader={`varying vec3 vWorld; void main() { vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`varying vec3 vWorld; void main() { float a = sin(vWorld.x * 4.1 + vWorld.z * 1.7); float b = sin(vWorld.z * 5.3 - vWorld.x * 1.2); float broken = smoothstep(0.12, 0.88, a * 0.52 + b * 0.48); gl_FragColor = vec4(0.84, 0.97, 0.92, broken * 0.62); }`}
      />
    </mesh>
  </group>
}
