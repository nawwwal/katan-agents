import { useCursor } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { ActionEffects } from './ActionEffects'
import { CameraRig } from './CameraRig'
import { Island } from './Island'
import { Building, Road, VertexTargets } from './Pieces'
import { PLAYER_COLORS } from './playerColors'
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

function SceneEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const room = new RoomEnvironment()
    const generator = new THREE.PMREMGenerator(gl)
    const target = generator.fromScene(room, 0.04)
    scene.environment = target.texture
    scene.environmentIntensity = 0.18
    return () => {
      scene.environment = null
      target.dispose()
      generator.dispose()
      room.dispose()
    }
  }, [gl, scene])
  return null
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
    <fog attach="fog" args={['#123e54', 18, 39]} />
    <SceneEnvironment />
    <ambientLight intensity={0.08} />
    <hemisphereLight color="#fff0ca" groundColor="#0a4250" intensity={0.52} />
    <directionalLight castShadow={!mobile} position={[-8, 12, 5]} intensity={2.35} color="#ffd39d" shadow-mapSize-width={mobile ? 1024 : 2048} shadow-mapSize-height={mobile ? 1024 : 2048} shadow-camera-near={1} shadow-camera-far={32} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-bias={-0.00022} shadow-normalBias={0.025} />
    <directionalLight position={[6, 7, -5]} intensity={0.44} color="#84c9dc" />
    <Water reducedMotion={reducedMotion} />
    <group rotation={[0, -0.04, 0]}>
      <Island game={game} robberActions={robberActions} onAction={onAction} />
      {Object.entries(game.roadOwners).map(([edgeId, playerId]) => {
        const player = game.players.find((candidate) => candidate.id === playerId)
        return <Road key={edgeId} game={game} edgeId={edgeId} color={player ? PLAYER_COLORS[player.color] : undefined} reducedMotion={reducedMotion} />
      })}
      {roadActions.map((action) => <Road key={`legal-${action.edgeId}`} game={game} edgeId={action.edgeId} legal pending={(pendingAction?.type === 'place-road' || pendingAction?.type === 'build-road') && pendingAction.edgeId === action.edgeId} reducedMotion={reducedMotion} touchTarget={mobile} onSelect={() => onAction(action)} />)}
      {Object.entries(game.buildings).map(([vertexId, building]) => <Building key={vertexId} game={game} vertexId={vertexId} playerId={building.playerId} type={building.type} legalCity={cityActions.has(vertexId)} pendingCity={pendingAction?.type === 'build-city' && pendingAction.vertexId === vertexId} reducedMotion={reducedMotion} onCity={() => onAction(cityActions.get(vertexId)!)} />)}
      {vertexActions.length ? <VertexTargets game={game} actions={vertexActions} pendingAction={pendingAction} touchTarget={mobile} onAction={onAction} /> : null}
      <ActionEffects game={game} presentation={presentation} reducedMotion={reducedMotion} />
    </group>
    <CameraRig cinematic={cinematic} reducedMotion={reducedMotion} focus={cameraFocus} focusRevision={presentation?.revision} />
  </>
}

export function GameScene(props: SceneProps) {
  const reducedMotion = useReducedMotion()
  return <Canvas
    className="game-canvas"
    aria-hidden="true"
    dpr={[1, 2]}
    shadows
    camera={{ position: [7.7, 10.3, 9.8], fov: 31, near: 0.1, far: 100 }}
    gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 1.12
      gl.outputColorSpace = THREE.SRGBColorSpace
      gl.shadowMap.type = THREE.PCFSoftShadowMap
    }}
    fallback={<div className="webgl-fallback">This board needs WebGL. Your game state is safe; try a browser with hardware acceleration.</div>}
  >
    <Suspense fallback={null}><SceneContent {...props} reducedMotion={reducedMotion} /></Suspense>
  </Canvas>
}

export type { PlacementMode }
