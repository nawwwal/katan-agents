import { ContactShadows, useCursor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { ActionEffects } from './ActionEffects'
import { CameraRig } from './CameraRig'
import { Island } from './Island'
import { useReducedMotion } from './useReducedMotion'
import { Water } from './Water'

type PlacementMode = 'road' | 'settlement' | 'city' | null

type SceneProps = {
  game: GameDisplayState
  placementMode: PlacementMode
  pendingAction?: GameAction
  presentation?: GamePresentation
  cinematic?: boolean
  onAction: (action: GameAction) => void
  interactive: boolean
}

const PLAYER_COLORS: Record<PlayerColor, string> = {
  coral: '#d8563b',
  blue: '#287bd2',
  amber: '#e3a525',
  ivory: '#eee6cd',
}

const edgeTransform = (game: GameDisplayState, edge: BoardEdge) => {
  const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
  const dx = b.x - a.x
  const dz = b.z - a.z
  return {
    position: [(a.x + b.x) / 2, 0.43, (a.z + b.z) / 2] as [number, number, number],
    length: Math.hypot(dx, dz),
    rotation: [0, -Math.atan2(dz, dx), 0] as [number, number, number],
  }
}

function Road({ game, edgeId, color, legal, pending, reducedMotion, touchTarget, onSelect }: { game: GameDisplayState; edgeId: string; color?: string; legal?: boolean; pending?: boolean; reducedMotion: boolean; touchTarget?: boolean; onSelect?: () => void }) {
  const edge = game.board.edges[edgeId]
  const transform = edgeTransform(game, edge)
  const [hovered, setHovered] = useState(false)
  const group = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!group.current || legal || reducedMotion) return
    const next = THREE.MathUtils.damp(group.current.scale.x, 1, 11, delta)
    group.current.scale.set(next, next, next)
  })
  useCursor(Boolean(legal && hovered))
  return <group ref={group} position={transform.position} rotation={transform.rotation} scale={legal || reducedMotion ? 1 : 0.08} onClick={(event) => { event.stopPropagation(); if (legal) onSelect?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[transform.length * (pending ? 0.9 : 0.86), legal ? (pending ? 0.13 : 0.07) : 0.15, legal ? (pending ? 0.18 : 0.11) : 0.2]} />
      <meshStandardMaterial color={pending ? '#77efff' : legal ? '#ffd65f' : color ?? '#67503d'} emissive={pending ? '#087e98' : legal ? '#8d5a00' : '#000000'} emissiveIntensity={pending ? 1.2 : hovered ? 1.2 : legal ? 0.55 : 0} roughness={0.68} metalness={legal ? 0.25 : 0.08} transparent={legal} opacity={legal ? 0.9 : 1} />
    </mesh>
    {legal ? <mesh position={[0, 0.08, 0]}>
      <boxGeometry args={[transform.length * 0.74, 0.22, touchTarget ? 0.68 : 0.34]} />
      <meshBasicMaterial visible={false} />
    </mesh> : null}
    {!legal ? <mesh castShadow position={[0, 0.08, 0]}>
      <boxGeometry args={[transform.length * 0.74, 0.04, 0.12]} />
      <meshStandardMaterial color="#f2d49a" roughness={0.8} />
    </mesh> : null}
    {!legal ? [-1, 1].map((side) => <mesh key={side} castShadow position={[0, 0.01, side * 0.1]}><boxGeometry args={[transform.length * 0.8, 0.045, 0.035]} /><meshStandardMaterial color="#61432f" roughness={0.9} /></mesh>) : null}
  </group>
}

function Building({ game, vertexId, playerId, type, legalCity, pendingCity, reducedMotion, onCity }: { game: GameDisplayState; vertexId: string; playerId: string; type: 'settlement' | 'city'; legalCity: boolean; pendingCity?: boolean; reducedMotion: boolean; onCity?: () => void }) {
  const vertex = game.board.vertices[vertexId]
  const player = game.players.find((candidate) => candidate.id === playerId)
  const [hovered, setHovered] = useState(false)
  const group = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!group.current || reducedMotion) return
    const target = pendingCity ? 1.18 : hovered && legalCity ? 1.12 : 1
    const next = THREE.MathUtils.damp(group.current.scale.x, target, 10, delta)
    group.current.scale.set(next, next, next)
  })
  useCursor(legalCity && hovered)
  const color = player ? PLAYER_COLORS[player.color] : '#ddd'
  return <group ref={group} position={[vertex.x, 0.49, vertex.z]} onClick={(event) => { event.stopPropagation(); if (legalCity) onCity?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)} scale={reducedMotion ? 1 : 0.08}>
    <mesh receiveShadow position={[0, -0.01, 0]}><cylinderGeometry args={[type === 'city' ? 0.34 : 0.27, type === 'city' ? 0.38 : 0.31, 0.1, 8]} /><meshStandardMaterial color="#86745e" roughness={0.92} /></mesh>
    {type === 'city' ? <>
      <mesh castShadow position={[-0.1, 0.15, 0]}><boxGeometry args={[0.38, 0.4, 0.34]} /><meshStandardMaterial color={color} roughness={0.58} /></mesh>
      <mesh castShadow position={[0.18, 0.22, 0]}><boxGeometry args={[0.29, 0.54, 0.3]} /><meshStandardMaterial color={color} roughness={0.58} /></mesh>
      <mesh castShadow position={[0.17, 0.48, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[0.23, 0.25, 4]} /><meshStandardMaterial color="#40271d" roughness={0.82} /></mesh>
      <mesh position={[-0.1, 0.18, 0.165]}><boxGeometry args={[0.1, 0.13, 0.02]} /><meshStandardMaterial color="#f3c56e" emissive="#9c5c21" emissiveIntensity={0.28} /></mesh>
      <mesh position={[0.18, 0.23, 0.155]}><boxGeometry args={[0.08, 0.11, 0.02]} /><meshStandardMaterial color="#ffd880" emissive="#b26724" emissiveIntensity={0.42} /></mesh>
      {[-0.24, 0.29].map((x) => <mesh key={x} castShadow position={[x, 0.31, -0.1]}><cylinderGeometry args={[0.045, 0.055, 0.42, 8]} /><meshStandardMaterial color={color} roughness={0.62} /></mesh>)}
    </> : <>
      <mesh castShadow position={[0, 0.1, 0]}><boxGeometry args={[0.31, 0.28, 0.29]} /><meshStandardMaterial color={color} roughness={0.58} /></mesh>
      <mesh castShadow position={[0, 0.3, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[0.25, 0.23, 4]} /><meshStandardMaterial color="#40271d" roughness={0.82} /></mesh>
      <mesh position={[0, 0.11, 0.155]}><boxGeometry args={[0.085, 0.15, 0.02]} /><meshStandardMaterial color="#382017" roughness={0.9} /></mesh>
      <mesh position={[-0.09, 0.14, 0.157]}><boxGeometry args={[0.055, 0.065, 0.018]} /><meshStandardMaterial color="#ffd880" emissive="#b26724" emissiveIntensity={0.36} /></mesh>
    </>}
    <mesh castShadow position={[type === 'city' ? 0.27 : 0.2, type === 'city' ? 0.55 : 0.42, 0]}><cylinderGeometry args={[0.012, 0.016, type === 'city' ? 0.52 : 0.38, 6]} /><meshStandardMaterial color="#34231b" roughness={0.9} /></mesh>
    <mesh position={[type === 'city' ? 0.34 : 0.27, type === 'city' ? 0.66 : 0.5, 0]}><planeGeometry args={[0.18, 0.1]} /><meshStandardMaterial color={color} side={THREE.DoubleSide} /></mesh>
    {legalCity ? <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.29, pendingCity ? 0.43 : 0.38, 24]} /><meshBasicMaterial color={pendingCity ? '#78efff' : '#ffd45b'} transparent opacity={0.9} /></mesh> : null}
  </group>
}

function VertexTarget({ game, vertexId, action, pending, touchTarget, onAction }: { game: GameDisplayState; vertexId: string; action: GameAction; pending?: boolean; touchTarget?: boolean; onAction: (action: GameAction) => void }) {
  const vertex = game.board.vertices[vertexId]
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  return <group position={[vertex.x, 0.48, vertex.z]} onClick={(event) => { event.stopPropagation(); onAction(action) }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)} scale={pending ? 1.35 : hovered ? 1.18 : 1}>
    <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[touchTarget ? 0.38 : 0.24, touchTarget ? 0.38 : 0.24, 0.16, 16]} /><meshBasicMaterial visible={false} /></mesh>
    <mesh castShadow><cylinderGeometry args={[0.075, 0.095, pending ? 0.13 : 0.05, 8]} /><meshStandardMaterial color={pending ? '#79efff' : '#ffd45b'} emissive={pending ? '#087e98' : '#9b5c00'} emissiveIntensity={pending ? 1.4 : hovered ? 1.25 : 0.08} metalness={0.3} roughness={0.45} /></mesh>
    <mesh position={[0, pending ? 0.1 : 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.09, pending ? 0.19 : 0.125, 20]} /><meshBasicMaterial color={pending ? '#d2fbff' : '#fff2a8'} transparent opacity={pending ? 0.9 : hovered ? 0.8 : 0.17} /></mesh>
  </group>
}

function SceneContent({ game, placementMode, pendingAction, presentation, cinematic, onAction, interactive, reducedMotion }: SceneProps & { reducedMotion: boolean }) {
  const { size } = useThree()
  const mobile = size.width <= 520
  const actions = interactive ? game.legalActions : []
  const robberActions = new Map(actions.filter((action): action is Extract<GameAction, { type: 'move-robber' }> => action.type === 'move-robber').map((action) => [action.hexId, action]))
  const vertexActions = useMemo(() => actions.filter((action): action is Extract<GameAction, { type: 'place-settlement' | 'build-settlement' }> =>
    action.type === 'place-settlement' || (placementMode === 'settlement' && action.type === 'build-settlement')), [actions, placementMode])
  const roadActions = useMemo(() => actions.filter((action): action is Extract<GameAction, { type: 'place-road' | 'build-road' }> =>
    action.type === 'place-road' || (action.type === 'build-road' && (placementMode === 'road' || game.phase === 'road-building'))), [actions, placementMode, game.phase])
  const cityActions = new Map(actions.filter((action): action is Extract<GameAction, { type: 'build-city' }> => placementMode === 'city' && action.type === 'build-city').map((action) => [action.vertexId, action]))
  const cameraFocus = useMemo(() => {
    const event = presentation?.events.findLast((candidate) => candidate.publicData?.vertexId || candidate.publicData?.edgeId || candidate.publicData?.hexId)
    const vertexId = event?.publicData?.vertexId
    if (typeof vertexId === 'string') {
      const vertex = game.board.vertices[vertexId]
      if (vertex) return [vertex.x, vertex.z] as [number, number]
    }
    const edgeId = event?.publicData?.edgeId
    if (typeof edgeId === 'string') {
      const edge = game.board.edges[edgeId]
      if (edge) {
        const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
        return [(a.x + b.x) / 2, (a.z + b.z) / 2] as [number, number]
      }
    }
    const hexId = event?.publicData?.hexId
    if (typeof hexId === 'string') {
      const tile = game.board.hexes.find((candidate) => candidate.id === hexId)
      if (tile) return [tile.x, tile.z] as [number, number]
    }
  }, [game.board, presentation])

  return <>
    <fog attach="fog" args={['#0c6470', 14, 32]} />
    <ambientLight intensity={0.3} />
    <hemisphereLight color="#fff0cd" groundColor="#0b3943" intensity={0.62} />
    <directionalLight castShadow={!mobile} position={[-7, 11, 6]} intensity={3.35} color="#ffe0ab" shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={1} shadow-camera-far={32} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-radius={3} shadow-bias={-0.00035} />
    <Water reducedMotion={reducedMotion} />
    <group rotation={[0, -0.04, 0]}>
      <Island game={game} robberActions={robberActions} onAction={onAction} reducedMotion={reducedMotion} />
      {Object.entries(game.roadOwners).map(([edgeId, playerId]) => {
        const player = game.players.find((candidate) => candidate.id === playerId)
        return <Road key={edgeId} game={game} edgeId={edgeId} color={player ? PLAYER_COLORS[player.color] : undefined} reducedMotion={reducedMotion} />
      })}
      {roadActions.map((action) => <Road key={`legal-${action.edgeId}`} game={game} edgeId={action.edgeId} legal pending={(pendingAction?.type === 'place-road' || pendingAction?.type === 'build-road') && pendingAction.edgeId === action.edgeId} reducedMotion={reducedMotion} touchTarget={mobile} onSelect={() => onAction(action)} />)}
      {Object.entries(game.buildings).map(([vertexId, building]) => <Building key={vertexId} game={game} vertexId={vertexId} playerId={building.playerId} type={building.type} legalCity={cityActions.has(vertexId)} pendingCity={pendingAction?.type === 'build-city' && pendingAction.vertexId === vertexId} reducedMotion={reducedMotion} onCity={() => onAction(cityActions.get(vertexId)!)} />)}
      {vertexActions.map((action) => <VertexTarget key={`legal-${action.vertexId}`} game={game} vertexId={action.vertexId} action={action} pending={(pendingAction?.type === 'place-settlement' || pendingAction?.type === 'build-settlement') && pendingAction.vertexId === action.vertexId} touchTarget={mobile} onAction={onAction} />)}
      <ActionEffects game={game} presentation={presentation} reducedMotion={reducedMotion} />
    </group>
    <ContactShadows position={[0, -0.18, 0]} scale={16} opacity={0.38} blur={2.2} far={3.5} frames={1} />
    <CameraRig cinematic={cinematic} reducedMotion={reducedMotion} focus={cameraFocus} focusRevision={presentation?.revision} />
  </>
}

export function GameScene(props: SceneProps) {
  const reducedMotion = useReducedMotion()
  return <Canvas
    className="game-canvas"
    aria-hidden="true"
    dpr={[1, 1.55]}
    shadows
    camera={{ position: [8.4, 12.8, 10.5], fov: 32, near: 0.1, far: 100 }}
    gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08 }}
    fallback={<div className="webgl-fallback">This board needs WebGL. Your game state is safe; try a browser with hardware acceleration.</div>}
  >
    <Suspense fallback={null}><SceneContent {...props} reducedMotion={reducedMotion} /></Suspense>
  </Canvas>
}

export type { PlacementMode }
