import { useCursor } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { ActionEffects } from './ActionEffects'
import { CameraRig } from './CameraRig'
import { Island } from './Island'
import { Lighting } from './Lighting'
import { SEA_LEVEL } from './ocean/oceanConfig'
import { FrameStats } from './loading/FrameStats'
import { LoadingScreen } from './loading/LoadingScreen'
import { ScenePrecompile } from './loading/precompile'
import { useCompiledFlag, useSceneReady } from './loading/useSceneReady'
import { Building, Road, VertexTargets } from './Pieces'
import { PLAYER_COLORS } from './playerColors'
import { PostFX } from './PostFX'
import { Sky } from './Sky'
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

/**
 * The island's shadow on the water.
 *
 * Without this the island reads as a sticker laid on a photograph of the sea:
 * a landmass three units tall in raking light, and the water beside it exactly
 * as bright as the water on the far side of the frame.
 *
 * The ocean itself cannot receive it. `Water` is a raw `ShaderMaterial`, so
 * three never injects the shadow chunks into it and `receiveShadow` is inert
 * there. This is an invisible plane skimming the surface whose only job is to
 * catch that shadow: `ShadowMaterial` renders nothing at all where the sun
 * reaches and a soft tint where it does not, so the wave shader underneath
 * shows through unchanged.
 *
 * The tint is a deep teal rather than black. Water in the shade of a headland
 * still returns the sky and its own depth; painting it grey is the tell that
 * makes composited shadows look pasted on.
 */
function SeaShadowCatcher() {
  return <mesh
    // Sea level plus enough to clear the wave crests. At the surface exactly,
    // the swell writes depth over the catcher and the shadow vanishes; the
    // authored beach shelf does not start until 0.28, so 0.14 is a clean gap
    // between the two and is far too shallow to read as a floating sheet from
    // any camera the rig allows.
    position={[0, SEA_LEVEL + 0.088, 0]}
    rotation={[-Math.PI / 2, 0, 0]}
    receiveShadow
    renderOrder={2}
  >
    <planeGeometry args={[30, 30]} />
    <shadowMaterial transparent opacity={0.55} color="#0a3348" depthWrite={false} />
  </mesh>
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
    <Sky />
    <Lighting mobile={mobile} />
    <Water reducedMotion={reducedMotion} />
    <SeaShadowCatcher />
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
    <PostFX mobile={mobile} reducedMotion={reducedMotion} />
  </>
}

// Roughly 5.6 million rendered pixels. A 16-inch retina panel at its default
// scaling is about 2.9M CSS pixels, so it gets the full 2x it is built for; a
// 4K window would otherwise ask for 33M and is clamped instead.
const PIXEL_BUDGET = 5_600_000

/**
 * Resolution, spent where it is actually visible.
 *
 * The previous cap of 1.5 was the single largest cause of the "not sharp"
 * verdict: on a retina display it renders at three quarters of the linear
 * resolution the panel shows and the browser upscales the difference. Full
 * device ratio fixes that, but a naive `min(dpr, 2)` also quadruples the cost
 * on a large monitor for no visible gain, so the cap is a pixel budget rather
 * than a ratio.
 */
const resolutionFor = (width: number, height: number) => {
  const device = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2)
  const area = Math.max(1, width * height)
  return Math.max(1, Math.min(device, Math.sqrt(PIXEL_BUDGET / area)))
}

function useResolution() {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : resolutionFor(window.innerWidth, window.innerHeight)))
  useEffect(() => {
    const update = () => setDpr(resolutionFor(window.innerWidth, window.innerHeight))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return dpr
}

// Context MSAA is off on purpose: every frame goes through the effect
// composer, which owns antialiasing.
export function GameScene(props: SceneProps) {
  const reducedMotion = useReducedMotion()
  const dpr = useResolution()
  const [compiled, markCompiled] = useCompiledFlag()
  const { ready, progress, label } = useSceneReady(compiled)

  return <>
    <Canvas
      className="game-canvas"
      aria-hidden="true"
      dpr={dpr}
      shadows
      camera={{ position: [7.7, 10.3, 9.8], fov: 31, near: 0.5, far: 900 }}
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
      // Tone mapping is deliberately not set here. The effect composer forces
      // `gl.toneMapping` to `NoToneMapping` for as long as it is mounted, so
      // anything assigned on this renderer is dead the moment `PostFX` renders
      // its first frame -- including `toneMappingExposure`, which read 1.14 for
      // several sessions and did nothing. Both the ACES curve and exposure are
      // owned by the composer.
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
      fallback={<div className="webgl-fallback">This board needs WebGL. Your game state is safe; try a browser with hardware acceleration.</div>}
    >
      <Suspense fallback={null}>
        <SceneContent {...props} reducedMotion={reducedMotion} />
        <ScenePrecompile onReady={markCompiled} />
        <FrameStats />
      </Suspense>
    </Canvas>
    <LoadingScreen visible={!ready} progress={progress} label={label} />
  </>
}

export type { PlacementMode }
