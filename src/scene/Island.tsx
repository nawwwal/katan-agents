import { useCursor } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useState } from 'react'
import * as THREE from 'three'
import type { GameAction, GameDisplayState } from '../game/types'
import { ShallowWater } from './Shoreline'
import { HarborPiers } from './structures/Harbor'
import { NumberTokenMesh } from './structures/NumberToken'
import { RobberFigure } from './structures/Robber'
import { IslandBody } from './terrain/IslandBody'
import { GROUND_Y, TOKEN_LIFT } from './terrain/hex'
import { useTerrainField, type TileSurfaceEntry } from './terrain/TerrainField'
import { TokenPlinth } from './terrain/TokenPlinth'

type RobberAction = Extract<GameAction, { type: 'move-robber' }>

type TileProps = {
  x: number
  z: number
  index: number
  number?: number
  surface: TileSurfaceEntry
  robber: boolean
  action?: RobberAction
  onAction: (action: GameAction) => void
}

function TerrainTile({ x, z, index, number, surface, robber, action, onAction }: TileProps) {
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
    {legal ? <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={click} renderOrder={2}>
      <ringGeometry args={[0.84, 0.97, 6, 1, Math.PI / 6]} />
      <meshBasicMaterial color="#ffd66a" transparent opacity={hovered ? 0.92 : 0.38} side={THREE.DoubleSide} toneMapped={false} />
    </mesh> : null}
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
      action={robberActions.get(tile.id)}
      onAction={onAction}
    />)}
    <HarborPiers game={game} />
  </group>
}
