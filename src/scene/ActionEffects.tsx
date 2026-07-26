import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameDisplayState, Resource } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { AmbientLife } from './motion/AmbientLife'
import { emitBeat, type BeatKind } from './motion/beats'
import { useMotionDemo } from './motion/demo'
import { DiceRoll } from './motion/Dice'
import { Burst, Flare, Motes, Shockwave } from './motion/Particles'
import { easeOutCubic, easeOutQuart, saturate, scaled, seededFrom } from './motion/spring'
import { CONTACT, PRODUCTION_DELAY } from './motion/timing'
import { PLAYER_COLORS } from './playerColors'

const RESOURCE_COLOR: Record<Resource, string> = {
  brick: '#d86843',
  lumber: '#4b9a5f',
  ore: '#a5bcc5',
  grain: '#f0c84b',
  wool: '#dff0b8',
}

const RESOURCE_COLORS = new Map<Resource, THREE.Color>()
const resourceColor = (resource: Resource) => {
  const cached = RESOURCE_COLORS.get(resource)
  if (cached) return cached
  const color = new THREE.Color(RESOURCE_COLOR[resource])
  RESOURCE_COLORS.set(resource, color)
  return color
}

/** Motes per tile-to-settlement payout. */
const MOTES_PER_FLOW = 4

const GROUND = 0.478
const BUILD_ACTIONS = new Set(['place-settlement', 'place-road', 'build-settlement', 'build-road'])

// ------------------------------------------------------------- production

type Flow = { id: string; from: THREE.Vector3; to: THREE.Vector3; color: THREE.Color }

/**
 * Every resource mote on the board, from every producing tile to every
 * settlement, in one InstancedMesh. A hot 6 on a crowded board is one draw
 * call instead of forty, and per-instance colour keeps each resource its own.
 */
function ResourceFlows({ flows, reducedMotion }: { flows: Flow[]; reducedMotion: boolean }) {
  const motes = useRef<THREE.InstancedMesh>(null)
  const landings = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const started = useRef<number | undefined>(undefined)

  const seeds = useMemo(() => flows.flatMap((flow, flowIndex) => {
    const random = seededFrom(flow.id)
    return Array.from({ length: MOTES_PER_FLOW }, (_, index) => ({
      flowIndex,
      delay: index * 0.1 + random() * 0.05,
      swirl: (random() - 0.5) * 0.34,
      lift: 0.5 + random() * 0.3,
      size: 0.075 + random() * 0.035,
    }))
  }), [flows])

  useEffect(() => {
    for (let index = 0; index < seeds.length; index += 1) motes.current?.setColorAt(index, flows[seeds[index].flowIndex].color)
    for (let index = 0; index < flows.length; index += 1) landings.current?.setColorAt(index, flows[index].color)
    if (motes.current?.instanceColor) motes.current.instanceColor.needsUpdate = true
    if (landings.current?.instanceColor) landings.current.instanceColor.needsUpdate = true
  }, [flows, seeds])

  useFrame(({ clock }) => {
    const mesh = motes.current
    const flash = landings.current
    if (!mesh || !flash) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current) - (reducedMotion ? 0 : PRODUCTION_DELAY)
    if (reducedMotion) {
      // The payout is information, so it appears at once as a static marker at
      // each destination — and then clears on the same schedule the animated
      // version would have, rather than staying on the board for the match.
      mesh.visible = false
      flash.visible = elapsed < 2.1
      if (!flash.visible) return
      for (let index = 0; index < flows.length; index += 1) {
        const flow = flows[index]
        dummy.position.set(flow.to.x, flow.to.y + 0.02, flow.to.z)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.setScalar(0.24)
        dummy.updateMatrix()
        flash.setMatrixAt(index, dummy.matrix)
      }
      flash.instanceMatrix.needsUpdate = true
      ;(flash.material as THREE.MeshBasicMaterial).opacity = 0.5
      return
    }
    const live = elapsed > 0 && elapsed < 2.1
    mesh.visible = live
    flash.visible = live
    if (!live) return

    const arrived = Array.from({ length: flows.length }, () => 0)
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index]
      const flow = flows[seed.flowIndex]
      const t = saturate((elapsed - seed.delay) / 0.95)
      const eased = easeOutCubic(t)
      dummy.position.lerpVectors(flow.from, flow.to, eased)
      dummy.position.y += Math.sin(eased * Math.PI) * seed.lift
      dummy.position.x += Math.sin(eased * Math.PI) * seed.swirl
      dummy.position.z += Math.cos(eased * Math.PI * 0.8) * seed.swirl * 0.6
      dummy.rotation.set(elapsed * 3.1, elapsed * 2.2, 0)
      // Pop in, hold, snap out at the destination.
      const life = t < 0.12 ? t / 0.12 : t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1
      dummy.scale.setScalar(seed.size * life * (1 + Math.sin(eased * Math.PI) * 0.5))
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      if (t >= 1) arrived[seed.flowIndex] += 1
    }
    mesh.instanceMatrix.needsUpdate = true

    const fade = 1 - saturate((elapsed - 1.1) / 0.6)
    for (let index = 0; index < flows.length; index += 1) {
      const flow = flows[index]
      const strength = saturate((arrived[index] / MOTES_PER_FLOW) * 1.4) * fade
      dummy.position.set(flow.to.x, flow.to.y + 0.02, flow.to.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.setScalar(0.16 + easeOutQuart(strength) * 0.32)
      dummy.updateMatrix()
      flash.setMatrixAt(index, dummy.matrix)
    }
    flash.instanceMatrix.needsUpdate = true
    ;(flash.material as THREE.MeshBasicMaterial).opacity = fade * 0.55
  })

  if (!flows.length) return null
  return <group>
    <instancedMesh ref={motes} args={[undefined, undefined, flows.length * MOTES_PER_FLOW]} frustumCulled={false} castShadow>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial emissiveIntensity={0.6} roughness={0.45} flatShading />
    </instancedMesh>
    <instancedMesh ref={landings} args={[undefined, undefined, flows.length]} frustumCulled={false} renderOrder={2}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  </group>
}

/** One hex outline per producing tile, again batched into a single mesh. */
function TilePulses({ tiles, reducedMotion }: { tiles: { x: number; z: number; color: THREE.Color }[]; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const started = useRef<number | undefined>(undefined)

  useEffect(() => {
    tiles.forEach((tile, index) => mesh.current?.setColorAt(index, tile.color))
    if (mesh.current?.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [tiles])

  useFrame(({ clock }) => {
    const ring = mesh.current
    if (!ring) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current) - (reducedMotion ? 0 : PRODUCTION_DELAY)
    const write = (scale: number) => {
      tiles.forEach((tile, index) => {
        dummy.position.set(tile.x, GROUND + 0.02, tile.z)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.setScalar(scale)
        dummy.updateMatrix()
        ring.setMatrixAt(index, dummy.matrix)
      })
      ring.instanceMatrix.needsUpdate = true
    }
    if (reducedMotion) {
      // Which tiles produced is information. Draw it steady, and take it away
      // when the pulse would have finished — a ring left on the board forever
      // is not a calmer animation, it is permanent clutter.
      ring.visible = elapsed < 1.9
      if (!ring.visible) return
      write(0.78)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.4
      return
    }
    ring.visible = elapsed > 0 && elapsed < 1.9
    if (!ring.visible) return
    // Two pulses, the second weaker — a heartbeat rather than a metronome.
    const beat = elapsed % 0.78
    const wave = easeOutQuart(saturate(beat / 0.6))
    const strength = elapsed < 0.78 ? 1 : 0.55
    write(0.42 + wave * 0.52)
    ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - wave) ** 1.6 * 0.72 * strength
  })

  if (!tiles.length) return null
  return <instancedMesh ref={mesh} args={[undefined, undefined, tiles.length]} frustumCulled={false} renderOrder={2}>
    <ringGeometry args={[0.84, 1, 6, 1, Math.PI / 6]} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
  </instancedMesh>
}

function ProductionEffects({ game, reducedMotion }: { game: GameDisplayState; reducedMotion: boolean }) {
  const total = game.lastRoll ? game.lastRoll[0] + game.lastRoll[1] : 0
  const producing = useMemo(
    () => game.board.hexes.filter((tile) => tile.number === total && tile.id !== game.board.robberHexId && tile.terrain !== 'desert'),
    [game.board.hexes, game.board.robberHexId, total],
  )
  const tiles = useMemo(() => producing.map((tile) => ({ x: tile.x, z: tile.z, color: resourceColor(tile.terrain as Resource) })), [producing])
  const flows = useMemo(() => producing.flatMap((tile) => tile.vertices.flatMap((vertexId) => {
    const building = game.buildings[vertexId]
    if (!building || tile.terrain === 'desert') return []
    const vertex = game.board.vertices[vertexId]
    return [{
      id: `${tile.id}-${vertexId}`,
      from: new THREE.Vector3(tile.x, GROUND + 0.16, tile.z),
      to: new THREE.Vector3(vertex.x, GROUND + 0.3, vertex.z),
      color: resourceColor(tile.terrain),
    } satisfies Flow]
  })), [game.board.vertices, game.buildings, producing])
  if (!producing.length) return null
  return <group>
    <TilePulses tiles={tiles} reducedMotion={reducedMotion} />
    <ResourceFlows flows={flows} reducedMotion={reducedMotion} />
  </group>
}

// -------------------------------------------------------------- placement

/**
 * The contact moment for a piece landing: compression ring, kicked dust, a
 * handful of chips and a short warm flare. The piece's own drop lives in
 * `motion/placement.ts`.
 */
function PlacementImpact({ id, at, heavy, color, reducedMotion }: { id: string; at: THREE.Vector3; heavy: boolean; color: string; reducedMotion: boolean }) {
  // Terrain props stand well above the nominal turf line, so a wide ground
  // ring gets buried in rocks and trees. Keep the rings small and tight to the
  // piece, and ride high enough to clear the clutter around a vertex.
  const y = GROUND + 0.16
  const origin: [number, number, number] = [at.x, y, at.z]
  return <group>
    <Shockwave origin={origin} color={color} radius={heavy ? 0.78 : 0.58} life={heavy ? 0.66 : 0.54} thickness={0.28} delay={CONTACT} reducedMotion={reducedMotion} />
    <Shockwave origin={[at.x, y + 0.02, at.z]} color="#fff0cf" radius={heavy ? 0.5 : 0.38} life={0.38} thickness={0.5} delay={CONTACT + 0.04} reducedMotion={reducedMotion} />
    <Burst id={`${id}-dust`} origin={[at.x, y, at.z]} count={heavy ? 24 : 17} color="#d3c3a3" speed={1.9} spread={0.96} gravity={2.8} life={0.95} size={0.032} delay={CONTACT} reducedMotion={reducedMotion} />
    <Burst id={`${id}-chips`} origin={[at.x, y + 0.04, at.z]} count={heavy ? 10 : 7} color="#8a6b4a" speed={2.4} spread={0.62} gravity={9.5} life={0.8} size={0.026} shape="debris" delay={CONTACT} reducedMotion={reducedMotion} />
    <Flare origin={[at.x, y + 0.16, at.z]} color={color} size={heavy ? 1.9 : 1.4} life={0.45} delay={CONTACT} reducedMotion={reducedMotion} />
  </group>
}

// ----------------------------------------------------------------- robber

function RobberMoment({ id, at, reducedMotion }: { id: string; at: THREE.Vector3; reducedMotion: boolean }) {
  const shroud = useRef<THREE.Mesh>(null)
  const started = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    const mesh = shroud.current
    if (!mesh) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)
    mesh.visible = elapsed < 1.5
    if (!mesh.visible) return
    // Darkness closes in, then lifts. The tile is being taken, not celebrated.
    const t = saturate(elapsed / 1.5)
    mesh.scale.setScalar(1.25 - easeOutCubic(saturate(t * 2.6)) * 0.32)
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) ** 0.7 * 0.55
  })
  // The shroud is decoration; the robber model already says which tile it is
  // on, so under reduced motion it simply is not drawn.
  return <group>
    {reducedMotion ? null : <mesh ref={shroud} position={[at.x, GROUND + 0.015, at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <circleGeometry args={[0.98, 6, Math.PI / 6]} />
      <meshBasicMaterial color="#10131a" transparent opacity={0} depthWrite={false} />
    </mesh>}
    <Shockwave origin={[at.x, GROUND + 0.02, at.z]} color="#7c2a20" radius={1.15} life={0.7} thickness={0.09} reducedMotion={reducedMotion} />
    <Burst id={`${id}-ink`} origin={[at.x, GROUND + 0.08, at.z]} count={14} color="#232830" emissive="#5d1a14" speed={1.9} spread={0.8} gravity={4.4} life={1} size={0.055} shape="debris" reducedMotion={reducedMotion} />
  </group>
}

// ----------------------------------------------------------------- awards

/** A light runs the whole length of the road network that just won the title. */
function LongestRoadSweep({ game, playerId, color, reducedMotion }: { game: GameDisplayState; playerId: string; color: string; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const started = useRef<number | undefined>(undefined)
  const nodes = useMemo(() => Object.entries(game.roadOwners)
    .filter(([, owner]) => owner === playerId)
    .flatMap(([edgeId]) => {
      const edge = game.board.edges[edgeId]
      if (!edge) return []
      const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
      const x = (a.x + b.x) / 2
      const z = (a.z + b.z) / 2
      return [{ x, z, order: Math.hypot(x, z) }]
    })
    .sort((a, b) => a.order - b.order), [game.board.edges, game.board.vertices, game.roadOwners, playerId])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced || !nodes.length) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)
    const life = 0.42 + nodes.length * 0.09 + 0.5
    if (elapsed > life) { instanced.visible = false; return }
    instanced.visible = true
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      const t = saturate((elapsed - index * 0.09) / 0.55)
      const flash = t <= 0 ? 0 : Math.sin(t * Math.PI) ** 0.8
      dummy.position.set(node.x, GROUND + 0.05 + flash * 0.16, node.z)
      dummy.rotation.set(-Math.PI / 2, 0, elapsed * 1.4)
      dummy.scale.setScalar(0.22 * flash)
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
  })

  if (!nodes.length || reducedMotion) return null
  return <instancedMesh ref={mesh} args={[undefined, undefined, nodes.length]} frustumCulled={false} renderOrder={3}>
    <ringGeometry args={[0.45, 1, 16]} />
    <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
  </instancedMesh>
}

/** Largest army reads as one hard concussion at the robber, not a parade. */
function LargestArmyMoment({ game, color, reducedMotion }: { game: GameDisplayState; color: string; reducedMotion: boolean }) {
  const hex = game.board.hexes.find((tile) => tile.id === game.board.robberHexId)
  if (!hex) return null
  const origin: [number, number, number] = [hex.x, GROUND + 0.02, hex.z]
  return <group>
    <Shockwave origin={origin} color={color} radius={1.5} life={0.55} thickness={0.08} reducedMotion={reducedMotion} />
    <Shockwave origin={origin} color={color} radius={2.4} life={0.8} thickness={0.05} delay={0.14} reducedMotion={reducedMotion} />
    <Flare origin={[hex.x, GROUND + 0.3, hex.z]} color={color} size={2.1} life={0.42} reducedMotion={reducedMotion} />
    <Burst id={`army-${game.revision}`} origin={[hex.x, GROUND + 0.1, hex.z]} count={18} color={color} speed={3.1} spread={0.5} gravity={7.5} life={1.05} size={0.04} shape="debris" reducedMotion={reducedMotion} />
  </group>
}

function VictoryMoment({ game, color, reducedMotion }: { game: GameDisplayState; color: string; reducedMotion: boolean }) {
  const winner = game.players.find((player) => player.id === game.winnerId)
  const holdings = useMemo(() => Object.entries(game.buildings)
    .filter(([, building]) => building.playerId === game.winnerId)
    .flatMap(([vertexId]) => {
      const vertex = game.board.vertices[vertexId]
      return vertex ? [[vertex.x, vertex.z] as const] : []
    }), [game.board.vertices, game.buildings, game.winnerId])
  if (!winner) return null
  return <group>
    <Shockwave origin={[0, GROUND + 0.02, 0]} color={color} radius={6.2} life={1.6} thickness={0.02} reducedMotion={reducedMotion} />
    <Motes id={`victory-${game.revision}`} origin={[0, GROUND + 0.2, 0]} count={64} color="#ffd98a" spread={4.4} rise={3.4} life={7} size={0.05} opacity={0.75} reducedMotion={reducedMotion} />
    {holdings.map(([x, z], index) => <group key={index}>
      <Shockwave origin={[x, GROUND + 0.03, z]} color={color} radius={0.9} life={0.9} thickness={0.12} delay={index * 0.12} reducedMotion={reducedMotion} />
      <Motes id={`victory-${game.revision}-${index}`} origin={[x, GROUND + 0.25, z]} count={12} color={color} spread={0.28} rise={1.5} life={6} size={0.045} opacity={0.8} reducedMotion={reducedMotion} />
    </group>)}
  </group>
}

// ----------------------------------------------------------------- handoff

/**
 * The baton pass.
 *
 * A player sees this sixty times a match, so it is deliberately the quietest
 * thing in the file: one thin ring in the incoming player's colour, over their
 * own holdings, for half a second. It answers "whose board is this now" in the
 * place on the board where the answer matters, and then it is gone. Anything
 * with more presence than this would be exhausting by the third turn.
 */
function HandoffMoment({ game, reducedMotion }: { game: GameDisplayState; reducedMotion: boolean }) {
  const incoming = game.players[game.activePlayerIndex]
  const home = useMemo(() => {
    if (!incoming) return undefined
    const spots = Object.entries(game.buildings).flatMap(([vertexId, building]) => {
      if (building.playerId !== incoming.id) return []
      const vertex = game.board.vertices[vertexId]
      return vertex ? [[vertex.x, vertex.z] as const] : []
    })
    if (!spots.length) return undefined
    const x = spots.reduce((total, spot) => total + spot[0], 0) / spots.length
    const z = spots.reduce((total, spot) => total + spot[1], 0) / spots.length
    return [x, z] as const
  }, [game.board.vertices, game.buildings, incoming])

  if (!incoming || !home) return null
  return <Shockwave
    origin={[home[0], GROUND + 0.62, home[1]]}
    color={PLAYER_COLORS[incoming.color]}
    radius={1.05}
    life={0.5}
    thickness={0.075}
    reducedMotion={reducedMotion}
  />
}

// ------------------------------------------------------------------ entry

const beatFor = (actionType: string, awards: boolean, victory: boolean): BeatKind => {
  if (victory) return 'victory'
  if (awards) return 'award'
  if (actionType === 'end-turn') return 'handoff'
  if (actionType === 'roll-dice') return 'roll'
  if (actionType === 'build-city') return 'city'
  if (BUILD_ACTIONS.has(actionType)) return 'place'
  if (actionType === 'move-robber' || actionType === 'steal-from') return 'robber'
  if (['offer-trade', 'counter-trade', 'respond-trade', 'maritime-trade', 'choose-monopoly', 'choose-year-of-plenty'].includes(actionType)) return 'trade'
  return 'quiet'
}

function ActionMoment({ game, presentation, reducedMotion }: { game: GameDisplayState; presentation: GamePresentation; reducedMotion: boolean }) {
  const event = presentation.events.findLast((candidate) => candidate.publicData?.vertexId || candidate.publicData?.edgeId || candidate.publicData?.hexId)
  const at = useMemo(() => {
    const vertexId = event?.publicData?.vertexId
    if (typeof vertexId === 'string') {
      const vertex = game.board.vertices[vertexId]
      if (vertex) return new THREE.Vector3(vertex.x, GROUND, vertex.z)
    }
    const edgeId = event?.publicData?.edgeId
    if (typeof edgeId === 'string') {
      const edge = game.board.edges[edgeId]
      if (edge) {
        const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
        return new THREE.Vector3((a.x + b.x) / 2, GROUND, (a.z + b.z) / 2)
      }
    }
    const hexId = event?.publicData?.hexId
    if (typeof hexId === 'string') {
      const tile = game.board.hexes.find((candidate) => candidate.id === hexId)
      if (tile) return new THREE.Vector3(tile.x, GROUND, tile.z)
    }
  }, [event, game.board])

  const actor = game.players.find((player) => player.id === (event?.playerId ?? game.players[0]?.id))
  const actorColor = actor ? PLAYER_COLORS[actor.color] : '#e8c07a'
  const longestRoad = presentation.awardChanges.some((change) => change.includes('Longest Road'))
  const largestArmy = presentation.awardChanges.some((change) => change.includes('Largest Army'))
  const victory = Boolean(game.winnerId)
  const type = presentation.actionType
  const dice = type === 'roll-dice' && game.lastRoll
  const desert = game.board.hexes.find((tile) => tile.terrain === 'desert')

  useEffect(() => {
    emitBeat({
      kind: beatFor(type, longestRoad || largestArmy, victory),
      revision: presentation.revision,
      at: at ? [at.x, at.z] : undefined,
    })
  }, [at, largestArmy, longestRoad, presentation.revision, type, victory])

  return <group>
    {dice ? <DiceRoll roll={game.lastRoll!} revision={presentation.revision} land={[desert?.x ?? 0, desert?.z ?? 0]} reducedMotion={reducedMotion} /> : null}
    {type === 'roll-dice' ? <ProductionEffects game={game} reducedMotion={reducedMotion} /> : null}
    {type === 'end-turn' ? <HandoffMoment game={game} reducedMotion={reducedMotion} /> : null}
    {at && (BUILD_ACTIONS.has(type) || type === 'build-city')
      ? <PlacementImpact id={`impact-${presentation.revision}`} at={at} heavy={type === 'build-city'} color={actorColor} reducedMotion={reducedMotion} />
      : null}
    {at && (type === 'move-robber' || type === 'steal-from')
      ? <RobberMoment id={`robber-${presentation.revision}`} at={at} reducedMotion={reducedMotion} />
      : null}
    {longestRoad && game.longestRoad
      ? <LongestRoadSweep game={game} playerId={game.longestRoad.playerId} color={PLAYER_COLORS[game.players.find((player) => player.id === game.longestRoad!.playerId)?.color ?? 'ivory']} reducedMotion={reducedMotion} />
      : null}
    {largestArmy && game.largestArmy
      ? <LargestArmyMoment game={game} color={PLAYER_COLORS[game.players.find((player) => player.id === game.largestArmy!.playerId)?.color ?? 'ivory']} reducedMotion={reducedMotion} />
      : null}
    {victory ? <VictoryMoment game={game} color={actorColor} reducedMotion={reducedMotion} /> : null}
  </group>
}

export function ActionEffects({ game, presentation, reducedMotion }: { game: GameDisplayState; presentation?: GamePresentation; reducedMotion: boolean }) {
  // `?motion=<beat>` on the visual-QA route replays one beat on a loop. Inert
  // without the parameter, so real games are untouched.
  const demo = useMotionDemo(game)
  const state = presentation ? game : demo.game
  const moment = presentation ?? demo.presentation
  return <group>
    <AmbientLife game={state} reducedMotion={reducedMotion} />
    {moment
      ? <ActionMoment key={moment.revision} game={state} presentation={moment} reducedMotion={reducedMotion} />
      : null}
  </group>
}
