import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { onRobberRefused, refuseRobber, robberPose, setRobberPose, useRobberPose } from '../motion/robber'
import { clampDelta, MOTION_SPEED, setSpring, spring, stepSpring } from '../motion/spring'
import {
  AURA_RADIUS,
  ROBBER_MARK,
  ROBBER_PERIOD,
  frameMaterial,
  robberAuraBandGeometry,
  robberAuraGeometry,
} from './Beacon'
import { RobberFigure } from './Robber'
import { haloTexture } from './textures'

// ---------------------------------------------------------------------------
// The robber, and the three ways to move it.
//
// The client asked for an aura and a halo so he would know the piece can be
// dragged. That is right, and it is also incomplete: an aura that says "pick me
// up" has to be attached to something a finger, a mouse and a keyboard can all
// actually pick up, or it is a promise the board does not keep. `motion/robber.ts`
// holds the state. This file is the only thing that touches it with a pointer.
//
// Three decisions worth stating.
//
// The piece is no longer a child of its tile. It was, and that was fine while
// it never moved, but a dragged robber has to live in board space rather than
// in the space of the hex it is leaving. Its ground halo stays behind on the
// origin hex, and that is what tells the player where the piece came from while
// the figure itself is following their finger.
//
// The drag does its own ray maths against the board plane rather than leaning
// on react-three-fiber's pointer capture. Capture semantics for a pointer that
// has left the mesh it started on are the sort of thing that works until a
// version bump, and this whole gesture depends on still receiving moves out
// over the water. Native listeners on the canvas plus a plane intersection is a
// shorter story with fewer places to be wrong.
//
// Six pixels of slop separates a tap from a drag. Under that the gesture is a
// tap and it arms the piece so the player can then tap a hex; over it, the
// piece is in hand. Both paths end at the same commit, which is the entire
// point of keeping the machine in one module.
// ---------------------------------------------------------------------------

/** Pointer travel, in CSS pixels, before a tap becomes a drag. */
const SLOP = 6

/** How high the piece rides while it is in hand. */
const CARRY_LIFT = 0.35
/** And while it is merely lit: standing up, not vibrating. */
const CALLED_LIFT = 0.09

/** A drop only counts inside this much of a legal hex centre, in board units. */
const CATCH_RADIUS = 0.92

/**
 * How high the piece stands above the tile plane, and therefore where its halo
 * has to sit.
 *
 * The figure has always been lifted clear of the tile plane so it clears the
 * dune and scree relief authored into the terrain. The halo did not know that,
 * and a ring drawn at the tile plane came back completely buried under the
 * desert it was meant to be marking — which is the funniest possible version of
 * the bug the aura exists to fix, since the whole complaint was that the robber
 * could not be found.
 */
const STAND_Y = 0.17

export type RobberTarget = { hexId: string; x: number; z: number }

type Props = {
  /** Board-space position of the hex the robber currently stands on. */
  home: [number, number, number]
  /** Which hex that is, so a refusal knows where home was. */
  homeHexId: string
  /** Every hex the server says the piece may be moved to. */
  targets: RobberTarget[]
  /** The phase is open, this seat is the actor, and a new action would be taken. */
  armable: boolean
  /** A commit is in flight. The piece holds where it was dropped. */
  sending: boolean
  reducedMotion: boolean
  onCommit: (hexId: string) => void
}

export function RobberHandle({ home, homeHexId, targets, armable, sending, reducedMotion, onCommit }: Props) {
  const { camera, gl } = useThree()
  const controls = useThree((state) => state.controls) as { enabled?: boolean } | null
  const pose = useRobberPose()

  const anchor = useRef<THREE.Group>(null)
  const piece = useRef<THREE.Group>(null)
  const band = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Mesh>(null)

  const lift = useRef(spring(0))
  const shake = useRef(spring(0))
  const glide = useRef(new THREE.Vector3(...home))
  const settled = useRef(false)

  // Everything the pointer listeners need, kept in a ref so they can be
  // registered once instead of torn down and rebuilt on every render.
  const live = useRef({ controls, homeHexId, targets, onCommit })
  live.current = { controls, homeHexId, targets, onCommit }

  const homeKey = home.join()
  useEffect(() => {
    // The server moved the piece. That is somebody else's gesture, or the
    // rebound of this one, and either way it should arrive rather than glide
    // across the board from wherever the figure happened to be.
    settled.current = false
  }, [homeKey])

  // The phase closing has to reach the machine from somewhere, and a component
  // that stops being armable is the earliest honest signal. It covers every way
  // the phase can end: a commit, a rival acting, a dropped connection.
  useEffect(() => {
    if (armable) {
      if (robberPose().stage === 'idle') setRobberPose({ stage: 'called', originHexId: homeHexId })
      return
    }
    if (robberPose().stage !== 'idle') setRobberPose({ stage: 'idle', held: undefined, candidateHexId: undefined, originHexId: undefined })
  }, [armable, homeHexId])

  // The round trip, both ways.
  //
  // Going out is easy. Coming back is the interesting half, because a commit
  // that succeeds and a commit that is refused both end with `sending` false,
  // and the board has to tell them apart without asking the server a second
  // question. A success moves the piece, so the home hex changes; a refusal
  // leaves it exactly where it was with the phase still open. The drag has
  // already visually committed by then, so a refusal has to be walked back out
  // loud rather than quietly.
  const wasSending = useRef(false)
  useEffect(() => {
    const stage = robberPose().stage
    if (sending) {
      if (stage !== 'idle') setRobberPose({ stage: 'sending', held: undefined })
    } else if (wasSending.current && stage === 'sending' && armable) {
      refuseRobber()
      setRobberPose({ stage: 'called', held: undefined, candidateHexId: undefined })
    }
    wasSending.current = sending
  }, [sending, armable, homeHexId])

  useEffect(() => onRobberRefused(() => {
    if (!reducedMotion) shake.current.velocity += 5.4
  }), [reducedMotion])

  // ------------------------------------------------------------------ input

  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)

  const beginDrag = (event: ReactPointerEvent) => {
    if (!armable || sending) return
    event.stopPropagation()
    const native = event.nativeEvent
    drag.current = { id: native.pointerId, x: native.clientX, y: native.clientY, moved: false }
    // MapControls listens on the canvas and would happily pan the island out
    // from under the gesture. Suppress it for the duration and restore it from
    // every exit, including `pointercancel`, which iOS fires on a system swipe.
    if (live.current.controls) live.current.controls.enabled = false
    try { gl.domElement.setPointerCapture(native.pointerId) } catch { /* pointer already gone */ }
  }

  useEffect(() => {
    const element = gl.domElement
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()

    const boardPoint = (clientX: number, clientY: number) => {
      const group = anchor.current
      if (!group) return null
      const rect = element.getBoundingClientRect()
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      // The plane sits at the piece plane rather than at zero, so the point
      // under the cursor is the point the piece would be standing on.
      plane.constant = -(group.getWorldPosition(hit).y + home[1])
      return raycaster.ray.intersectPlane(plane, hit) ? group.worldToLocal(hit.clone()) : null
    }

    const candidateAt = (x: number, z: number) => {
      let best: string | undefined
      let bestDistance = CATCH_RADIUS * CATCH_RADIUS
      for (const target of live.current.targets) {
        const distance = (target.x - x) ** 2 + (target.z - z) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = target.hexId
        }
      }
      return best
    }

    const release = (pointerId: number) => {
      drag.current = null
      if (live.current.controls) live.current.controls.enabled = true
      try { element.releasePointerCapture(pointerId) } catch { /* already released */ }
    }

    const move = (event: PointerEvent) => {
      const state = drag.current
      if (!state || state.id !== event.pointerId) return
      if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < SLOP) return
      state.moved = true
      const point = boardPoint(event.clientX, event.clientY)
      if (!point) return
      setRobberPose({
        stage: 'dragging',
        originHexId: live.current.homeHexId,
        held: [point.x, point.z],
        candidateHexId: candidateAt(point.x, point.z),
      })
    }

    const up = (event: PointerEvent) => {
      const state = drag.current
      if (!state || state.id !== event.pointerId) return
      const dragged = state.moved
      release(event.pointerId)
      const current = robberPose()
      if (!dragged) {
        // A tap. It arms rather than commits, so the second tap picks the hex.
        // On a phone this is the dominant path and the drag is the delightful
        // one; both have to work or the gesture only works on a laptop.
        setRobberPose({ stage: current.stage === 'armed' ? 'called' : 'armed', originHexId: live.current.homeHexId, held: undefined, candidateHexId: undefined })
        return
      }
      if (current.candidateHexId) {
        setRobberPose({ stage: 'sending', held: undefined })
        live.current.onCommit(current.candidateHexId)
        return
      }
      // Water, the HUD, the hex it already stands on. The board said no by not
      // lighting up, so the answer is a shake and a spring home, not a dialog.
      refuseRobber()
      setRobberPose({ stage: 'called', held: undefined, candidateHexId: undefined })
    }

    const cancel = (event: PointerEvent) => {
      if (!drag.current || drag.current.id !== event.pointerId) return
      release(event.pointerId)
      setRobberPose({ stage: 'called', held: undefined, candidateHexId: undefined })
    }

    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const stage = robberPose().stage
      if (stage === 'idle' || stage === 'sending') return
      // There is nowhere to abandon *to* — the engine offers this seat nothing
      // else this phase — so escape returns to the lit call rather than
      // clearing it. The aura must not go out until the phase ends.
      if (drag.current) release(drag.current.id)
      setRobberPose({ stage: 'called', held: undefined, candidateHexId: undefined })
    }

    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [gl, camera, homeKey])

  // ----------------------------------------------------------------- motion

  const byId = useMemo(() => new Map(targets.map((target) => [target.hexId, target])), [targets])

  useFrame(({ clock }, delta) => {
    const group = piece.current
    if (!group) return
    const dt = clampDelta(delta)
    const now = robberPose()

    // Where the figure wants to be. A candidate under the cursor pulls it to
    // that hex centre, so the drop reads as landed before the finger is up.
    let targetX = home[0]
    let targetZ = home[2]
    if (now.held) {
      const snap = now.candidateHexId ? byId.get(now.candidateHexId) : undefined
      targetX = snap ? snap.x : now.held[0]
      targetZ = snap ? snap.z : now.held[1]
    }

    if (!settled.current || reducedMotion) {
      // Reduced motion keeps the drag tracking the finger exactly. What goes is
      // the easing, not the control.
      glide.current.set(targetX, home[1], targetZ)
      settled.current = true
    } else {
      // Fast enough to feel attached to the pointer, slow enough that the throw
      // to a dropped hex reads as travel rather than a cut.
      glide.current.lerp(new THREE.Vector3(targetX, home[1], targetZ), 1 - Math.exp(-16 * dt * MOTION_SPEED))
    }

    const carried = now.stage === 'dragging' || now.stage === 'armed'
    const liftTarget = reducedMotion ? 0 : carried ? CARRY_LIFT : now.stage === 'called' ? CALLED_LIFT : 0
    if (reducedMotion) setSpring(lift.current, liftTarget)
    else stepSpring(lift.current, liftTarget, 2.1, 0.72, dt)
    stepSpring(shake.current, 0, 3.4, 0.28, dt)

    // The arc: the extra hop the piece makes on its way to a hex it was thrown
    // at, proportional to how far it still has to travel.
    const travel = Math.hypot(glide.current.x - targetX, glide.current.z - targetZ)
    const arc = reducedMotion ? 0 : Math.min(0.22, travel * 0.5)

    group.position.set(
      glide.current.x + (reducedMotion ? 0 : shake.current.value * 0.15),
      glide.current.y + lift.current.value + arc,
      glide.current.z,
    )
    group.rotation.z = reducedMotion ? 0 : shake.current.value * 0.06 + (carried ? 0.14 : 0)
    // A slow yaw sway while the piece is only lit. It should read as a figure
    // shifting its weight, not as a thing vibrating for attention.
    group.rotation.y = reducedMotion || now.stage !== 'called' ? 0 : Math.sin(clock.elapsedTime * MOTION_SPEED * 0.9) * 0.07

    const mark = band.current
    if (!mark) return
    // At rest the halo breathes and says "this is movable, and here it is".
    // Once the piece is in hand the same ring stops breathing and becomes the
    // contact shadow, which is then the only thing still telling the player
    // where the robber currently stands.
    const pulse = reducedMotion || carried ? 1 : 0.5 - Math.cos(((clock.elapsedTime * MOTION_SPEED) / ROBBER_PERIOD) * Math.PI * 2) / 2
    const strength = now.stage === 'idle' ? 0 : now.stage === 'sending' ? 0.55 : carried ? 1 : 0.72 + pulse * 0.28
    const grow = carried ? 1.12 : 0.97 + pulse * 0.06
    mark.scale.set(grow, 1, grow)
    ;(mark.material as THREE.MeshBasicMaterial).color.set(ROBBER_MARK).multiplyScalar(strength)
    if (glow.current) {
      // The soft half breathes wider than the crisp one and drops away almost
      // entirely once the piece is in hand, where its job is done and the
      // contact shadow's job has started.
      const soft = carried ? 0.34 : strength * 1.25
      glow.current.scale.setScalar(carried ? 0.9 : 0.94 + pulse * 0.12)
      ;(glow.current.material as THREE.MeshBasicMaterial).opacity = soft
    }
  })

  const lit = pose.stage !== 'idle'

  return <group ref={anchor}>
    {/* The halo stays on the origin hex while the figure travels.

        Two marks, not one, and the pairing is the same one the rest of the
        board uses. The torus pair is the crisp half: a near-black ring with a
        bright band inlaid on it, which is what survives being read against pale
        sand. The soft disc over it is the aura the client actually described —
        additive, so it lifts whatever it lands on rather than painting over it,
        and wide enough to be findable at the resting camera, where the figure
        itself is about forty pixels of dark bronze on a dark island. */}
    <group position={[home[0], home[1] + STAND_Y + 0.012, home[2]]} visible={lit}>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} renderOrder={3}>
        <circleGeometry args={[AURA_RADIUS * 1.5, 40]} />
        <meshBasicMaterial
          color={ROBBER_MARK}
          alphaMap={haloTexture()}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={robberAuraGeometry()} material={frameMaterial()} receiveShadow />
      <mesh ref={band} geometry={robberAuraBandGeometry()}>
        <meshBasicMaterial color={ROBBER_MARK} toneMapped={false} />
      </mesh>
    </group>
    <group ref={piece} position={home}>
      <RobberFigure height={STAND_Y} />
      {/* An invisible grab volume, generously bigger than the figure, so the
          gesture does not require hitting a forty-pixel hood. It exists only
          while the piece is movable, or it would swallow clicks on the tile
          underneath for the rest of the match. */}
      {armable && !sending ? <mesh position={[0, 0.34, 0]} onPointerDown={beginDrag}>
        <sphereGeometry args={[AURA_RADIUS, 12, 10]} />
        <meshBasicMaterial visible={false} depthWrite={false} />
      </mesh> : null}
    </group>
  </group>
}
