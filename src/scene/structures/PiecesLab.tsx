import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { GameDisplayState, PlayerColor } from '../../game/types'
import { createBoard } from '../../game/board'
import { applyAction, createGame, currentActorId, getPlayerView, legalActionsForPlayer } from '../../game/engine'
import { toDisplayState } from '../../game/room'
import { CityModel, SettlementModel } from './Buildings'
import { HarborPiers } from './Harbor'
import { NumberTokenMesh } from './NumberToken'
import { RoadGhost, RoadModel } from './Road'
import { RobberFigure } from './Robber'
import { Building, Road, VertexTargets } from '../Pieces'
import { Island } from '../Island'
import { Lighting } from '../Lighting'
import { PLAYER_COLORS } from '../playerColors'
import { terraceMaterial } from './materials'

// Standalone review route for the pieces I own (`/pieces-lab.html`). The main
// board is being rebuilt by other agents, so this gives a stable stage with the
// same lighting recipe to grade silhouettes and materials against the refs.

const COLORS: PlayerColor[] = ['coral', 'blue', 'amber', 'ivory']

function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const room = new RoomEnvironment()
    const generator = new THREE.PMREMGenerator(gl)
    const target = generator.fromScene(room, 0.04)
    scene.environment = target.texture
    scene.environmentIntensity = 0.24
    return () => {
      scene.environment = null
      target.dispose()
      generator.dispose()
      room.dispose()
    }
  }, [gl, scene])
  return null
}

function Ground() {
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
    <planeGeometry args={[24, 24]} />
    <meshStandardMaterial color="#6f7a48" roughness={0.96} />
  </mesh>
}

const vec = (raw: string | null, fallback: [number, number, number]): [number, number, number] => {
  if (!raw) return fallback
  const parts = raw.split(',').map(Number)
  return parts.length === 3 && parts.every((value) => Number.isFinite(value)) ? [parts[0], parts[1], parts[2]] : fallback
}

const placementBoard = createBoard(28)
const placementGame = { board: placementBoard } as GameDisplayState
const placementActions = Object.values(placementBoard.vertices)
  .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
  .slice(0, 3)
  .map((vertex) => ({ type: 'place-settlement', vertexId: vertex.id }) as const)

export function PiecesLab() {
  const params = new URLSearchParams(window.location.search)
  const camera = vec(params.get('cam'), [0, 5.4, 6.4])
  const target = vec(params.get('at'), [0.1, 0.15, 0.9])
  return <div style={{ position: 'fixed', inset: 0, background: '#0d2431' }}>
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: camera, fov: 31, near: 0.1, far: 100 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.12
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <Environment />
        <ambientLight intensity={0.1} />
        <hemisphereLight color="#fff0ca" groundColor="#4a4030" intensity={0.6} />
        <directionalLight
          castShadow position={[-4, 6, 3]} intensity={2.4} color="#ffd39d"
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-near={0.5} shadow-camera-far={24}
          shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5}
          shadow-bias={-0.0002} shadow-normalBias={0.02}
        />
        <directionalLight position={[4, 3, -4]} intensity={0.45} color="#84c9dc" />
        <Ground />

        {COLORS.map((color, index) => <group key={`s-${color}`} position={[-1.65 + index * 1.1, 0, -0.55]}>
          <mesh position={[0, -0.028, 0]} material={terraceMaterial()} receiveShadow>
            <cylinderGeometry args={[0.28, 0.31, 0.05, 12]} />
          </mesh>
          <SettlementModel color={color} />
        </group>)}

        {COLORS.map((color, index) => <group key={`c-${color}`} position={[-1.65 + index * 1.1, 0, 0.75]}>
          <mesh position={[0, -0.028, 0]} material={terraceMaterial()} receiveShadow>
            <cylinderGeometry args={[0.4, 0.43, 0.05, 12]} />
          </mesh>
          <CityModel color={color} />
        </group>)}

        {COLORS.map((color, index) => <group key={`r-${color}`} position={[-1.6 + index * 1.1, 0, 1.75]} rotation={[0, 0.0, 0]}>
          <RoadModel color={color} />
        </group>)}
        <group position={[-1.6, 0, 2.05]}><RoadGhost color="#ffcf5e" opacity={0.55} emissive={0.45} /></group>

        {[2, 3, 5, 6, 8, 9, 11, 12].map((value, index) => <group key={value} position={[-1.75 + index * 0.62, 0.01, 2.55]}>
          <NumberTokenMesh number={value} height={0} />
        </group>)}

        <group position={[2.15, 0, -0.3]}><RobberFigure height={0} /></group>
        {/* Placement affordances, pulled in from the real board topology. */}
        <group position={[-1.1, -0.478, 3.5]}>
          <VertexTargets game={placementGame} actions={placementActions} touchTarget={false} onAction={() => {}} />
        </group>
        <OrbitControls target={target} />
      </Suspense>
    </Canvas>
  </div>
}

/**
 * Road-network legibility harness (`/pieces-lab.html?net=1`).
 *
 * The `?board` route only ever gets the six setup roads, which is nowhere near
 * enough to answer the question that actually matters: can you trace one
 * player's route across a busy island at a glance? This grows three long
 * contiguous chains over the real terrain, real lighting and the real game
 * camera, so the answer is honest.
 */
function networkState(): GameDisplayState {
  let state = createGame({ seed: 28, controllers: ['human', 'agent', 'agent'], names: ['You', 'Atlas', 'Ember'] })
  for (let step = 0; step < 40 && state.phase !== 'action'; step += 1) {
    const action = legalActionsForPlayer(state, currentActorId(state))[0]
    if (!action) break
    const result = applyAction(state, action, () => 0.5)
    if (!result.ok) break
    state = result.state
  }
  const display = toDisplayState(getPlayerView(state, state.players[0].id))

  // Grow one chain per player from its first settlement, breadth-first over
  // shared vertices, so each network is contiguous the way a real one is.
  const edges = Object.values(display.board.edges)
  const byVertex = new Map<string, string[]>()
  for (const edge of edges) {
    for (const vertexId of edge.vertices) {
      const list = byVertex.get(vertexId) ?? []
      list.push(edge.id)
      byVertex.set(vertexId, list)
    }
  }
  const owners: Record<string, string> = { ...display.roadOwners }
  const claimed = new Set(Object.keys(owners))
  display.players.forEach((player, index) => {
    const seeds = Object.entries(display.buildings)
      .filter(([, building]) => building.playerId === player.id)
      .map(([vertexId]) => vertexId)
    const frontier = [...seeds]
    let budget = 13
    const seen = new Set(seeds)
    while (frontier.length && budget > 0) {
      const vertexId = frontier.shift()!
      for (const edgeId of byVertex.get(vertexId) ?? []) {
        if (budget <= 0) break
        if (claimed.has(edgeId)) continue
        claimed.add(edgeId)
        owners[edgeId] = player.id
        budget -= 1
        for (const next of display.board.edges[edgeId].vertices) {
          if (!seen.has(next)) { seen.add(next); frontier.push(next) }
        }
      }
    }
    void index
  })
  return { ...display, roadOwners: owners }
}

export function NetworkLab() {
  const game = useMemo(networkState, [])
  const robberActions = useMemo(() => new Map<string, never>(), [])
  // `cam`, `at` and `fov` let a junction be framed tight from the shot script;
  // road joinery is a defect you can only judge at a few centimetres.
  const params = new URLSearchParams(window.location.search)
  const camera = vec(params.get('cam'), [7.7, 10.3, 9.8])
  const target = vec(params.get('at'), [0, 0.5, 0])
  const fov = Number(params.get('fov')) || 31
  return <div style={{ position: 'fixed', inset: 0, background: '#04121b' }}>
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: camera, fov, near: 0.5, far: 900 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = Number(params.get('exp')) || 1.14
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <Lighting mobile={false} />
        <group rotation={[0, -0.04, 0]}>
          <Island game={game} robberActions={robberActions} onAction={() => {}} />
          {Object.entries(game.roadOwners).map(([edgeId, playerId]) => {
            const player = game.players.find((candidate) => candidate.id === playerId)
            return <Road key={edgeId} game={game} edgeId={edgeId} color={player ? PLAYER_COLORS[player.color] : undefined} reducedMotion />
          })}
          {Object.entries(game.buildings).map(([vertexId, building]) => <Building
            key={vertexId} game={game} vertexId={vertexId} playerId={building.playerId}
            type={building.type} legalCity={false} reducedMotion
          />)}
        </group>
        <OrbitControls target={target} />
      </Suspense>
    </Canvas>
  </div>
}

/**
 * Junction rig (`/pieces-lab.html?joins=1`).
 *
 * Road joinery is a defect measured in centimetres, and hunting for the right
 * three roads on the real island wastes a screenshot every time. This lays out
 * every junction case that exists — three-way and bend, single owner and mixed,
 * plus a dead end — on one flat, evenly lit stage at a fixed close camera, so a
 * change is graded against the same six joints every pass.
 */
const JOIN_CASES: Array<{ label: string; slot: [number, number]; roads: number; owners: number[] }> = [
  { label: '3-way, one owner', slot: [-2.1, -1.15], roads: 3, owners: [0, 0, 0] },
  { label: '3-way, two owners', slot: [0, -1.15], roads: 3, owners: [0, 0, 1] },
  { label: '3-way, three owners', slot: [2.1, -1.15], roads: 3, owners: [0, 1, 2] },
  { label: 'bend, one owner', slot: [-2.1, 1.15], roads: 2, owners: [0, 0] },
  { label: 'bend, two owners', slot: [0, 1.15], roads: 2, owners: [0, 1] },
  { label: 'dead end', slot: [2.1, 1.15], roads: 1, owners: [0] },
]

function joinState() {
  const board = createBoard(28)
  // One hub vertex per case, each with three edges and no shared edges, so the
  // cases never contaminate each other.
  const hubs = Object.values(board.vertices).filter((vertex) => vertex.edges.length === 3)
  const used = new Set<string>()
  const picked: typeof hubs = []
  for (const vertex of hubs) {
    if (picked.length === JOIN_CASES.length) break
    if (vertex.edges.some((edge) => used.has(edge))) continue
    // Also keep a one-vertex buffer so a neighbouring hub's roads never meet.
    if (vertex.neighbors.some((id) => picked.some((other) => other.id === id))) continue
    vertex.edges.forEach((edge) => used.add(edge))
    for (const id of vertex.neighbors) board.vertices[id]?.edges.forEach((edge) => used.add(edge))
    picked.push(vertex)
  }
  return { board, picked }
}

export function JoinLab() {
  const { board, picked } = useMemo(joinState, [])
  const params = new URLSearchParams(window.location.search)
  const camera = vec(params.get('cam'), [0.9, 2.5, 2.4])
  const target = vec(params.get('at'), [0, 0.45, 0])
  const game = useMemo(() => {
    const roadOwners: Record<string, string> = {}
    picked.forEach((vertex, index) => {
      const test = JOIN_CASES[index]
      if (!test) return
      vertex.edges.slice(0, test.roads).forEach((edge, slot) => { roadOwners[edge] = `p${test.owners[slot]}` })
    })
    return { board, roadOwners } as unknown as GameDisplayState
  }, [board, picked])
  const palette: PlayerColor[] = ['coral', 'blue', 'amber']
  return <div style={{ position: 'fixed', inset: 0, background: '#10171c' }}>
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: camera, fov: Number(params.get('fov')) || 34, near: 0.05, far: 60 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = Number(params.get('exp')) || 1.15
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <Environment />
        <ambientLight intensity={0.12} />
        <hemisphereLight color="#fff0ca" groundColor="#4a4030" intensity={0.7} />
        <directionalLight
          castShadow position={[-3, 5, 2.5]} intensity={2.6} color="#ffd8a8"
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-near={0.5} shadow-camera-far={20}
          shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4}
          shadow-bias={-0.0002} shadow-normalBias={0.02}
        />
        <directionalLight position={[3.5, 2.5, -3]} intensity={0.5} color="#8fd0e2" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#6e6a4e" roughness={0.97} />
        </mesh>
        {picked.map((vertex, index) => {
          const test = JOIN_CASES[index]
          if (!test) return null
          return <group key={vertex.id} position={[test.slot[0] - vertex.x, -0.478, test.slot[1] - vertex.z]}>
            {vertex.edges.slice(0, test.roads).map((edgeId, slot) => <Road
              key={edgeId} game={game} edgeId={edgeId}
              color={PLAYER_COLORS[palette[test.owners[slot]]]} reducedMotion
            />)}
          </group>
        })}
        <OrbitControls target={target} />
      </Suspense>
    </Canvas>
  </div>
}

export function HarborLab() {
  const board = createBoard(28)
  const game = { board } as GameDisplayState
  return <div style={{ position: 'fixed', inset: 0, background: '#0d2431' }}>
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [6.2, 3.0, 3.6], fov: 31, near: 0.1, far: 100 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.12
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.type = THREE.PCFSoftShadowMap
      }}
    >
      <Suspense fallback={null}>
        <Environment />
        <ambientLight intensity={0.1} />
        <hemisphereLight color="#fff0ca" groundColor="#12414f" intensity={0.6} />
        <directionalLight castShadow position={[-6, 8, 4]} intensity={2.3} color="#ffd39d" shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-far={30} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#12566b" roughness={0.16} metalness={0.1} />
        </mesh>
        <HarborPiers game={game} />
        <OrbitControls target={[4.3, 0.25, 1.9]} />
      </Suspense>
    </Canvas>
  </div>
}
