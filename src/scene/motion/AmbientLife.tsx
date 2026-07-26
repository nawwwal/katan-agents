import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameDisplayState } from '../../game/types'
import { seededFrom } from './spring'

// Ambient motion: the difference between a board and a place. Everything in
// here is instanced (one draw call per system), seeded from stable ids, and
// silent under `prefers-reduced-motion`.

const GROUND = 0.478
/** One wind for the whole island, so smoke, leaves and clouds agree. */
const WIND = new THREE.Vector2(0.86, 0.51).normalize()

/** Smooth 1 -> 0 as something drifts off the island footprint. */
const inland = (x: number, z: number, radius: number) => {
  const distance = Math.hypot(x, z)
  return THREE.MathUtils.smoothstep(radius - distance, 0, 1.5)
}

// ------------------------------------------------------------------ gulls

const wingGeometry = () => {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0.5, 0, 0)
  return geometry
}

export function Gulls({ count = 7, reducedMotion }: { count?: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(wingGeometry, [])
  const body = useMemo(() => new THREE.Object3D(), [])
  const wing = useMemo(() => new THREE.Object3D(), [])
  const matrix = useMemo(() => new THREE.Matrix4(), [])

  const birds = useMemo(() => {
    const random = seededFrom('katan-gulls')
    return Array.from({ length: count }, () => ({
      rx: 4.2 + random() * 3.4,
      rz: 3.4 + random() * 3.0,
      height: 2.6 + random() * 2.6,
      speed: (0.055 + random() * 0.05) * (random() > 0.72 ? -1 : 1),
      phase: random() * Math.PI * 2,
      flap: 5.4 + random() * 3.2,
      // Small enough to read as a bird at altitude, not as litter on the lens.
      span: 0.062 + random() * 0.03,
      tilt: (random() - 0.5) * 0.5,
    }))
  }, [count])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced) return
    if (reducedMotion) { instanced.visible = false; return }
    instanced.visible = true
    const time = clock.elapsedTime
    for (let index = 0; index < birds.length; index += 1) {
      const bird = birds[index]
      const angle = bird.phase + time * bird.speed * Math.PI * 2
      const x = Math.cos(angle) * bird.rx
      const z = Math.sin(angle) * bird.rz
      const y = bird.height + Math.sin(angle * 1.7 + bird.phase) * 0.34
      // Heading from the analytic tangent of the ellipse.
      const heading = Math.atan2(-Math.sin(angle) * bird.rx * bird.speed, Math.cos(angle) * bird.rz * bird.speed)
      const flap = Math.sin(time * bird.flap + bird.phase) * 0.55 + 0.16
      body.position.set(x, y, z)
      body.rotation.set(0, heading, bird.tilt * Math.sin(angle * 0.9))
      body.updateMatrix()
      for (let side = 0; side < 2; side += 1) {
        const mirror = side === 0 ? 1 : -1
        wing.position.set(0, 0, 0)
        wing.rotation.set(0, 0, flap * mirror)
        wing.scale.set(bird.span * mirror, 1, bird.span * 0.34)
        wing.updateMatrix()
        matrix.multiplyMatrices(body.matrix, wing.matrix)
        instanced.setMatrixAt(index * 2 + side, matrix)
      }
    }
    instanced.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, undefined, count * 2]} frustumCulled={false}>
    <meshStandardMaterial color="#dfe7ec" roughness={0.9} side={THREE.DoubleSide} />
  </instancedMesh>
}

// ---------------------------------------------------------- chimney smoke

export function ChimneySmoke({ game, reducedMotion }: { game: GameDisplayState; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const puffs = useMemo(() => Object.entries(game.buildings).flatMap(([vertexId, building]) => {
    const vertex = game.board.vertices[vertexId]
    if (!vertex) return []
    const random = seededFrom(`smoke-${vertexId}`)
    const top = GROUND + (building.type === 'city' ? 0.44 : 0.33)
    return Array.from({ length: 4 }, (_, index) => ({
      x: vertex.x + (random() - 0.5) * 0.1,
      y: top,
      z: vertex.z + (random() - 0.5) * 0.1,
      phase: (index + random() * 0.6) / 4,
      period: 3.4 + random() * 1.6,
      size: 0.055 + random() * 0.04,
      rise: 0.7 + random() * 0.45,
    }))
  }), [game.board.vertices, game.buildings])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced || !puffs.length) return
    const time = clock.elapsedTime
    for (let index = 0; index < puffs.length; index += 1) {
      const puff = puffs[index]
      // Reduced motion parks each puff at a fixed point in its own cycle, so
      // the plume is still there but nothing moves.
      const t = reducedMotion ? puff.phase : ((time / puff.period) + puff.phase) % 1
      const climb = t * puff.rise
      dummy.position.set(
        puff.x + WIND.x * climb * 0.75,
        puff.y + climb,
        puff.z + WIND.y * climb * 0.75,
      )
      dummy.rotation.set(0, t * 2.4, 0)
      dummy.scale.setScalar(puff.size * (0.35 + t * 2.6) * Math.sin(Math.min(1, t * 1.12) * Math.PI) ** 0.45)
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
  })

  if (!puffs.length) return null
  return <instancedMesh ref={mesh} args={[undefined, undefined, puffs.length]} frustumCulled={false} renderOrder={1}>
    <icosahedronGeometry args={[1, 1]} />
    <meshStandardMaterial color="#dcd7cf" roughness={1} transparent opacity={0.15} depthWrite={false} />
  </instancedMesh>
}

// Cloud shadows used to live here as drifting alpha planes. They were cut:
// the turf line sits at y 0.46 but terrain props, trees and mountains stand
// far above it, so a ground-hugging plane is buried and a raised one hovers.
// Doing this properly means projecting a cloud texture through the key light
// or a screen-space pass — that belongs to whoever owns `Lighting.tsx`.

// ------------------------------------------------------------------- wind

/**
 * Leaves and seed fluff running downwind across the island. The authored trees
 * are static geometry we do not own, so the wind is shown by what it carries.
 */
export function WindDrift({ game, count = 46, reducedMotion }: { game: GameDisplayState; count?: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const motes = useMemo(() => {
    const random = seededFrom('katan-wind')
    const leafy = game.board.hexes.filter((hex) => hex.terrain === 'lumber' || hex.terrain === 'wool' || hex.terrain === 'grain')
    return Array.from({ length: count }, (_, index) => {
      const home = leafy.length ? leafy[index % leafy.length] : undefined
      return {
        offset: random() * 12,
        cross: (home?.x ?? 0) * WIND.y * -1 + (home?.z ?? 0) * WIND.x + (random() - 0.5) * 1.1,
        height: GROUND + 0.06 + random() * 0.55,
        speed: 0.85 + random() * 0.7,
        size: 0.016 + random() * 0.016,
        bob: random() * Math.PI * 2,
        spin: 2 + random() * 5,
        warm: random() > 0.55,
      }
    })
  }, [count, game.board.hexes])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced) return
    if (reducedMotion) { instanced.visible = false; return }
    instanced.visible = true
    const time = clock.elapsedTime
    for (let index = 0; index < motes.length; index += 1) {
      const mote = motes[index]
      const along = ((mote.offset + time * mote.speed) % 12) - 6
      const x = WIND.x * along - WIND.y * mote.cross
      const z = WIND.y * along + WIND.x * mote.cross
      const presence = inland(x, z, 4.1)
      dummy.position.set(x, mote.height + Math.sin(time * 1.7 + mote.bob) * 0.09, z)
      dummy.rotation.set(time * mote.spin * 0.5, time * mote.spin, mote.bob)
      dummy.scale.setScalar(mote.size * presence)
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
    <tetrahedronGeometry args={[1, 0]} />
    <meshStandardMaterial color="#cfe0a4" roughness={1} transparent opacity={0.85} flatShading />
  </instancedMesh>
}

export function AmbientLife({ game, reducedMotion }: { game: GameDisplayState; reducedMotion: boolean }) {
  return <group>
    <WindDrift game={game} reducedMotion={reducedMotion} />
    <ChimneySmoke game={game} reducedMotion={reducedMotion} />
    <Gulls reducedMotion={reducedMotion} />
  </group>
}
