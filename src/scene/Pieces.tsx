import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import { usePlacementDrop } from './motion/placement'
import { PLAYER_TRIM, colorKeyFromHex } from './playerColors'
import { CityModel, SettlementModel } from './structures/Buildings'
import { RoadGhost, RoadModel } from './structures/Road'
import { apronMaterial, cobbleMaterial, kerbRingMaterial, terraceMaterial } from './structures/materials'
import { hashString, haloTexture, makeRng } from './structures/textures'

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
 * A built road, hinged down onto its edge by the shared placement physics
 * rather than scaled up in place.
 */
function PlacedRoad({ edgeId, owner, length, reducedMotion }: { edgeId: string; owner: PlayerColor; length: number; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  usePlacementDrop(group, { id: edgeId, kind: 'road', reducedMotion })
  return <group ref={group}>
    <RoadModel color={owner} length={length} />
  </group>
}

export function Road({ game, edgeId, color, legal, pending, reducedMotion, touchTarget, onSelect }: { game: GameDisplayState; edgeId: string; color?: string; legal?: boolean; pending?: boolean; reducedMotion: boolean; touchTarget?: boolean; onSelect?: () => void }) {
  const edge = game.board.edges[edgeId]
  const transform = edgeTransform(game, edge)
  const [hovered, setHovered] = useState(false)
  useCursor(Boolean(legal && hovered))
  const owner = colorKeyFromHex(color)
  return <group position={transform.position} rotation={transform.rotation} onClick={(event) => { event.stopPropagation(); if (legal) onSelect?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
    {legal
      ? <RoadGhost length={transform.length} color={pending ? '#8ef0ff' : hovered ? '#ffe9a6' : '#ffcf5e'} opacity={pending ? 0.92 : hovered ? 0.82 : 0.5} emissive={pending ? 1.15 : hovered ? 0.85 : 0.42} />
      : <PlacedRoad edgeId={edgeId} owner={owner} length={transform.length} reducedMotion={reducedMotion} />}
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
    {legalCity ? <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[pendingCity ? 0.62 : 0.55, 40]} />
      <meshBasicMaterial map={haloTexture()} color={pendingCity ? '#9df2ff' : '#ffd45b'} transparent opacity={pendingCity ? 0.95 : 0.72} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh> : null}
  </group>
}

type VertexAction = Extract<GameAction, { type: 'place-settlement' | 'build-settlement' }>

const PLACEMENT_BASE = new THREE.Color('#ffd45b')
const PLACEMENT_ACTIVE = new THREE.Color('#fff3c4')
const PLACEMENT_PENDING = new THREE.Color('#8ef0ff')

/**
 * Build sites: a small cobbled pad, a surveyor's stake with a pennant, and a
 * soft ground halo. Lit like the rest of the board so it reads as game UI
 * placed in the world rather than a debug gizmo.
 */
export function VertexTargets({ game, actions, pendingAction, touchTarget, onAction }: { game: GameDisplayState; actions: VertexAction[]; pendingAction?: GameAction; touchTarget: boolean; onAction: (action: GameAction) => void }) {
  const pad = useRef<THREE.InstancedMesh>(null)
  const halo = useRef<THREE.InstancedMesh>(null)
  const stake = useRef<THREE.InstancedMesh>(null)
  const flag = useRef<THREE.InstancedMesh>(null)
  const hit = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const [hovered, setHovered] = useState<number | null>(null)
  useCursor(hovered !== null)

  useEffect(() => {
    actions.forEach((action, index) => {
      const vertex = game.board.vertices[action.vertexId]
      const pending = (pendingAction?.type === 'place-settlement' || pendingAction?.type === 'build-settlement') && pendingAction.vertexId === action.vertexId
      const active = hovered === index
      const scale = pending ? 1.3 : active ? 1.14 : 1
      const tint = pending ? PLACEMENT_PENDING : active ? PLACEMENT_ACTIVE : PLACEMENT_BASE

      dummy.position.set(vertex.x, 0.482, vertex.z)
      dummy.rotation.set(0, hashString(action.vertexId) % 6, 0)
      dummy.scale.set(scale, 1, scale)
      dummy.updateMatrix()
      pad.current?.setMatrixAt(index, dummy.matrix)

      dummy.position.set(vertex.x, 0.5, vertex.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.setScalar(pending ? 1.4 : active ? 1.16 : 1)
      dummy.updateMatrix()
      halo.current?.setMatrixAt(index, dummy.matrix)
      halo.current?.setColorAt(index, tint)

      dummy.position.set(vertex.x, 0.5 + (pending ? 0.02 : 0), vertex.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, pending ? 1.24 : active ? 1.1 : 1, 1)
      dummy.updateMatrix()
      stake.current?.setMatrixAt(index, dummy.matrix)

      const rise = 0.5 + (pending ? 0.225 : active ? 0.21 : 0.195)
      dummy.position.set(vertex.x + 0.063, rise, vertex.z)
      dummy.rotation.set(0, 0.2, 0)
      dummy.scale.setScalar(pending ? 1.22 : active ? 1.1 : 1)
      dummy.updateMatrix()
      flag.current?.setMatrixAt(index, dummy.matrix)
      flag.current?.setColorAt(index, tint)

      dummy.position.set(vertex.x, 0.56, vertex.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(touchTarget ? 1.55 : 1)
      dummy.updateMatrix()
      hit.current?.setMatrixAt(index, dummy.matrix)
    })
    for (const mesh of [pad.current, halo.current, stake.current, flag.current, hit.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [actions, dummy, game.board.vertices, hovered, pendingAction, touchTarget])

  const instanceId = (event: ThreeEvent<MouseEvent>) => event.instanceId ?? -1
  return <group>
    <instancedMesh ref={pad} args={[undefined, undefined, actions.length]} receiveShadow>
      <cylinderGeometry args={[0.15, 0.17, 0.026, 8]} />
      <primitive object={cobbleMaterial()} attach="material" />
    </instancedMesh>
    <instancedMesh ref={halo} args={[undefined, undefined, actions.length]}>
      <circleGeometry args={[0.3, 32]} />
      <meshBasicMaterial map={haloTexture()} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
    </instancedMesh>
    <instancedMesh ref={stake} args={[undefined, undefined, actions.length]} castShadow>
      <cylinderGeometry args={[0.009, 0.013, 0.24, 6]} />
      <meshStandardMaterial color="#6f4f31" roughness={0.85} />
    </instancedMesh>
    <instancedMesh ref={flag} args={[undefined, undefined, actions.length]} castShadow>
      <boxGeometry args={[0.12, 0.075, 0.005]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffc846" emissiveIntensity={0.55} roughness={0.72} side={THREE.DoubleSide} />
    </instancedMesh>
    <instancedMesh
      ref={hit}
      args={[undefined, undefined, actions.length]}
      onClick={(event) => { event.stopPropagation(); const index = instanceId(event); if (actions[index]) onAction(actions[index]) }}
      onPointerMove={(event) => { event.stopPropagation(); setHovered(instanceId(event)) }}
      onPointerOut={() => setHovered(null)}
    >
      <cylinderGeometry args={[0.24, 0.24, 0.2, 10]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  </group>
}

export type { VertexAction }
