import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type * as THREE from 'three'
import type { GameAction, GameDisplayState } from '../game/types'
import { MOTION_SPEED } from './motion/spring'
import { ShallowWater } from './Shoreline'
import {
  ROBBER_MARK,
  ROBBER_PERIOD,
  frameMaterial,
  robberBandGeometry,
  robberKerbGeometry,
} from './structures/Beacon'
import { HarborPiers } from './structures/Harbor'
import { NumberTokenMesh } from './structures/NumberToken'
import { RobberFigure } from './structures/Robber'
import { IslandBody } from './terrain/IslandBody'
import { GROUND_Y, TOKEN_LIFT } from './terrain/hex'
import { useTerrainField, type TileSurfaceEntry } from './terrain/TerrainField'
import { TokenPlinth } from './terrain/TokenPlinth'
import { useReducedMotion } from './useReducedMotion'

type RobberAction = Extract<GameAction, { type: 'move-robber' }>

/**
 * A hex the robber may be moved to, in the board's shared marker language: a
 * near-black kerb standing clear of the hex seam with a bright band inlaid
 * along its top.
 *
 * These pulse in unison, unlike the placement beacons, which carry a per-target
 * phase offset. That difference is meaningful rather than cosmetic. Fifty
 * corners offered at once are fifty independent options and strobing them
 * together is a migraine; eighteen hexes offered during `move-robber` are one
 * set of answers to one question, and beating together is what says so.
 */
function RobberRing({ hovered, reducedMotion, onClick }: { hovered: boolean; reducedMotion: boolean; onClick: (event: ThreeEvent<MouseEvent>) => void }) {
  const band = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!band.current) return
    // A constant under reduced motion, never an accumulator, so this cannot
    // leave a frozen artifact on the board the way the older effects do.
    const pulse = reducedMotion ? 1 : 0.5 - Math.cos(((clock.elapsedTime * MOTION_SPEED) / ROBBER_PERIOD) * Math.PI * 2) / 2
    const grow = 0.994 + pulse * 0.014
    band.current.scale.set(grow, 1, grow)
    const material = band.current.material as THREE.MeshBasicMaterial
    material.color.set(hovered ? '#fff0e4' : ROBBER_MARK).multiplyScalar(hovered ? 1 : 0.82 + pulse * 0.18)
  })
  return <group onClick={onClick}>
    <mesh geometry={robberKerbGeometry()} material={frameMaterial()} castShadow receiveShadow />
    <mesh ref={band} geometry={robberBandGeometry()}>
      <meshBasicMaterial color={ROBBER_MARK} toneMapped={false} />
    </mesh>
  </group>
}

type TileProps = {
  x: number
  z: number
  index: number
  number?: number
  surface: TileSurfaceEntry
  robber: boolean
  reducedMotion: boolean
  action?: RobberAction
  onAction: (action: GameAction) => void
}

function TerrainTile({ x, z, index, number, surface, robber, reducedMotion, action, onAction }: TileProps) {
  const [hovered, setHovered] = useState(false)
  const legal = Boolean(action)
  useCursor(hovered && legal)
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (action) onAction(action)
  }
  // Tile relief is authored around zero and fades to nothing at the hex
  // boundary, so every tile sits on the island plateau and roads and buildings
  // at Y 0.478 stay flush on the shared seam.
  return <group position={[x, GROUND_Y, z]}>
    <mesh
      geometry={surface.geometry}
      material={surface.material}
      receiveShadow
      castShadow
      onClick={click}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    />
    {number ? <>
      <TokenPlinth variant={index} />
      <NumberTokenMesh number={number} height={TOKEN_LIFT} />
    </> : null}
    {legal ? <RobberRing hovered={hovered} reducedMotion={reducedMotion} onClick={click} /> : null}
    {/* The cairn owns the middle of a numbered tile, so the robber stands beside
        it rather than inside it. On the desert there is no cairn and he keeps
        the centre. */}
    {robber ? <group position={[number ? 0.44 : 0, 0, number ? 0.16 : 0]}>
      <RobberFigure height={0.17} />
    </group> : null}
  </group>
}

export function Island({ game, robberActions, onAction }: { game: GameDisplayState; robberActions: Map<string, RobberAction>; onAction: (action: GameAction) => void }) {
  const field = useTerrainField(game.board)
  // Read once here rather than in each of the nineteen tiles, which would
  // otherwise each register their own media-query listener.
  const reducedMotion = useReducedMotion()
  return <group>
    <ShallowWater board={game.board} />
    <IslandBody board={game.board} />
    <mesh geometry={field.borders} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
    {field.meshes.map((mesh) => <primitive key={mesh.name} object={mesh} />)}
    {game.board.hexes.map((tile, index) => <TerrainTile
      key={tile.id}
      x={tile.x}
      z={tile.z}
      index={index}
      number={tile.number}
      surface={field.tiles[index]}
      robber={tile.id === game.board.robberHexId}
      reducedMotion={reducedMotion}
      action={robberActions.get(tile.id)}
      onAction={onAction}
    />)}
    <HarborPiers game={game} />
  </group>
}
