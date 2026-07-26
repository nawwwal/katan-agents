import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { BoardEdge, GameAction, GameDisplayState, PlayerColor } from '../game/types'
import { AssetMesh } from './AssetKit'
import { PLAYER_COLORS } from './playerColors'

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

export function Road({ game, edgeId, color, legal, pending, reducedMotion, touchTarget, onSelect }: { game: GameDisplayState; edgeId: string; color?: string; legal?: boolean; pending?: boolean; reducedMotion: boolean; touchTarget?: boolean; onSelect?: () => void }) {
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
    {legal ? <mesh castShadow receiveShadow position={[0, pending ? 0.065 : 0.035, 0]}>
      <boxGeometry args={[transform.length * (pending ? 0.9 : 0.86), pending ? 0.13 : 0.07, pending ? 0.18 : 0.11]} />
      <meshStandardMaterial color={pending ? '#77efff' : '#ffd65f'} emissive={pending ? '#087e98' : '#8d5a00'} emissiveIntensity={pending ? 1.2 : hovered ? 1.2 : 0.55} roughness={0.68} metalness={0.25} transparent opacity={0.9} />
    </mesh> : <AssetMesh asset="Road" color={color ?? '#67503d'} scale={[transform.length / 0.92, 1, 1]} />}
    {legal ? <mesh position={[0, 0.08, 0]}>
      <boxGeometry args={[transform.length * 0.74, 0.22, touchTarget ? 0.68 : 0.34]} />
      <meshBasicMaterial visible={false} />
    </mesh> : null}
  </group>
}

export function Building({ game, vertexId, playerId, type, legalCity, pendingCity, reducedMotion, onCity }: { game: GameDisplayState; vertexId: string; playerId: string; type: 'settlement' | 'city'; legalCity: boolean; pendingCity?: boolean; reducedMotion: boolean; onCity?: () => void }) {
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
  return <group ref={group} position={[vertex.x, 0.478, vertex.z]} onClick={(event) => { event.stopPropagation(); if (legalCity) onCity?.() }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)} scale={reducedMotion ? 1 : 0.08}>
    <AssetMesh asset={type === 'city' ? 'City' : 'Settlement'} color={color} />
    {legalCity ? <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.29, pendingCity ? 0.43 : 0.38, 24]} /><meshBasicMaterial color={pendingCity ? '#78efff' : '#ffd45b'} transparent opacity={0.9} /></mesh> : null}
  </group>
}

type VertexAction = Extract<GameAction, { type: 'place-settlement' | 'build-settlement' }>

export function VertexTargets({ game, actions, pendingAction, touchTarget, onAction }: { game: GameDisplayState; actions: VertexAction[]; pendingAction?: GameAction; touchTarget: boolean; onAction: (action: GameAction) => void }) {
  const peg = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.InstancedMesh>(null)
  const hit = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const [hovered, setHovered] = useState<number | null>(null)
  useCursor(hovered !== null)

  useEffect(() => {
    actions.forEach((action, index) => {
      const vertex = game.board.vertices[action.vertexId]
      const pending = (pendingAction?.type === 'place-settlement' || pendingAction?.type === 'build-settlement') && pendingAction.vertexId === action.vertexId
      const active = hovered === index
      const scale = pending ? 1.35 : active ? 1.18 : 1
      const height = pending ? 0.13 : 0.05

      dummy.position.set(vertex.x, 0.478 + height / 2, vertex.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(scale, height / 0.05, scale)
      dummy.updateMatrix()
      peg.current?.setMatrixAt(index, dummy.matrix)
      dummy.position.set(vertex.x, 0.478 + height + 0.012, vertex.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.setScalar(pending ? 1.5 : active ? 1.22 : 1)
      dummy.updateMatrix()
      ring.current?.setMatrixAt(index, dummy.matrix)
      dummy.position.set(vertex.x, 0.558, vertex.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(touchTarget ? 1.55 : 1)
      dummy.updateMatrix()
      hit.current?.setMatrixAt(index, dummy.matrix)
    })
    for (const mesh of [peg.current, ring.current, hit.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [actions, dummy, game.board.vertices, hovered, pendingAction, touchTarget])

  const instanceId = (event: ThreeEvent<MouseEvent>) => event.instanceId ?? -1
  return <group>
    <instancedMesh ref={peg} args={[undefined, undefined, actions.length]} castShadow>
      <cylinderGeometry args={[0.075, 0.095, 0.05, 8]} />
      <meshBasicMaterial color="#ffd45b" toneMapped={false} />
    </instancedMesh>
    <instancedMesh ref={ring} args={[undefined, undefined, actions.length]}>
      <ringGeometry args={[0.09, 0.125, 20]} />
      <meshBasicMaterial color="#fff0af" transparent opacity={0.78} side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
    <instancedMesh
      ref={hit}
      args={[undefined, undefined, actions.length]}
      onClick={(event) => { event.stopPropagation(); const index = instanceId(event); if (actions[index]) onAction(actions[index]) }}
      onPointerMove={(event) => { event.stopPropagation(); setHovered(instanceId(event)) }}
      onPointerOut={() => setHovered(null)}
    >
      <cylinderGeometry args={[0.24, 0.24, 0.16, 10]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  </group>
}


export type { VertexAction }
