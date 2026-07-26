import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SUN_DIRECTION } from './Sky'

// The island plus its harbour ring is about 15 units across, a 38 degree sun
// stretches a four-unit mountain five units past that, and the shadow now has
// to keep going until it lands on open water. 26 units wide covers all of it.
// At 2048 that is a 13mm shadow texel, which is still under a tenth of the
// width of a road.
const SHADOW_EXTENT = 13
const KEY_DISTANCE = 19

/**
 * Golden hour is two lights, not one. There is hard warm sun, and there is a
 * very large cool source made of sky and water bouncing back up. Shade has to
 * stay coloured and readable, because the eye judges "struck by sunlight" from
 * the difference between a lit face and a shaded one it can still see into.
 *
 * The fill budget is spent almost entirely through `scene.environment`, which
 * is a PMREM of the same physical sky the horizon shows. The lights here only
 * add what the probe cannot: a warm bounce from below and a cool rim, both too
 * directional to come out of an environment map.
 *
 * The numbers were cut hard in the shadow fix. The old set -- hemisphere 0.95,
 * ambient 0.16, environment 0.8 -- delivered more unshadowed light than the sun
 * did, from every direction at once, which is what erased every cast shadow in
 * the scene. Lit to shaded now measures about 3:1, which is roughly what an
 * open coastline reads, and the shadow survives the tone curve.
 */
/**
 * How often the shadow map is redrawn.
 *
 * Redrawing it every frame costs a measured 6.7ms of a 26.7ms frame in the
 * production build at 1920x1200 -- a quarter of the budget spent redrawing a
 * depth buffer that, for a static sun over a board where nothing moves between
 * turns, is very nearly the same picture it was last frame. On a third of the
 * frames the mean drops to 20.0ms.
 *
 * Three frames of lag is about 60ms. That is invisible on a settlement
 * dropping into place and would only be noticeable on something moving fast
 * and close to the ground, which this scene does not have. Turning it off
 * entirely was measured too and saved almost nothing more, so the shadows stay
 * live rather than freezing and going stale behind a newly placed piece.
 */
const SHADOW_UPDATE_EVERY = 3

function ShadowCadence() {
  const gl = useThree((three) => three.gl)
  const frame = useRef(0)

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
      gl.shadowMap.needsUpdate = true
    }
  }, [gl])

  // Default priority, so this runs before the effect composer's render at
  // priority 1. Three clears the flag itself once the map has been drawn.
  useFrame(() => {
    frame.current = (frame.current + 1) % SHADOW_UPDATE_EVERY
    gl.shadowMap.needsUpdate = frame.current === 0
  })

  return null
}

export function Lighting({ mobile = false }: { mobile?: boolean }) {
  const keyPosition = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(KEY_DISTANCE), [])
  const rimPosition = useMemo(() => new THREE.Vector3(-SUN_DIRECTION.x, 0.22, -SUN_DIRECTION.z).normalize().multiplyScalar(16), [])
  // Ground bounce comes from below and slightly in front of the sun, the way
  // light skipping off open sand does.
  const bouncePosition = useMemo(() => new THREE.Vector3(SUN_DIRECTION.x * 0.6, -0.75, SUN_DIRECTION.z * 0.6).normalize().multiplyScalar(14), [])
  const shadowMap = mobile ? 1024 : 2048

  return <>
    <ShadowCadence />
    {/* Key: golden afternoon sun. Everything else exists to keep its shadows legible. */}
    <directionalLight
      castShadow
      position={keyPosition}
      intensity={4.6}
      color="#ffd9ab"
      shadow-mapSize-width={shadowMap}
      shadow-mapSize-height={shadowMap}
      shadow-camera-near={KEY_DISTANCE - 14}
      shadow-camera-far={KEY_DISTANCE + 16}
      shadow-camera-left={-SHADOW_EXTENT}
      shadow-camera-right={SHADOW_EXTENT}
      shadow-camera-top={SHADOW_EXTENT}
      shadow-camera-bottom={-SHADOW_EXTENT}
      shadow-bias={-0.00016}
      shadow-normalBias={0.018}
    />
    {/* Sky and ocean fill, on top of the environment probe rather than instead
        of it. Small on purpose: the probe already carries the bulk of the cool
        skylight, and doubling it here is what flattened the board. */}
    <hemisphereLight color="#c4e0ff" groundColor="#2c6d80" intensity={0.5} />
    {/* Warm bounce off sand and dry grass, coming up from underneath so shaded
        undersides go amber instead of grey. */}
    <directionalLight position={bouncePosition} intensity={0.22} color="#ffb877" />
    {/* Rim: cool backlight so silhouettes cut away from the water. */}
    <directionalLight position={rimPosition} intensity={0.32} color="#9fd8f2" />
    {/* Floor so ambient occlusion has something to darken instead of crushing. */}
    <ambientLight intensity={0.12} color="#a8cadd" />
  </>
}
