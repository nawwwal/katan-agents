import { Html, useCursor } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { Board, GameAction, GameDisplayState, HexTile, Terrain } from '../game/types'
import { AssetMesh } from './AssetKit'

const TERRAIN_ASSET: Record<Terrain, 'TerrainForest' | 'TerrainPasture' | 'TerrainFields' | 'TerrainHills' | 'TerrainMountains' | 'TerrainDesert'> = {
  lumber: 'TerrainForest',
  wool: 'TerrainPasture',
  grain: 'TerrainFields',
  brick: 'TerrainHills',
  ore: 'TerrainMountains',
  desert: 'TerrainDesert',
}

function NumberToken({ number, height = 0.095 }: { number: number; height?: number }) {
  const hot = number === 6 || number === 8
  return <group position={[0, height, 0]}>
    <AssetMesh asset="NumberToken" color={hot ? '#e5c692' : '#e8d6a4'} />
    <AssetMesh asset="NumberTokenRim" color={hot ? '#8f3326' : '#5e4528'} />
    <Html position={[0, 0.052, 0]} center distanceFactor={7.2} transform sprite style={{ pointerEvents: 'none' }}>
      <div className={`number-token physical ${hot ? 'hot' : ''}`} aria-hidden="true">{number}<small>{'•'.repeat(hot ? 5 : Math.max(1, 6 - Math.abs(7 - number)))}</small></div>
    </Html>
  </group>
}

function Robber({ height = 0.105 }: { height?: number }) {
  return <group position={[0, height, 0]}><AssetMesh asset="Robber" /></group>
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
  const tileHeight = 0.285
  return <group position={[tile.x, tileHeight + (hovered && legal ? 0.012 : 0), tile.z]}>
    <AssetMesh asset={TERRAIN_ASSET[tile.terrain]} onClick={click} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)} />
    {tile.number ? <NumberToken number={tile.number} height={0.215} /> : null}
    {legal ? <mesh position={[0, 0.235, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={click} renderOrder={2}>
      <ringGeometry args={[0.84, 0.97, 6, 1, Math.PI / 6]} />
      <meshBasicMaterial color="#ffd66a" transparent opacity={hovered ? 0.92 : 0.38} side={THREE.DoubleSide} toneMapped={false} />
    </mesh> : null}
    {robber ? <Robber height={0.235} /> : null}
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

function IslandBase() {
  return <AssetMesh asset="BoardFrame" />
}

function ShallowWater({ board }: { board: Board }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(makeRing(coastalVertices(board, 1.3), coastalVertices(board, 1.18))), [board])
  const foam = useMemo(() => new THREE.ShapeGeometry(makeRing(coastalVertices(board, 1.205), coastalVertices(board, 1.165))), [board])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => foam.dispose(), [foam])
  return <group position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <mesh geometry={geometry} renderOrder={-2}>
      <meshStandardMaterial color="#31b9bf" emissive="#075b70" emissiveIntensity={0.18} transparent opacity={0.38} roughness={0.28} depthWrite={false} />
    </mesh>
    <mesh geometry={foam} position={[0, 0, 0.006]} renderOrder={-1}>
      <meshBasicMaterial color="#b7f4e7" transparent opacity={0.52} depthWrite={false} toneMapped={false} />
    </mesh>
  </group>
}

function Harbors({ game }: { game: GameDisplayState }) {
  return <>{game.board.harbors.map((harbor) => {
    const edge = game.board.edges[harbor.edgeId]
    const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
    const x = ((a.x + b.x) / 2) * 1.16
    const z = ((a.z + b.z) / 2) * 1.16
    const angle = -Math.atan2(b.z - a.z, b.x - a.x)
    return <group key={harbor.id}>
      <group position={[x, 0.24, z]} rotation={[0, angle, 0]}>
      <AssetMesh asset="Port" />
      <Html position={[0, 0.21, 0]} center distanceFactor={7.4} transform sprite style={{ pointerEvents: 'none' }}><div className="harbor-label" aria-hidden="true">{harbor.ratio}:1<small>{harbor.resource?.slice(0, 1).toUpperCase() ?? '✦'}</small></div></Html>
      </group>
    </group>
  })}</>
}

export function Island({ game, robberActions, onAction }: { game: GameDisplayState; robberActions: Map<string, RobberAction>; onAction: (action: GameAction) => void }) {
  return <group>
    <ShallowWater board={game.board} />
    <IslandBase />
    {game.board.hexes.map((tile) => <TerrainTile key={tile.id} tile={tile} robber={tile.id === game.board.robberHexId} action={robberActions.get(tile.id)} onAction={onAction} />)}
    <Harbors game={game} />
  </group>
}
