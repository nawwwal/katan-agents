import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { emitShake } from './beats'
import { easeInQuad, easeOutBack, easeOutCubic, saturate, seededFrom } from './spring'

// Arrival physics for board pieces.
//
// Not owned by this file's author's scope today: `Pieces.tsx` still damps a
// scale from 0.08 to 1. This hook is the drop-in replacement — see the handoff
// note in the motion report. It is kept here so the timing lives with the rest
// of the motion system rather than being re-invented in the piece components.

type Kind = 'settlement' | 'city' | 'road'

type Phase = {
  /** Wind-up: the piece lifts and tilts back before it falls. */
  anticipate: number
  /** Fall time from apex to contact. */
  drop: number
  /** Squash and rebound after contact. */
  settle: number
  /** Apex height above the resting position. */
  height: number
  squash: number
}

const PHASES: Record<Kind, Phase> = {
  settlement: { anticipate: 0.13, drop: 0.24, settle: 0.42, height: 0.9, squash: 0.24 },
  city: { anticipate: 0.17, drop: 0.28, settle: 0.5, height: 1.15, squash: 0.28 },
  road: { anticipate: 0.1, drop: 0.18, settle: 0.34, height: 0.42, squash: 0.14 },
}

export type PlacementDrop = {
  /** 0 before contact, 1 the frame it lands, decaying after. */
  impact: number
  done: boolean
}

/**
 * Drives a piece group through anticipation, drop, impact and settle.
 *
 * Roads are handled differently: instead of scaling up in place they hinge
 * down along their own edge, so a road lays itself rather than inflating.
 */
export function usePlacementDrop(
  group: RefObject<THREE.Group | null>,
  { id, kind, reducedMotion, onImpact }: { id: string; kind: Kind; reducedMotion: boolean; onImpact?: () => void },
) {
  const phase = PHASES[kind]
  const started = useRef<number | undefined>(undefined)
  const landed = useRef(false)
  const seed = useMemo(() => {
    const random = seededFrom(`${kind}-${id}`)
    return { yaw: (random() - 0.5) * 0.5, tilt: (random() - 0.5) * 0.32, side: random() > 0.5 ? 1 : -1 }
  }, [id, kind])

  useFrame(({ clock }) => {
    const node = group.current
    if (!node) return
    if (reducedMotion) {
      node.position.y = 0
      node.rotation.set(0, 0, 0)
      node.scale.set(1, 1, 1)
      return
    }
    started.current ??= clock.elapsedTime
    const elapsed = clock.elapsedTime - started.current
    const total = phase.anticipate + phase.drop + phase.settle
    if (elapsed >= total) {
      node.position.y = 0
      node.rotation.set(0, 0, 0)
      node.scale.set(1, 1, 1)
      return
    }

    if (elapsed < phase.anticipate) {
      // Rise and lean back. The eye reads the lift as intent.
      const t = easeOutCubic(elapsed / phase.anticipate)
      node.position.y = phase.height * t
      node.scale.setScalar(0.86 + 0.16 * t)
      if (kind === 'road') node.rotation.set(0, 0, seed.side * 0.9 * t)
      else node.rotation.set(seed.tilt * t, seed.yaw * t, 0)
      return
    }

    if (elapsed < phase.anticipate + phase.drop) {
      const t = easeInQuad((elapsed - phase.anticipate) / phase.drop)
      node.position.y = phase.height * (1 - t)
      node.scale.setScalar(1.02 - 0.02 * t)
      if (kind === 'road') node.rotation.set(0, 0, seed.side * 0.9 * (1 - t))
      else node.rotation.set(seed.tilt * (1 - t), seed.yaw * (1 - t), 0)
      return
    }

    if (!landed.current) {
      landed.current = true
      emitShake(kind === 'city' ? 0.16 : kind === 'settlement' ? 0.12 : 0.07)
      onImpact?.()
    }

    // Squash on contact, then an overshooting rebound that dies quickly.
    const t = saturate((elapsed - phase.anticipate - phase.drop) / phase.settle)
    const squash = (1 - t) ** 2 * phase.squash * Math.cos(t * 13)
    node.position.y = 0
    node.rotation.set(0, 0, 0)
    node.scale.set(1 + squash * 0.55, 1 - squash, 1 + squash * 0.55)
    if (t > 0.35) node.scale.multiplyScalar(easeOutBack(saturate((t - 0.35) / 0.65)) * 0.02 + 0.98)
  })
}
