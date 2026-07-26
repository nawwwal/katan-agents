import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { GameAction, GameDisplayState } from '../game/types'
import { robberPose, useRobberPose } from './motion/robber'
import { MOTION_SPEED, seededFrom } from './motion/spring'
import { PLAYER_BEACON } from './playerColors'
import { ShallowWater } from './Shoreline'
import {
  ROBBER_MARK,
  ROBBER_PERIOD,
  collarBandGeometry,
  collarGeometry,
  frameMaterial,
  robberBandGeometry,
  robberKerbGeometry,
} from './structures/Beacon'
import { HarborPiers } from './structures/Harbor'
import { NumberTokenMesh } from './structures/NumberToken'
import { RobberHandle } from './structures/RobberHandle'
import { IslandBody } from './terrain/IslandBody'
import { GROUND_Y, TOKEN_LIFT } from './terrain/hex'
import { useTerrainField, type TileSurfaceEntry } from './terrain/TerrainField'
import { TokenPlinth } from './terrain/TokenPlinth'
import { useReducedMotion } from './useReducedMotion'

type RobberAction = Extract<GameAction, { type: 'move-robber' }>

const EMPTY_STEALS: Map<string, GameAction> = new Map()

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
 *
 * The strength is read from the robber's own state machine every frame rather
 * than from props, because the answer changes with a finger. Eighteen marks at
 * one level is a set of offers; eighteen marks with one of them at full and the
 * rest stepped back is an answer, and stepping the rest back is also the second
 * half of the honeycomb fix — the brackets took sixty percent of the red ink
 * off the board at rest, and arming the piece takes most of the remainder off
 * every hex the player is not currently pointing at.
 */
function RobberRing({ hexId, hovered, reducedMotion, onClick }: { hexId: string; hovered: boolean; reducedMotion: boolean; onClick: (event: ThreeEvent<MouseEvent>) => void }) {
  const band = useRef<THREE.Mesh>(null)
  const kerb = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!band.current) return
    const pose = robberPose()
    const carried = pose.stage === 'dragging' || pose.stage === 'armed'
    const chosen = pose.candidateHexId === hexId
    // A constant under reduced motion, never an accumulator, so this cannot
    // leave a frozen artifact on the board the way the older effects do. Armed
    // beats faster: one urgent question, asked with a piece in hand.
    const period = carried ? ROBBER_PERIOD * 0.86 : ROBBER_PERIOD
    const pulse = reducedMotion ? 1 : 0.5 - Math.cos(((clock.elapsedTime * MOTION_SPEED) / period) * Math.PI * 2) / 2
    // A commit in flight holds the marks visible and dim rather than clearing
    // them. A board that empties for a round trip reads as a click that failed.
    const base = pose.stage === 'sending' ? 0.34 : carried ? (chosen ? 1 : 0.46) : 0.82 + pulse * 0.18
    const grow = (0.994 + pulse * 0.014) * (chosen ? 1.05 : 1)
    band.current.scale.set(grow, 1, grow)
    if (kerb.current) kerb.current.visible = base > 0.4
    const material = band.current.material as THREE.MeshBasicMaterial
    material.color.set(hovered || chosen ? '#fff0e4' : ROBBER_MARK).multiplyScalar(hovered || chosen ? 1 : base)
  })
  return <group onClick={onClick}>
    <mesh ref={kerb} geometry={robberKerbGeometry()} material={frameMaterial()} castShadow receiveShadow />
    <mesh ref={band} geometry={robberBandGeometry()}>
      <meshBasicMaterial color={ROBBER_MARK} toneMapped={false} />
    </mesh>
  </group>
}

type TileProps = {
  hexId: string
  x: number
  z: number
  index: number
  number?: number
  surface: TileSurfaceEntry
  reducedMotion: boolean
  action?: RobberAction
  onAction: (action: GameAction) => void
}

function TerrainTile({ hexId, x, z, index, number, surface, reducedMotion, action, onAction }: TileProps) {
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
    {legal ? <RobberRing hexId={hexId} hovered={hovered} reducedMotion={reducedMotion} onClick={click} /> : null}
  </group>
}

/**
 * The cairn owns the middle of a numbered tile, so the robber stands beside it
 * rather than inside it. On the desert there is no cairn and he keeps the
 * centre. This used to live inside the tile; it is a free function now because
 * the piece has to be positioned in board space in order to be dragged out of
 * the hex it is standing on.
 */
const robberStand = (tile: { x: number; z: number; number?: number }): [number, number, number] =>
  [tile.x + (tile.number ? 0.44 : 0), GROUND_Y, tile.z + (tile.number ? 0.16 : 0)]

export function Island({ game, robberActions, stealActions = EMPTY_STEALS, sending = false, viewerPlayerId, onAction }: { game: GameDisplayState; robberActions: Map<string, RobberAction>; stealActions?: Map<string, GameAction>; sending?: boolean; viewerPlayerId?: string; onAction: (action: GameAction) => void }) {
  const field = useTerrainField(game.board)
  // Read once here rather than in each of the nineteen tiles, which would
  // otherwise each register their own media-query listener.
  const reducedMotion = useReducedMotion()
  const robberTile = game.board.hexes.find((tile) => tile.id === game.board.robberHexId) ?? game.board.hexes[0]
  const targets = useMemo(
    () => [...robberActions.keys()].flatMap((hexId) => {
      const tile = game.board.hexes.find((candidate) => candidate.id === hexId)
      if (!tile) return []
      const [x, , z] = robberStand(tile)
      return [{ hexId, x, z }]
    }),
    [game.board.hexes, robberActions],
  )
  return <group>
    <ShallowWater board={game.board} />
    <IslandBody board={game.board} />
    <mesh geometry={field.borders} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
    {field.meshes.map((mesh) => <primitive key={mesh.name} object={mesh} />)}
    {game.board.hexes.map((tile, index) => <TerrainTile
      key={tile.id}
      hexId={tile.id}
      x={tile.x}
      z={tile.z}
      index={index}
      number={tile.number}
      surface={field.tiles[index]}
      reducedMotion={reducedMotion}
      action={robberActions.get(tile.id)}
      onAction={onAction}
    />)}
    <RobberHandle
      home={robberStand(robberTile)}
      homeHexId={robberTile.id}
      targets={targets}
      // Deliberately not `&& !sending`. A round trip is not the phase closing,
      // and treating it as one is how every marker on the board blinks out for
      // the length of a submit. The gesture is suspended inside the component;
      // the question stays open.
      armable={targets.length > 0}
      sending={sending}
      reducedMotion={reducedMotion}
      onCommit={(hexId) => { const action = robberActions.get(hexId); if (action) onAction(action) }}
    />
    <StealPreview game={game} viewerPlayerId={viewerPlayerId} stealActions={stealActions} onAction={onAction} />
    <HarborPiers game={game} />
  </group>
}

/**
 * Whose buildings the robber is about to sit on.
 *
 * One component, two moments, because they are the same question asked twice.
 *
 * While the piece is being dragged, this previews who would become stealable if
 * it landed on the hex under the cursor. That is the single most useful thing
 * the gesture can add and the reason it is worth building at all: choosing a
 * hex *is* choosing a victim, and until now the player had to work that out by
 * reading settlements off a board the robber marks were busy covering.
 *
 * Once the piece has landed and the engine asks who to rob, the same rings come
 * back on the same buildings and become the answer. The decision was always
 * spatial; it was being asked in a list, in a dialog, over a board that had been
 * made inert. The list can stay — it is a perfectly good keyboard path — but it
 * should not be the only place the question exists.
 */
function StealPreview({ game, viewerPlayerId, stealActions, onAction }: {
  game: GameDisplayState
  viewerPlayerId?: string
  stealActions: Map<string, GameAction>
  onAction: (action: GameAction) => void
}) {
  const pose = useRobberPose()
  const reducedMotion = useReducedMotion()
  const owners = useMemo(() => new Map(game.players.map((player) => [player.id, player.color])), [game.players])
  // `choosing` wins when both are live, because by then the hex is decided and
  // the rings have stopped being a preview and started being buttons.
  const choosing = stealActions.size > 0
  const hexId = choosing ? game.board.robberHexId : pose.candidateHexId
  const marks = useMemo(() => {
    if (!hexId) return []
    return Object.entries(game.buildings).flatMap(([vertexId, building]) => {
      const vertex = game.board.vertices[vertexId]
      if (!vertex?.hexes.includes(hexId) || building.playerId === viewerPlayerId) return []
      if (choosing && !stealActions.has(building.playerId)) return []
      const color = owners.get(building.playerId)
      return color ? [{ vertexId, x: vertex.x, z: vertex.z, color: PLAYER_BEACON[color], playerId: building.playerId }] : []
    })
  }, [hexId, choosing, stealActions, game.buildings, game.board.vertices, owners, viewerPlayerId])

  return <>{marks.map((mark) => <StealMark
    key={mark.vertexId}
    x={mark.x}
    z={mark.z}
    color={mark.color}
    seed={mark.vertexId}
    choosing={choosing}
    reducedMotion={reducedMotion}
    onPick={choosing ? () => { const action = stealActions.get(mark.playerId); if (action) onAction(action) } : undefined}
  />)}</>
}

/**
 * A kerb ring in the owner's colour, and a column of the same colour standing
 * out of it while the choice is live.
 *
 * The column is doing the work a ring cannot from the resting camera: a
 * building on a far hex is a handful of pixels, and a ring drawn around it is
 * fewer. Something has to break the horizon line. It is additive and unlit, so
 * it holds against dark canopy and pale sand alike, which is the same reason
 * every blade in the marker language is unlit.
 */
function StealMark({ x, z, color, seed, choosing, reducedMotion, onPick }: {
  x: number
  z: number
  color: string
  seed: string
  choosing: boolean
  reducedMotion: boolean
  onPick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered && Boolean(onPick))
  const column = useRef<THREE.Mesh>(null)
  // Seeded from the board id, never from `Math.random`, so two buildings on the
  // same hex breathe out of step and the pair reads as two answers.
  const phase = useMemo(() => seededFrom(seed)() * Math.PI * 2, [seed])
  useFrame(({ clock }) => {
    const mesh = column.current
    if (!mesh) return
    const pulse = reducedMotion ? 1 : 0.5 - Math.cos(clock.elapsedTime * MOTION_SPEED * 2.4 + phase) / 2
    const material = mesh.material as THREE.MeshBasicMaterial
    material.opacity = (hovered ? 0.85 : 0.34 + pulse * 0.3) * (choosing ? 1 : 0.55)
    mesh.scale.set(1, hovered ? 1.15 : 0.9 + pulse * 0.16, 1)
  })
  return <group
    position={[x, GROUND_Y + 0.02, z]}
    onClick={onPick ? (event) => { event.stopPropagation(); onPick() } : undefined}
    onPointerOver={onPick ? (event) => { event.stopPropagation(); setHovered(true) } : undefined}
    onPointerOut={onPick ? () => setHovered(false) : undefined}
  >
    <mesh geometry={collarGeometry()} material={frameMaterial()} />
    <mesh geometry={collarBandGeometry()}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
    <mesh ref={column} position={[0, 0.7, 0]}>
      <cylinderGeometry args={[0.11, 0.15, 1.4, 12, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.4}
        side={2}
        depthWrite={false}
        blending={2}
        toneMapped={false}
      />
    </mesh>
  </group>
}
