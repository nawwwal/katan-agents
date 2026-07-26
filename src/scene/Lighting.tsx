import { useMemo } from 'react'
import * as THREE from 'three'
import { SUN_DIRECTION } from './Sky'

// The island plus its harbour ring is about 15 units across and a 38 degree
// sun stretches shadows a couple of units past that, so the frustum is 22.4
// units wide. At 2048 that is an 11mm shadow texel.
const SHADOW_EXTENT = 11.2
const KEY_DISTANCE = 19

/**
 * Golden hour is two lights, not one. There is hard warm sun, and there is a
 * very large cool source made of sky and water bouncing back up. The previous
 * pass only had the first: key 4.4 against 0.57 of everything else, so a
 * shadow interior sat near 6% of the lit value and read as a black hole. That
 * also makes the sun itself read weaker, because the eye judges "struck by
 * sunlight" from the difference between a lit face and a shaded one that it
 * can still see into.
 *
 * The ratio here is about 3.5:1 lit to shaded, which is roughly what an open
 * coastline actually measures. Shade is blue from sky and ocean, with a warm
 * upward bounce off the sand and dry grass, so it stays coloured rather than
 * just grey.
 */
export function Lighting({ mobile = false }: { mobile?: boolean }) {
  const keyPosition = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(KEY_DISTANCE), [])
  const rimPosition = useMemo(() => new THREE.Vector3(-SUN_DIRECTION.x, 0.22, -SUN_DIRECTION.z).normalize().multiplyScalar(16), [])
  // Ground bounce comes from below and slightly in front of the sun, the way
  // light skipping off open sand does.
  const bouncePosition = useMemo(() => new THREE.Vector3(SUN_DIRECTION.x * 0.6, -0.75, SUN_DIRECTION.z * 0.6).normalize().multiplyScalar(14), [])
  const shadowMap = mobile ? 1024 : 2048

  return <>
    {/* Key: golden afternoon sun. Everything else exists to keep its shadows legible. */}
    <directionalLight
      castShadow
      position={keyPosition}
      intensity={4.25}
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
    {/* Sky and ocean fill. This is the half of golden hour that was missing:
        a huge cool source that puts readable blue detail inside every shadow. */}
    <hemisphereLight color="#c4e0ff" groundColor="#2c6d80" intensity={0.95} />
    {/* Warm bounce off sand and dry grass, coming up from underneath so shaded
        undersides go amber instead of grey. */}
    <directionalLight position={bouncePosition} intensity={0.34} color="#ffb877" />
    {/* Rim: cool backlight so silhouettes cut away from the water. */}
    <directionalLight position={rimPosition} intensity={0.45} color="#9fd8f2" />
    {/* Floor so ambient occlusion has something to darken instead of crushing. */}
    <ambientLight intensity={0.16} color="#a8cadd" />
  </>
}
