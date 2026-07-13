import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameDisplayState, Resource } from '../game/types'
import type { GamePresentation } from '../game/useGame'

const RESOURCE_COLOR: Record<Resource, string> = {
  brick: '#d86843',
  lumber: '#4b9a5f',
  ore: '#a5bcc5',
  grain: '#f0c84b',
  wool: '#dff0b8',
}

type Flow = { id: string; from: THREE.Vector3; to: THREE.Vector3; color: string }

function ResourceFlow({ flow, reducedMotion }: { flow: Flow; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  const started = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    if (!group.current) return
    started.current ??= clock.elapsedTime
    const elapsed = clock.elapsedTime - started.current
    group.current.visible = reducedMotion || elapsed < 2.35
    group.current.children.forEach((child, index) => {
      const progress = reducedMotion ? 0.55 : Math.min(1, Math.max(0, elapsed * 0.7 - index * 0.14))
      child.position.lerpVectors(flow.from, flow.to, progress)
      child.position.y += Math.sin(progress * Math.PI) * 0.7
      child.scale.setScalar(0.72 + Math.sin(progress * Math.PI) * 0.5)
    })
  })
  return <group ref={group}>{Array.from({ length: 5 }, (_, index) => <mesh key={index} castShadow>
    <icosahedronGeometry args={[0.095, 1]} />
    <meshStandardMaterial color={flow.color} emissive={flow.color} emissiveIntensity={0.55} roughness={0.5} />
  </mesh>)}</group>
}

function PulseRing({ position, color, reducedMotion }: { position: [number, number, number]; color: string; reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null)
  const started = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    started.current ??= clock.elapsedTime
    const elapsed = clock.elapsedTime - started.current
    mesh.current.visible = reducedMotion || elapsed < 2.35
    const scale = reducedMotion ? 0.75 : 0.55 + (elapsed % 0.72) * 0.65
    mesh.current.scale.setScalar(scale)
    ;(mesh.current.material as THREE.MeshBasicMaterial).opacity = reducedMotion ? 0.42 : Math.max(0, 0.72 - (elapsed % 0.72))
  })
  return <mesh ref={mesh} position={position} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[0.62, 0.72, 36]} />
    <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
  </mesh>
}

function ProductionEffects({ game, presentation, reducedMotion }: { game: GameDisplayState; presentation: GamePresentation; reducedMotion: boolean }) {
  const total = game.lastRoll ? game.lastRoll[0] + game.lastRoll[1] : 0
  const producing = game.board.hexes.filter((tile) => tile.number === total && tile.id !== game.board.robberHexId && tile.terrain !== 'desert')
  const flows = useMemo(() => producing.flatMap((tile) => tile.vertices.flatMap((vertexId) => {
    const building = game.buildings[vertexId]
    if (!building || tile.terrain === 'desert') return []
    const vertex = game.board.vertices[vertexId]
    return [{
      id: `${tile.id}-${vertexId}`,
      from: new THREE.Vector3(tile.x, 0.62, tile.z),
      to: new THREE.Vector3(vertex.x, 0.72, vertex.z),
      color: RESOURCE_COLOR[tile.terrain],
    } satisfies Flow]
  })), [game.board, game.buildings, producing])
  if (presentation.actionType !== 'roll-dice' || !producing.length) return null
  return <group>
    {producing.map((tile) => <PulseRing key={tile.id} position={[tile.x, 0.48, tile.z]} color={RESOURCE_COLOR[tile.terrain as Resource]} reducedMotion={reducedMotion} />)}
    {flows.map((flow) => <ResourceFlow key={flow.id} flow={flow} reducedMotion={reducedMotion} />)}
  </group>
}

function ConstructionBurst({ game, presentation, reducedMotion }: { game: GameDisplayState; presentation: GamePresentation; reducedMotion: boolean }) {
  const event = presentation.events.findLast((candidate) => candidate.publicData?.vertexId || candidate.publicData?.edgeId || candidate.publicData?.hexId)
  const target = useMemo(() => {
    const vertexId = event?.publicData?.vertexId
    if (typeof vertexId === 'string') {
      const vertex = game.board.vertices[vertexId]
      if (vertex) return new THREE.Vector3(vertex.x, 0.48, vertex.z)
    }
    const edgeId = event?.publicData?.edgeId
    if (typeof edgeId === 'string') {
      const edge = game.board.edges[edgeId]
      if (edge) {
        const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
        return new THREE.Vector3((a.x + b.x) / 2, 0.48, (a.z + b.z) / 2)
      }
    }
    const hexId = event?.publicData?.hexId
    if (typeof hexId === 'string') {
      const tile = game.board.hexes.find((candidate) => candidate.id === hexId)
      if (tile) return new THREE.Vector3(tile.x, 0.5, tile.z)
    }
  }, [event, game.board])
  const group = useRef<THREE.Group>(null)
  const started = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    if (!group.current || !target) return
    started.current ??= clock.elapsedTime
    const elapsed = clock.elapsedTime - started.current
    group.current.visible = reducedMotion || elapsed < 1.55
    group.current.children.forEach((child, index) => {
      const progress = reducedMotion ? 0.35 : Math.min(1, elapsed / 1.15)
      const angle = index * Math.PI * 0.25
      child.position.set(target.x + Math.cos(angle) * progress * 0.48, target.y + Math.sin(progress * Math.PI) * 0.32, target.z + Math.sin(angle) * progress * 0.48)
      child.scale.setScalar((1 - progress * 0.6) * (0.7 + (index % 3) * 0.16))
    })
  })
  if (!target || presentation.actionType === 'roll-dice') return null
  const robber = presentation.actionType === 'move-robber' || presentation.actionType === 'steal-from'
  const construction = ['place-settlement', 'place-road', 'build-settlement', 'build-road', 'build-city'].includes(presentation.actionType)
  if (!robber && !construction) return null
  const color = robber ? '#2b3036' : '#d9b263'
  return <group ref={group}>{Array.from({ length: 8 }, (_, index) => <mesh key={index} castShadow>
    <dodecahedronGeometry args={[0.07, 0]} />
    <meshStandardMaterial color={color} emissive={robber ? '#711f19' : '#6d451d'} emissiveIntensity={0.35} roughness={0.82} />
  </mesh>)}</group>
}

export function ActionEffects({ game, presentation, reducedMotion }: { game: GameDisplayState; presentation?: GamePresentation; reducedMotion: boolean }) {
  if (!presentation) return null
  return <group key={presentation.revision}>
    <ProductionEffects game={game} presentation={presentation} reducedMotion={reducedMotion} />
    <ConstructionBurst game={game} presentation={presentation} reducedMotion={reducedMotion} />
  </group>
}
