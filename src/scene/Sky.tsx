import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Sky as SkyDome } from 'three/addons/objects/Sky.js'

// One golden-hour sun for the whole render pipeline: the sky shader, the key
// light, the shadow camera and the water glint all read from this vector.
// Elevation ~38 degrees, azimuth over the camera's left shoulder so shadows
// fall to the right-front of the board and every silhouette stays readable.
export const SUN_DIRECTION = new THREE.Vector3(-0.640, 0.616, 0.461).normalize()

/** Warm horizon band. Drives distance haze and the low half of the sky. */
export const HAZE_LOW = new THREE.Color('#6d93a8')
/** Cool upper atmosphere. Drives haze on the far ocean. */
export const HAZE_HIGH = new THREE.Color('#17456a')
/** Ocean colour fed back into the environment map as bounce light. */
export const OCEAN_BOUNCE = new THREE.Color('#0d3f52')

const SEA_HORIZON = new THREE.Color('#74a6ba')
const SEA_DEEP = new THREE.Color('#14526f')

// three's Sky is only defined above the horizon; below it the analytic model
// washes out to pale grey. Blend the lower half into open ocean so the dome
// gives a real horizon line wherever the water plane runs out.
const seaPatch = /* glsl */`
  float belowHorizon = smoothstep(0.018, -0.03, direction.y);
  float seaDepth = smoothstep(0.0, 0.42, -direction.y);
  vec3 sea = mix(seaHorizon, seaDeep, seaDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, sea, belowHorizon);
`

const SKY_RADIUS = 620

type SkyTuning = {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
}

const TUNING: SkyTuning = { turbidity: 7.2, rayleigh: 2.15, mieCoefficient: 0.0062, mieDirectionalG: 0.86 }

function configure(dome: SkyDome) {
  const uniforms = dome.material.uniforms
  uniforms.turbidity.value = TUNING.turbidity
  uniforms.rayleigh.value = TUNING.rayleigh
  uniforms.mieCoefficient.value = TUNING.mieCoefficient
  uniforms.mieDirectionalG.value = TUNING.mieDirectionalG
  uniforms.sunPosition.value.copy(SUN_DIRECTION).multiplyScalar(1000)
  dome.material.onBeforeCompile = (shader) => {
    shader.uniforms.seaHorizon = new THREE.Uniform(SEA_HORIZON.clone())
    shader.uniforms.seaDeep = new THREE.Uniform(SEA_DEEP.clone())
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 seaHorizon;\nuniform vec3 seaDeep;\nvoid main() {')
      .replace('#include <tonemapping_fragment>', `${seaPatch}\n#include <tonemapping_fragment>`)
  }
  dome.material.needsUpdate = true
  return dome
}

/**
 * Physical sky dome plus a PMREM built from that same sky, so image based
 * lighting and the visible horizon agree instead of drifting apart. A large
 * ocean-coloured disc sits under the probe scene to give the underside of
 * every piece a cool bounce rather than black.
 */
export function Sky() {
  const { gl, scene } = useThree()
  const dome = useMemo(() => {
    const sky = configure(new SkyDome())
    sky.scale.setScalar(SKY_RADIUS)
    sky.frustumCulled = false
    sky.renderOrder = -100
    return sky
  }, [])

  useEffect(() => {
    const probeScene = new THREE.Scene()
    const probeSky = configure(new SkyDome())
    probeSky.scale.setScalar(SKY_RADIUS)
    probeScene.add(probeSky)

    const oceanGeometry = new THREE.PlaneGeometry(4000, 4000)
    const oceanMaterial = new THREE.MeshBasicMaterial({ color: OCEAN_BOUNCE, side: THREE.DoubleSide })
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial)
    ocean.rotation.x = -Math.PI / 2
    ocean.position.y = -18
    probeScene.add(ocean)

    const generator = new THREE.PMREMGenerator(gl)
    const target = generator.fromScene(probeScene)
    scene.environment = target.texture
    // Image based lighting carries most of the coloured shade. At 0.38 the
    // probe was barely contributing and every shadow fell back to flat
    // ambient; 0.8 lets the sky and the ocean disc actually tint the surfaces
    // the key light never reaches.
    scene.environmentIntensity = 0.8

    return () => {
      scene.environment = null
      target.dispose()
      generator.dispose()
      oceanGeometry.dispose()
      oceanMaterial.dispose()
      probeSky.geometry.dispose()
      probeSky.material.dispose()
    }
  }, [gl, scene])

  useEffect(() => () => {
    dome.geometry.dispose()
    dome.material.dispose()
  }, [dome])

  return <primitive object={dome} />
}
