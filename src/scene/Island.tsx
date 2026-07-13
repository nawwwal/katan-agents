import { Html, useCursor, useTexture } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Board, GameAction, GameDisplayState, HexTile, Terrain } from '../game/types'
import { TerrainProps } from './Props'

const TERRAIN_ASSET: Record<Terrain, string> = {
  lumber: 'forest',
  wool: 'pasture',
  grain: 'grain',
  brick: 'brick',
  ore: 'ore',
  desert: 'desert',
}

const TERRAIN_SIDE: Record<Terrain, string> = {
  lumber: '#246441',
  wool: '#65a641',
  grain: '#bc7d1d',
  brick: '#a94c2a',
  ore: '#506b80',
  desert: '#c88c32',
}

function TerrainMaterial({ terrain, rotation }: { terrain: Terrain; rotation: number }) {
  const asset = TERRAIN_ASSET[terrain]
  const source = useTexture(`/assets/terrain/${asset}-albedo.webp`)
  const texture = useMemo(() => source.clone(), [source])
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.repeat.set(1, 1)
    texture.offset.set(0, 0)
    texture.center.set(0.5, 0.5)
    texture.rotation = rotation
    texture.needsUpdate = true
    return () => texture.dispose()
  }, [rotation, texture])
  return <meshStandardMaterial map={texture} roughness={0.73} metalness={0.015} />
}

function NumberToken({ number, height = 0.095 }: { number: number; height?: number }) {
  const hot = number === 6 || number === 8
  return <group position={[0, height, 0]}>
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.17, 0.182, 0.065, 28]} />
      <meshStandardMaterial color={hot ? '#e5c692' : '#e8d6a4'} roughness={0.72} metalness={0.04} />
    </mesh>
    <mesh position={[0, 0.046, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.14, 0.168, 32]} />
      <meshStandardMaterial color={hot ? '#8f3326' : '#5e4528'} roughness={0.7} />
    </mesh>
    <Html position={[0, 0.052, 0]} center distanceFactor={7.2} transform sprite style={{ pointerEvents: 'none' }}>
      <div className={`number-token physical ${hot ? 'hot' : ''}`} aria-hidden="true">{number}<small>{'•'.repeat(hot ? 5 : Math.max(1, 6 - Math.abs(7 - number)))}</small></div>
    </Html>
  </group>
}

function Robber() {
  return <group position={[0, 0.345, 0]}>
    <mesh castShadow><cylinderGeometry args={[0.15, 0.24, 0.48, 12]} /><meshStandardMaterial color="#24282d" roughness={0.58} metalness={0.3} /></mesh>
    <mesh castShadow position={[0, 0.29, 0]}><sphereGeometry args={[0.15, 14, 10]} /><meshStandardMaterial color="#32373c" roughness={0.54} metalness={0.26} /></mesh>
    <mesh position={[0, -0.24, 0]}><torusGeometry args={[0.22, 0.045, 8, 20]} /><meshStandardMaterial color="#12161a" roughness={0.8} /></mesh>
    <mesh position={[0, 0.31, 0.135]}><boxGeometry args={[0.16, 0.04, 0.025]} /><meshStandardMaterial color="#0b0d0f" /></mesh>
  </group>
}

type RobberAction = Extract<GameAction, { type: 'move-robber' }>

function TerrainTile({ tile, robber, action, onAction }: { tile: HexTile; robber: boolean; action?: RobberAction; onAction: (action: GameAction) => void }) {
  const [hovered, setHovered] = useState(false)
  const legal = Boolean(action)
  useCursor(hovered && legal)
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (action) onAction(action)
  }
  return <group position={[tile.x, 0.405 + (hovered && legal ? 0.012 : 0), tile.z]}>
    <mesh castShadow receiveShadow onClick={click} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
      <cylinderGeometry args={[0.997, 1, 0.08, 6, 2]} />
      <meshStandardMaterial color={TERRAIN_SIDE[tile.terrain]} roughness={0.94} />
    </mesh>
    <mesh castShadow receiveShadow position={[0, 0.048, 0]}>
      <cylinderGeometry args={[0.994, 0.997, 0.016, 6, 1]} />
      <TerrainMaterial terrain={tile.terrain} rotation={((tile.q * 2 + tile.r * 3) % 6) * Math.PI / 3} />
    </mesh>
    {tile.number ? <NumberToken number={tile.number} /> : null}
    {legal ? <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={click}>
      <ringGeometry args={[0.84, 0.97, 6, 1, Math.PI / 6]} />
      <meshBasicMaterial color="#ffd66a" transparent opacity={hovered ? 0.9 : 0.42} side={THREE.DoubleSide} />
    </mesh> : null}
    {robber ? <Robber /> : null}
  </group>
}

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

function CoastRocks({ board }: { board: Board }) {
  const points = useMemo(() => coastalVertices(board, 1.15).filter((_, index) => index % 3 === 0), [board])
  const mesh = useMemo(() => {
    const geometry = new THREE.DodecahedronGeometry(1, 0)
    const material = new THREE.MeshStandardMaterial({ color: '#756653', roughness: 0.95 })
    const instances = new THREE.InstancedMesh(geometry, material, points.length)
    const object = new THREE.Object3D()
    points.forEach((point, index) => {
      const scale = 0.14 + ((index * 7) % 5) * 0.018
      object.position.set(point.x, 0.4 + (index % 3) * 0.025, point.y)
      object.rotation.set(index * 0.17, index * 0.63, index * 0.11)
      object.scale.set(scale * 1.25, scale * 0.72, scale)
      object.updateMatrix()
      instances.setMatrixAt(index, object.matrix)
      instances.setColorAt(index, new THREE.Color(index % 4 === 0 ? '#9b8a70' : index % 3 === 0 ? '#6f756b' : '#82745f'))
    })
    instances.castShadow = true
    instances.receiveShadow = true
    return instances
  }, [points])
  useEffect(() => () => { mesh.geometry.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose()); else mesh.material.dispose() }, [mesh])
  return <primitive object={mesh} />
}

function CoastShrubs({ board }: { board: Board }) {
  const points = useMemo(() => coastalVertices(board, 1.095).filter((_, index) => index % 3 === 1), [board])
  const mesh = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 1)
    const material = new THREE.MeshStandardMaterial({ color: '#4f793f', roughness: 0.98 })
    const instances = new THREE.InstancedMesh(geometry, material, points.length)
    const object = new THREE.Object3D()
    points.forEach((point, index) => {
      const scale = 0.09 + (index % 4) * 0.014
      object.position.set(point.x, 0.44 + (index % 2) * 0.018, point.y)
      object.rotation.set(index * 0.1, index * 0.7, index * 0.08)
      object.scale.set(scale * 1.25, scale, scale)
      object.updateMatrix()
      instances.setMatrixAt(index, object.matrix)
      instances.setColorAt(index, new THREE.Color(index % 3 === 0 ? '#6c944e' : '#416d3d'))
    })
    instances.castShadow = true
    return instances
  }, [points])
  useEffect(() => () => { mesh.geometry.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose()); else mesh.material.dispose() }, [mesh])
  return <primitive object={mesh} />
}

function IslandBase({ board }: { board: Board }) {
  const cliff = useMemo(() => new THREE.ExtrudeGeometry(makeShape(coastalVertices(board, 1.18)), {
    depth: 0.44,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.085,
    bevelThickness: 0.065,
    curveSegments: 4,
  }), [board])
  const beach = useMemo(() => new THREE.ShapeGeometry(makeShape(coastalVertices(board, 1.15))), [board])
  const turf = useMemo(() => new THREE.ExtrudeGeometry(makeShape(coastalVertices(board, 1.105)), {
    depth: 0.11,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.045,
    bevelThickness: 0.035,
    curveSegments: 4,
  }), [board])
  const textures = useTexture({
    grass: '/assets/terrain/pasture-albedo.webp',
    rock: '/assets/terrain/ore-albedo.webp',
    sand: '/assets/terrain/desert-albedo.webp',
  })
  useEffect(() => {
    textures.grass.colorSpace = THREE.SRGBColorSpace
    textures.rock.colorSpace = THREE.SRGBColorSpace
    textures.sand.colorSpace = THREE.SRGBColorSpace
    Object.values(textures).forEach((texture) => {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(0.42, 0.42)
      texture.anisotropy = 8
      texture.needsUpdate = true
    })
    return () => { cliff.dispose(); beach.dispose(); turf.dispose() }
  }, [beach, cliff, textures, turf])

  return <group>
    <mesh geometry={cliff} position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial map={textures.rock} color="#8c6d56" roughness={0.82} />
    </mesh>
    <mesh geometry={beach} position={[0, 0.305, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial map={textures.sand} color="#f2c66a" roughness={0.78} />
    </mesh>
    <mesh geometry={turf} position={[0, 0.405, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial map={textures.grass} color="#75a84d" roughness={0.8} />
    </mesh>
    <CoastRocks board={board} />
    <CoastShrubs board={board} />
  </group>
}

function ShallowWater({ board }: { board: Board }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(makeRing(coastalVertices(board, 1.3), coastalVertices(board, 1.18))), [board])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
    <meshStandardMaterial color="#4ec4c2" emissive="#0b777c" emissiveIntensity={0.14} transparent opacity={0.26} roughness={0.32} depthWrite={false} />
  </mesh>
}

function Sailboat({ position, rotation, reducedMotion, color }: { position: [number, number, number]; rotation: number; reducedMotion: boolean; color: string }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return
    group.current.position.y = position[1] + Math.sin(clock.elapsedTime * 1.2 + position[0]) * 0.025
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + position[2]) * 0.035
  })
  return <group ref={group} position={position} rotation={[0, rotation, 0]}>
    <mesh castShadow position={[0, 0.03, 0]} scale={[1.65, 0.48, 0.72]}><sphereGeometry args={[0.19, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#5b2f1e" roughness={0.82} /></mesh>
    <mesh castShadow position={[0, 0.28, 0]}><cylinderGeometry args={[0.018, 0.025, 0.55, 7]} /><meshStandardMaterial color="#3c281d" roughness={0.88} /></mesh>
    <mesh castShadow position={[0.12, 0.3, 0]} rotation={[0, 0, -0.16]}><coneGeometry args={[0.21, 0.46, 3]} /><meshStandardMaterial color="#f2e5c4" side={THREE.DoubleSide} roughness={0.72} /></mesh>
    <mesh position={[-0.1, 0.52, 0]}><planeGeometry args={[0.2, 0.09]} /><meshStandardMaterial color={color} side={THREE.DoubleSide} /></mesh>
  </group>
}

function Lighthouse({ position }: { position: [number, number, number] }) {
  return <group position={position} scale={0.8}>
    <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.1, 0.16, 0.5, 12]} /><meshStandardMaterial color="#eee3c7" roughness={0.78} /></mesh>
    <mesh castShadow position={[0, 0.26, 0]}><cylinderGeometry args={[0.103, 0.163, 0.12, 12]} /><meshStandardMaterial color="#bd4b34" roughness={0.7} /></mesh>
    <mesh castShadow position={[0, 0.56, 0]}><cylinderGeometry args={[0.13, 0.13, 0.1, 12]} /><meshStandardMaterial color="#523025" metalness={0.18} roughness={0.66} /></mesh>
    <pointLight position={[0, 0.58, 0]} color="#ffd36b" intensity={1.1} distance={2.2} />
  </group>
}

function Harbors({ game, reducedMotion }: { game: GameDisplayState; reducedMotion: boolean }) {
  return <>{game.board.harbors.map((harbor, index) => {
    const edge = game.board.edges[harbor.edgeId]
    const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
    const x = ((a.x + b.x) / 2) * 1.16
    const z = ((a.z + b.z) / 2) * 1.16
    const angle = -Math.atan2(b.z - a.z, b.x - a.x)
    const outward = new THREE.Vector2(x, z).normalize()
    const shipPosition = [x + outward.x * 0.58, 0.01, z + outward.y * 0.58] as [number, number, number]
    return <group key={harbor.id}>
      <group position={[x, 0.24, z]} rotation={[0, angle, 0]}>
      <mesh receiveShadow castShadow><boxGeometry args={[0.52, 0.12, 0.34]} /><meshStandardMaterial color="#72482c" roughness={0.8} /></mesh>
      {[-0.16, 0, 0.16].map((offset) => <mesh key={offset} position={[offset, 0.075, 0]}><boxGeometry args={[0.09, 0.025, 0.31]} /><meshStandardMaterial color="#bd7a3d" roughness={0.76} /></mesh>)}
      <Html position={[0, 0.21, 0]} center distanceFactor={7.4} transform sprite style={{ pointerEvents: 'none' }}><div className="harbor-label" aria-hidden="true">{harbor.ratio}:1<small>{harbor.resource?.slice(0, 1).toUpperCase() ?? '✦'}</small></div></Html>
      </group>
      {index % 3 === 0 ? <Sailboat position={shipPosition} rotation={angle + Math.PI / 2} reducedMotion={reducedMotion} color={index % 2 ? '#327fc1' : '#d25038'} /> : null}
      {index === 0 ? <Lighthouse position={[x - outward.x * 0.32, 0.27, z - outward.y * 0.32]} /> : null}
    </group>
  })}</>
}

export function Island({ game, robberActions, onAction, reducedMotion = false }: { game: GameDisplayState; robberActions: Map<string, RobberAction>; onAction: (action: GameAction) => void; reducedMotion?: boolean }) {
  return <group>
    <ShallowWater board={game.board} />
    <IslandBase board={game.board} />
    {game.board.hexes.map((tile) => <TerrainTile key={tile.id} tile={tile} robber={tile.id === game.board.robberHexId} action={robberActions.get(tile.id)} onAction={onAction} />)}
    <TerrainProps board={game.board} reducedMotion={reducedMotion} />
    <Harbors game={game} reducedMotion={reducedMotion} />
  </group>
}
