import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import { usePlacementDrop } from './motion/placement'
import { MOTION_SPEED, seededFrom } from './motion/spring'
import { BEACON_PENDING, PLAYER_BEACON, PLAYER_TRIM, colorKeyFromHex } from './playerColors'
import {
  BEACON_PERIOD,
  BLADE_Y,
  PAD_TOP,
  bandGeometry,
  bladeGeometry,
  bladeMaterial,
  collarBandGeometry,
  collarGeometry,
  dropLineGeometry,
  frameMaterial,
  mastGeometry,
  padGeometry,
  roadPoolMaterial,
} from './structures/Beacon'
import { CityModel, SettlementModel } from './structures/Buildings'
import { FREE_JOINS, RoadGhost, RoadModel, type RoadJoins } from './structures/Road'
import { apronMaterial, kerbRingMaterial, terraceMaterial } from './structures/materials'
import { hashString, makeRng } from './structures/textures'
import { useReducedMotion } from './useReducedMotion'

/** Board pieces sit on the island plateau at this height. */
const DECK_Y = 0.478
const WHITE = new THREE.Color('#ffffff')
/** Top of a road deck, which the road beacon's mast has to start above. */
const DECK_CLEAR = 0.145
/** Where the upgrade chevron floats, just clear of a settlement's ridge. */
const CITY_MARK_Y = 0.88

/**
 * Whose turn the board is offering. Legal actions only ever reach the scene for
 * the seat that can act, so this is the viewer whenever anything is lit, and it
 * is read off the state the pieces already receive rather than plumbed down as
 * a new prop.
 */
const actingColor = (game: GameDisplayState): PlayerColor => {
  const players = game.players ?? []
  const id = game.actingPlayerId ?? players[game.activePlayerIndex]?.id
  return players.find((player) => player.id === id)?.color ?? 'ivory'
}

/**
 * The beacon's breathing cycle, 0 to 1. `phase` spreads a set out so fifty
 * markers shimmer instead of strobing together, and under reduced motion the
 * whole thing pins to the bright end — a constant, not an accumulator, so it
 * cannot leave a frozen artifact behind the way the older effects do.
 */
const beaconPulse = (elapsed: number, phase: number, reducedMotion: boolean) =>
  reducedMotion ? 1 : 0.5 - Math.cos(((elapsed * MOTION_SPEED) / BEACON_PERIOD + phase) * Math.PI * 2) / 2

const edgeTransform = (game: GameDisplayState, edge: BoardEdge) => {
  const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
  const dx = b.x - a.x
  const dz = b.z - a.z
  return {
    position: [(a.x + b.x) / 2, 0.478, (a.z + b.z) / 2] as [number, number, number],
    length: Math.hypot(dx, dz),
    rotation: [0, -Math.atan2(dz, dx), 0] as [number, number, number],
  }
}

/**
 * Which built roads share each end of this edge, expressed in the road's own
 * frame so the model can mitre itself without knowing where it is.
 *
 * Local +X runs from the edge's first vertex to its second, and the two other
 * edges at a vertex leave it 120° either side, so a neighbour is on the +Z or
 * −Z side of this road according to which way its bearing turns.
 */
const roadJoins = (game: GameDisplayState, edge: BoardEdge): RoadJoins => {
  const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
  const bearing = Math.atan2(b.z - a.z, b.x - a.x)
  const joins: RoadJoins = { a: { plus: false, minus: false }, b: { plus: false, minus: false } }
  for (const [key, vertex] of [['a', a], ['b', b]] as const) {
    for (const neighborId of game.board.vertices[vertex.id].edges) {
      if (neighborId === edge.id || !game.roadOwners[neighborId]) continue
      const other = game.board.edges[neighborId].vertices.find((id) => id !== vertex.id)
      if (!other) continue
      const far = game.board.vertices[other]
      const turn = Math.atan2(far.z - vertex.z, far.x - vertex.x) - bearing
      // Wrap to (0, 360); the two slots land near 60/300 at the b end and
      // 120/240 at the a end, and in both cases the upper half is +Z.
      const degrees = ((turn / Math.PI) * 180 % 360 + 360) % 360
      if (degrees < 180) joins[key].plus = true
      else joins[key].minus = true
    }
  }
  return joins
}

/**
 * A built road, hinged down onto its edge by the shared placement physics
 * rather than scaled up in place.
 */
function PlacedRoad({ edgeId, owner, length, joins, reducedMotion }: { edgeId: string; owner: PlayerColor; length: number; joins: RoadJoins; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  usePlacementDrop(group, { id: edgeId, kind: 'road', reducedMotion })
  return <group ref={group}>
    <RoadModel color={owner} length={length} joins={joins} />
  </group>
}

/**
 * A legal road edge.
 *
 * The old ghost was the road's own shape at half opacity in pale gold, laid on
 * a pale sand hex seam, which is close to the definition of invisible. This is
 * the same silhouette carrying the beacon's pairing instead: the deck goes to
 * the acting player's full beacon hue and stops being lit at all, the kerb and
 * plinth go near-black where a built road's are pale limestone — so a marker is
 * never mistaken for a finished causeway — and a dark pool underneath grounds
 * the whole thing on whatever it crosses. The bar blade at midspan is the
 * road's letter in the shape alphabet, and it stands above the scatter line.
 */
function RoadBeacon({ edgeId, length, color, pending, hovered, reducedMotion }: { edgeId: string; length: number; color: string; pending: boolean; hovered: boolean; reducedMotion: boolean }) {
  const mark = useRef<THREE.Group>(null)
  const phase = useMemo(() => seededFrom(`beacon-${edgeId}`)(), [edgeId])
  useFrame(({ clock }) => {
    if (!mark.current) return
    const pulse = beaconPulse(clock.elapsedTime, phase, reducedMotion)
    const grow = 0.94 + pulse * 0.14
    mark.current.scale.set(grow, grow, grow)
    mark.current.position.y = DECK_CLEAR + pulse * 0.016
  })
  const scale = pending ? 1.35 : hovered ? 1.14 : 1
  return <group>
    {/* Dark smear: the contrast floor, wider than the road so it frames it. */}
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} material={roadPoolMaterial()}>
      <planeGeometry args={[length * 1.15, 0.96]} />
    </mesh>
    {/* Short of the full edge on purpose. Butted end to end, a run of legal
        roads read as one paved river rather than as five separate offers. */}
    <RoadGhost length={length * 0.82} deck={color} />
    {/* Above the deck, not through it: at the piece plane the mast's lower half
        sorted behind the causeway and punched a dark hole in it. */}
    <group ref={mark} position={[0, DECK_CLEAR, 0]} scale={scale}>
      <mesh geometry={mastGeometry()} material={frameMaterial()} castShadow />
      <mesh position={[0, BLADE_Y, 0]} geometry={bladeGeometry('road')}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  </group>
}

export function Road({ game, edgeId, color, legal, pending, reducedMotion, touchTarget, onSelect }: { game: GameDisplayState; edgeId: string; color?: string; legal?: boolean; pending?: boolean; reducedMotion: boolean; touchTarget?: boolean; onSelect?: () => void }) {
  const edge = game.board.edges[edgeId]
  const transform = edgeTransform(game, edge)
  const [hovered, setHovered] = useState(false)
  useCursor(Boolean(legal && hovered))
  const owner = colorKeyFromHex(color)
  const joins = useMemo(() => (legal ? FREE_JOINS : roadJoins(game, edge)), [game, edge, legal])
  const beacon = pending ? BEACON_PENDING : PLAYER_BEACON[actingColor(game)]
  return <group position={transform.position} rotation={transform.rotation} onClick={(event) => { event.stopPropagation(); if (legal) onSelect?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
    {legal
      ? <RoadBeacon edgeId={edgeId} length={transform.length} color={beacon} pending={Boolean(pending)} hovered={hovered} reducedMotion={reducedMotion} />
      : <PlacedRoad edgeId={edgeId} owner={owner} length={transform.length} joins={joins} reducedMotion={reducedMotion} />}
    {legal ? <mesh position={[0, 0.08, 0]}>
      <boxGeometry args={[transform.length * 0.74, 0.26, touchTarget ? 0.68 : 0.38]} />
      <meshBasicMaterial visible={false} />
    </mesh> : null}
  </group>
}

/**
 * What a building stands on: a dug dirt apron, a cobbled terrace set into it,
 * and a painted kerb ring in the owner's colour.
 *
 * The ring is doing real work. Player colour came off the roofs because
 * saturated primary roofs were the loudest toy-model cue in the frame, and a
 * ring on the ground is a better top-down read than a roof anyway — it is a
 * flat annulus facing the camera, it never gets hidden behind a gable, and it
 * says "this plot is claimed" rather than "this house is made of plastic".
 */
function Footing({ type, owner }: { type: 'settlement' | 'city'; owner: PlayerColor }) {
  const city = type === 'city'
  const terrace = city ? 0.42 : 0.33
  const ring = terrace + 0.055
  return <group>
    {/* Dirt apron: turned earth where the ground was cut for the platform. */}
    <mesh position={[0, -0.052, 0]} material={apronMaterial()} receiveShadow>
      <cylinderGeometry args={[ring + 0.075, ring + 0.05, 0.05, 28]} />
    </mesh>
    {/* Painted kerb ring. */}
    <mesh position={[0, -0.028, 0]} material={kerbRingMaterial(PLAYER_TRIM[owner])} receiveShadow>
      <cylinderGeometry args={[ring, ring + 0.012, 0.05, 28]} />
    </mesh>
    {/* Cobbled terrace so the building sits in the ground instead of on it. */}
    <mesh position={[0, -0.018, 0]} material={terraceMaterial()} receiveShadow>
      <cylinderGeometry args={[terrace, terrace + 0.03, 0.055, 28]} />
    </mesh>
  </group>
}

/** Buildings face the middle of the island, with a seeded wobble per vertex. */
const buildingYaw = (x: number, z: number, seed: number, front: 'x' | 'z') => {
  const length = Math.hypot(x, z) || 1
  const dx = -x / length
  const dz = -z / length
  const base = front === 'x' ? Math.atan2(-dz, dx) : Math.atan2(-dx, -dz)
  return base + (makeRng(seed)() - 0.5) * 0.34
}

/**
 * A settlement you may upgrade.
 *
 * A different read from the other two, because it marks something that is
 * already yours rather than open ground. So the ground half is an annulus set
 * around the footing instead of a pool poured over it — the kerb ring, the
 * terrace and the house you built stay visible inside it, which is the whole
 * point of the sentence being made. The standing half floats a double chevron
 * over the roof on a dark drop line: two arrows climbing say "raise this",
 * where the settlement caret pointed down at empty ground and said "found one".
 */
function CityBeacon({ vertexId, color, pending, hovered, reducedMotion }: { vertexId: string; color: string; pending: boolean; hovered: boolean; reducedMotion: boolean }) {
  const mark = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const phase = useMemo(() => seededFrom(`beacon-${vertexId}`)(), [vertexId])
  useFrame(({ clock }) => {
    const pulse = beaconPulse(clock.elapsedTime, phase, reducedMotion)
    if (ring.current) {
      const grow = 0.97 + pulse * 0.07
      ring.current.scale.set(grow, 1, grow)
    }
    if (mark.current) mark.current.position.y = CITY_MARK_Y + (reducedMotion ? 0 : pulse * 0.03)
  })
  const scale = pending ? 1.35 : hovered ? 1.16 : 1
  return <group scale={scale}>
    {/* Dark annulus, then the coloured one inside it: the same sandwich the
        vertex beacon makes with a filled pool, opened up so the building it is
        talking about is not buried under it. */}
    <mesh position={[0, 0.1, 0]} geometry={collarGeometry()} material={frameMaterial()} castShadow />
    <mesh ref={ring} position={[0, 0.1, 0]} geometry={collarBandGeometry()}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
    <mesh position={[0, CITY_MARK_Y - 0.22, 0]} geometry={dropLineGeometry()} material={frameMaterial()} />
    <group ref={mark} position={[0, CITY_MARK_Y, 0]}>
      <mesh geometry={bladeGeometry('city')}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  </group>
}

export function Building({ game, vertexId, playerId, type, legalCity, pendingCity, reducedMotion, onCity }: { game: GameDisplayState; vertexId: string; playerId: string; type: 'settlement' | 'city'; legalCity: boolean; pendingCity?: boolean; reducedMotion: boolean; onCity?: () => void }) {
  const vertex = game.board.vertices[vertexId]
  const player = game.players.find((candidate) => candidate.id === playerId)
  const [hovered, setHovered] = useState(false)
  const drop = useRef<THREE.Group>(null)
  const emphasis = useRef<THREE.Group>(null)
  usePlacementDrop(drop, { id: vertexId, kind: type === 'city' ? 'city' : 'settlement', reducedMotion })
  useFrame((_, delta) => {
    if (!emphasis.current || reducedMotion) return
    const target = pendingCity ? 1.18 : hovered && legalCity ? 1.12 : 1
    const next = THREE.MathUtils.damp(emphasis.current.scale.x, target, 10, delta)
    emphasis.current.scale.set(next, next, next)
  })
  useCursor(legalCity && hovered)
  const owner: PlayerColor = player?.color ?? 'ivory'
  const yaw = useMemo(() => buildingYaw(vertex.x, vertex.z, hashString(vertexId), type === 'city' ? 'z' : 'x'), [vertex.x, vertex.z, vertexId, type])
  return <group position={[vertex.x, 0.478, vertex.z]} onClick={(event) => { event.stopPropagation(); if (legalCity) onCity?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
    <group ref={drop}><group ref={emphasis}>
      <Footing type={type} owner={owner} />
      <group rotation={[0, yaw, 0]} scale={type === 'city' ? 1.05 : 1.14}>
        {type === 'city' ? <CityModel color={owner} /> : <SettlementModel color={owner} />}
      </group>
    </group></group>
    {legalCity ? <CityBeacon
      vertexId={vertexId}
      color={pendingCity ? BEACON_PENDING : PLAYER_BEACON[actingColor(game)]}
      pending={Boolean(pendingCity)}
      hovered={hovered}
      reducedMotion={reducedMotion}
    /> : null}
  </group>
}

type VertexAction = Extract<GameAction, { type: 'place-settlement' | 'build-settlement' }>

/**
 * Emphasis ranking for the two setup placements, which offer 50 and 39 targets.
 * Total pips on the hexes a corner touches is the same heuristic the simulation
 * policy leads with, recomputed here from the board the scene already holds so
 * the presentation layer does not reach into the engine. Nothing is hidden —
 * the weaker corners still carry a full beacon at reduced strength, because the
 * player is allowed to found a settlement anywhere the rules permit.
 */
const vertexPips = (game: GameDisplayState) => {
  const pips = new Map<string, number>()
  for (const hex of game.board.hexes) {
    if (!hex.number) continue
    const weight = 6 - Math.abs(7 - hex.number)
    for (const vertexId of hex.vertices) pips.set(vertexId, (pips.get(vertexId) ?? 0) + weight)
  }
  return pips
}

const DENSITY_THRESHOLD = 20
const EMPHASISED = 8

/**
 * Legal settlement corners.
 *
 * Five instanced meshes: the dark ground pool, the coloured ring on it, the
 * near-black mast, the coloured caret, and the invisible hit cylinder that
 * carries the interaction. Five draw calls for the whole set, whether that set
 * is three corners or fifty.
 */
export function VertexTargets({ game, actions, pendingAction, touchTarget, onAction }: { game: GameDisplayState; actions: VertexAction[]; pendingAction?: GameAction; touchTarget: boolean; onAction: (action: GameAction) => void }) {
  const pad = useRef<THREE.InstancedMesh>(null)
  const band = useRef<THREE.InstancedMesh>(null)
  const mast = useRef<THREE.InstancedMesh>(null)
  const blade = useRef<THREE.InstancedMesh>(null)
  const hit = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tint = useMemo(() => new THREE.Color(), [])
  const [hovered, setHovered] = useState<number | null>(null)
  const reducedMotion = useReducedMotion()
  useCursor(hovered !== null)

  const beacon = useMemo(() => new THREE.Color(PLAYER_BEACON[actingColor(game)]), [game])
  const pendingTint = useMemo(() => new THREE.Color(BEACON_PENDING), [])

  // Per-target constants: the pulse offset and the emphasis rank. Both are
  // seeded from the board id, so a given corner looks the same every match.
  const seeds = useMemo(() => {
    const pips = vertexPips(game)
    const ranked = [...actions]
      .sort((a, b) => (pips.get(b.vertexId) ?? 0) - (pips.get(a.vertexId) ?? 0) || (a.vertexId < b.vertexId ? -1 : 1))
      .slice(0, EMPHASISED)
      .map((action) => action.vertexId)
    const top = new Set(actions.length > DENSITY_THRESHOLD ? ranked : actions.map((action) => action.vertexId))
    return actions.map((action) => ({
      phase: seededFrom(`beacon-${action.vertexId}`)(),
      emphasis: top.has(action.vertexId) ? 1 : 0.3,
    }))
  }, [actions, game])

  const hasPending = pendingAction?.type === 'place-settlement' || pendingAction?.type === 'build-settlement'

  useFrame(({ clock }) => {
    const touch = touchTarget ? 1.55 : 1
    actions.forEach((action, index) => {
      const vertex = game.board.vertices[action.vertexId]
      const seed = seeds[index]
      const pending = hasPending && pendingAction.vertexId === action.vertexId
      const active = hovered === index
      // A chosen target takes the frame; everything else steps back so the
      // confirm bar is describing something the eye can already single out.
      const quiet = hasPending && !pending ? 0.34 : 1
      const strength = seed.emphasis * quiet
      const scale = (pending ? 1.7 : active ? 1.25 : 1) * (0.72 + 0.28 * strength) * touch
      const pulse = beaconPulse(clock.elapsedTime, seed.phase, reducedMotion)
      const breathe = 0.92 + pulse * 0.14

      dummy.rotation.set(0, 0, 0)
      dummy.position.set(vertex.x, DECK_Y, vertex.z)
      dummy.scale.set(scale, 1, scale)
      dummy.updateMatrix()
      pad.current?.setMatrixAt(index, dummy.matrix)

      dummy.scale.set(scale * breathe, 1, scale * breathe)
      dummy.updateMatrix()
      band.current?.setMatrixAt(index, dummy.matrix)

      dummy.position.set(vertex.x, DECK_Y + PAD_TOP, vertex.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mast.current?.setMatrixAt(index, dummy.matrix)

      dummy.position.set(vertex.x, DECK_Y + PAD_TOP + (BLADE_Y + (reducedMotion ? 0 : pulse * 0.018)) * scale, vertex.z)
      dummy.rotation.set(0, (hashString(action.vertexId) % 4) * 0.02, 0)
      dummy.scale.setScalar(scale * (0.96 + pulse * 0.08))
      dummy.updateMatrix()
      blade.current?.setMatrixAt(index, dummy.matrix)

      dummy.rotation.set(0, 0, 0)
      dummy.position.set(vertex.x, DECK_Y + 0.2, vertex.z)
      dummy.scale.setScalar(touch)
      dummy.updateMatrix()
      hit.current?.setMatrixAt(index, dummy.matrix)

      tint.copy(pending ? pendingTint : beacon)
      if (active && !pending) tint.lerp(WHITE, 0.45)
      // Dimming a beacon darkens its bright half rather than fading it, so the
      // dark pool underneath keeps holding the value break either way.
      tint.multiplyScalar((0.42 + 0.58 * strength) * (0.86 + pulse * 0.14))
      band.current?.setColorAt(index, tint)
      blade.current?.setColorAt(index, tint)
    })
    for (const mesh of [pad.current, band.current, mast.current, blade.current, hit.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  // Instanced bounding spheres are computed from the identity geometry, so they
  // have to be refreshed whenever the set changes or raycasting misses.
  useEffect(() => {
    for (const mesh of [pad.current, band.current, mast.current, blade.current, hit.current]) mesh?.computeBoundingSphere()
  }, [actions])

  const instanceId = (event: ThreeEvent<MouseEvent>) => event.instanceId ?? -1
  return <group>
    <instancedMesh ref={pad} args={[undefined, undefined, actions.length]} geometry={padGeometry()} material={frameMaterial()} castShadow receiveShadow />
    <instancedMesh ref={band} args={[undefined, undefined, actions.length]} geometry={bandGeometry()} material={bladeMaterial()} />
    <instancedMesh ref={mast} args={[undefined, undefined, actions.length]} geometry={mastGeometry()} material={frameMaterial()} castShadow />
    <instancedMesh ref={blade} args={[undefined, undefined, actions.length]} geometry={bladeGeometry('settlement')} material={bladeMaterial()} />
    <instancedMesh
      ref={hit}
      args={[undefined, undefined, actions.length]}
      onClick={(event) => { event.stopPropagation(); const index = instanceId(event); if (actions[index]) onAction(actions[index]) }}
      onPointerMove={(event) => { event.stopPropagation(); setHovered(instanceId(event)) }}
      onPointerOut={() => setHovered(null)}
    >
      <cylinderGeometry args={[0.26, 0.26, 0.7, 10]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  </group>
}

export type { VertexAction }
