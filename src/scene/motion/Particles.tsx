import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { easeOutCubic, easeOutQuart, easeOutQuint, saturate, scaled, seededFrom } from './spring'

// Every emitter here is a single InstancedMesh so a burst costs one draw call,
// and every particle's direction comes from a seed derived from a board id —
// the same event always throws the same debris.
//
// Reduced motion, stated once for the whole file: a decorative transient does
// not render at all. It does not render frozen. A ring stopped at t=0 is not a
// calmer animation, it is a permanent mark on the board that never clears, and
// a match's worth of them stacks up into clutter for exactly the people who
// asked for less. Effects that carry information — which tiles produced, what
// the dice show — live in `ActionEffects` and `Dice`; those present their end
// state immediately and clear on the schedule they always would have.

type BurstProps = {
  /** Stable id: same id, same scatter, every time. */
  id: string
  origin: [number, number, number]
  count: number
  color: string
  emissive?: string
  /** Metres per second at t=0. */
  speed: number
  /** 0 = straight up, 1 = flat ring. */
  spread: number
  gravity?: number
  drag?: number
  life: number
  size: number
  /** 'dust' shrinks as it fades, 'debris' tumbles and keeps its size. */
  shape?: 'dust' | 'debris'
  /** Hold fire until the thing that kicks up the dust actually lands. */
  delay?: number
  reducedMotion: boolean
}

export function Burst({ id, origin, count, color, emissive, speed, spread, gravity = 6.2, drag = 3.4, life, size, shape = 'dust', delay = 0, reducedMotion }: BurstProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const started = useRef<number | undefined>(undefined)

  const seeds = useMemo(() => {
    const random = seededFrom(id)
    return Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2
      const lift = 1 - random() * spread
      const planar = Math.sqrt(Math.max(0, 1 - lift * lift))
      return {
        direction: new THREE.Vector3(Math.cos(angle) * planar, lift, Math.sin(angle) * planar),
        speed: speed * (0.55 + random() * 0.75),
        size: size * (0.6 + random() * 0.8),
        spin: (random() - 0.5) * 14,
        axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
        delay: random() * 0.06,
      }
    })
  }, [count, id, size, speed, spread])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current) - delay
    if (elapsed < 0 || elapsed > life) { instanced.visible = false; return }
    instanced.visible = true
    const fade = 1 - saturate(elapsed / life)
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index]
      const t = Math.max(0, elapsed - seed.delay)
      // Closed-form ballistic with linear drag — stable at any frame rate.
      const travel = (1 - Math.exp(-drag * t)) / drag
      dummy.position.set(
        origin[0] + seed.direction.x * seed.speed * travel,
        origin[1] + seed.direction.y * seed.speed * travel - 0.5 * gravity * t * t,
        origin[2] + seed.direction.z * seed.speed * travel,
      )
      if (dummy.position.y < origin[1]) dummy.position.y = origin[1] + (origin[1] - dummy.position.y) * 0.18
      if (shape === 'debris') dummy.quaternion.setFromAxisAngle(seed.axis, seed.spin * t)
      else dummy.quaternion.identity()
      const grow = shape === 'dust' ? 0.4 + easeOutQuart(saturate(t * 4)) * 0.9 : 1
      dummy.scale.setScalar(seed.size * grow * (shape === 'dust' ? fade ** 0.7 : 1))
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
    const material = instanced.material as THREE.MeshStandardMaterial
    material.opacity = shape === 'dust' ? fade * 0.72 : easeOutCubic(fade)
  })

  if (reducedMotion) return null
  return <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
    {shape === 'dust'
      ? <icosahedronGeometry args={[1, 1]} />
      : <tetrahedronGeometry args={[1, 0]} />}
    <meshStandardMaterial
      color={color}
      emissive={emissive ?? color}
      emissiveIntensity={shape === 'dust' ? 0.12 : 0.3}
      roughness={0.94}
      flatShading
      transparent
      depthWrite={false}
      opacity={0.7}
    />
  </instancedMesh>
}

type ShockwaveProps = {
  origin: [number, number, number]
  color: string
  radius: number
  life: number
  thickness?: number
  delay?: number
  reducedMotion: boolean
}

/** Ground ring that snaps outward and dies. The read on an impact. */
export function Shockwave({ origin, color, radius, life, thickness = 0.1, delay = 0, reducedMotion }: ShockwaveProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const started = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    const ring = mesh.current
    if (!ring) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current) - delay
    if (elapsed < 0 || elapsed > life) { ring.visible = false; return }
    ring.visible = true
    const t = saturate(elapsed / life)
    ring.scale.setScalar(0.12 + easeOutQuint(t) * radius)
    ;(ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) ** 1.7 * 0.85
  })
  if (reducedMotion) return null
  return <mesh ref={mesh} position={origin} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
    <ringGeometry args={[1 - thickness, 1, 48]} />
    <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
  </mesh>
}

/** Soft additive flare — a light flash without adding a light. */
export function Flare({ origin, color, size, life, delay = 0, reducedMotion }: { origin: [number, number, number]; color: string; size: number; life: number; delay?: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.Sprite>(null)
  const started = useRef<number | undefined>(undefined)
  const texture = useFlareTexture()
  useFrame(({ clock }) => {
    const sprite = mesh.current
    if (!sprite) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current) - delay
    if (elapsed < 0 || elapsed > life) { sprite.visible = false; return }
    sprite.visible = true
    const t = saturate(elapsed / life)
    sprite.scale.setScalar(size * (0.35 + easeOutQuart(t) * 0.9))
    sprite.material.opacity = (1 - t) ** 2.4 * 0.9
  })
  if (reducedMotion) return null
  return <sprite ref={mesh} position={origin} renderOrder={3}>
    <spriteMaterial map={texture} color={color} transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
  </sprite>
}

let flareTexture: THREE.Texture | undefined

export function useFlareTexture() {
  return useMemo(() => {
    if (flareTexture) return flareTexture
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')!
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.12)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    flareTexture = new THREE.CanvasTexture(canvas)
    flareTexture.colorSpace = THREE.SRGBColorSpace
    return flareTexture
  }, [])
}

/** Slow upward drift — victory motes, chimney smoke, dust hanging in the light. */
export function Motes({ id, origin, count, color, spread, rise, life, size, reducedMotion, opacity = 0.5 }: {
  id: string
  origin: [number, number, number]
  count: number
  color: string
  spread: number
  rise: number
  life: number
  size: number
  reducedMotion: boolean
  opacity?: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const started = useRef<number | undefined>(undefined)
  const seeds = useMemo(() => {
    const random = seededFrom(id)
    return Array.from({ length: count }, () => ({
      angle: random() * Math.PI * 2,
      radius: Math.sqrt(random()) * spread,
      rise: rise * (0.6 + random() * 0.8),
      size: size * (0.5 + random() * 0.9),
      phase: random(),
      sway: 0.5 + random(),
    }))
  }, [count, id, rise, size, spread])

  useFrame(({ clock }) => {
    const instanced = mesh.current
    if (!instanced) return
    started.current ??= clock.elapsedTime
    const elapsed = scaled(clock.elapsedTime - started.current)
    if (elapsed > life) { instanced.visible = false; return }
    instanced.visible = true
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index]
      const t = saturate((elapsed / life) * 1.35 - seed.phase * 0.35)
      const climb = easeOutCubic(t) * seed.rise
      dummy.position.set(
        origin[0] + Math.cos(seed.angle) * seed.radius + Math.sin(elapsed * seed.sway + seed.phase * 9) * 0.08,
        origin[1] + climb,
        origin[2] + Math.sin(seed.angle) * seed.radius + Math.cos(elapsed * seed.sway * 0.8 + seed.phase * 5) * 0.08,
      )
      dummy.rotation.set(0, elapsed * seed.sway, elapsed * 0.6)
      dummy.scale.setScalar(seed.size * Math.sin(Math.min(1, t) * Math.PI) ** 0.6)
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
    ;(instanced.material as THREE.MeshBasicMaterial).opacity = opacity * (1 - saturate((elapsed - life * 0.7) / (life * 0.3)))
  })

  if (reducedMotion) return null
  return <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
    <octahedronGeometry args={[1, 0]} />
    <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
  </instancedMesh>
}
