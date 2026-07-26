import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { DiceRoll } from './Dice'
import { diceThrowPlan } from './diceThrow'

// Visual-QA-only stage for the dice, in the spirit of `pieces-lab.html`.
//
// The roll is 0.3 board units across and lands somewhere on a 20-unit island,
// so at the framing the game actually plays in a die is about fifty pixels
// tall. That is enough to check that a roll happened and nowhere near enough
// to grade a teeter, which is where the whole feel of the throw lives. This
// route puts one throw on a bare table at reading distance.
//
//   /dice-lab.html?roll=3-5          force a value
//   /dice-lab.html?motionSpeed=0.25  slow the effect clock
//   /dice-lab.html?scrub=1           freeze the clock; window.__diceTime = 0.42
//   window.__diceNext()              throw again
//   window.__dicePlan()              the planned contact list

const parseRoll = (raw: string | null): [number, number] => {
  const parts = (raw ?? '').split(/[-,]/).map(Number)
  const clamp = (value: number) => (Number.isFinite(value) ? Math.min(6, Math.max(1, Math.round(value))) : 0)
  return [clamp(parts[0]) || 4, clamp(parts[1]) || 2]
}

/**
 * Pins the effect clock to `window.__diceTime`.
 *
 * Motion cannot be graded from stills taken whenever the screenshot tool got
 * around to it — the spacing between frames *is* the easing. With the clock
 * pinned, a burst is a set of exact times rather than a set of guesses.
 */
function Scrub() {
  const invalidate = useThree((state) => state.invalidate)
  const base = useRef<number | undefined>(undefined)
  useFrame(({ clock }) => {
    const host = globalThis as unknown as { __diceTime?: number }
    base.current ??= clock.elapsedTime
    if (typeof host.__diceTime === 'number') clock.elapsedTime = base.current + host.__diceTime
    invalidate()
  })
  return null
}

/** The default canvas camera stares at the origin; the throw needs headroom. */
function Frame({ at }: { at: [number, number, number] }) {
  const camera = useThree((state) => state.camera)
  useEffect(() => { camera.lookAt(at[0], at[1], at[2]) }, [at, camera])
  return null
}

export function DiceLab() {
  const params = new URLSearchParams(window.location.search)
  const roll = parseRoll(params.get('roll'))
  const reducedMotion = params.get('reduced') === '1'
  const scrub = params.get('scrub') === '1'
  // `?close=1` frames the settle; the default frames the whole throw.
  const close = params.get('close') === '1'
  // `?top=1` looks straight down, to read the settled faces off a still.
  const top = params.get('top') === '1'
  const [revision, setRevision] = useState(Number(params.get('revision') ?? 1))

  useEffect(() => {
    const host = globalThis as unknown as { __diceNext?: () => void; __dicePlan?: unknown }
    host.__diceNext = () => setRevision((value) => value + 1)
    ;(host as { __diceTime?: number }).__diceTime ??= 0
    host.__dicePlan = () => {
      const plan = diceThrowPlan(roll, revision, 0)
      return {
        duration: plan.duration,
        rawDuration: plan.rawDuration,
        timeScale: plan.timeScale,
        contacts: plan.contacts.map((contact) => [Number(contact.time.toFixed(3)), contact.die, contact.kind, Number(contact.strength.toFixed(2))]),
      }
    }
  }, [revision, roll])

  return <div style={{ position: 'fixed', inset: 0, background: '#0d0f14' }}>
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: top ? [0, 3.6, 0.001] : close ? [0.5, 1.62, 1.85] : [2.3, 3.0, 5.3], fov: top ? 42 : close ? 30 : 34 }}
      gl={{ antialias: true }}
    >
      {scrub ? <Scrub /> : null}
      <Frame at={top || close ? [0, 0.62, 0] : [0, 1.0, 0.7]} />
      <color attach="background" args={['#12161d']} />
      <hemisphereLight args={['#cfe0f0', '#3a3026', 0.55]} />
      <directionalLight
        position={[2.6, 4.4, 2.2]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0005}
      />
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#b9a37e" roughness={0.95} />
      </mesh>
      <group key={revision}>
        <DiceRoll roll={roll} revision={revision} land={[0, 0]} reducedMotion={reducedMotion} />
      </group>
    </Canvas>
    <div style={{ position: 'absolute', left: 14, bottom: 12, color: '#8b93a1', font: '12px ui-monospace, monospace' }}>
      roll {roll[0]}-{roll[1]} · revision {revision}
    </div>
  </div>
}
