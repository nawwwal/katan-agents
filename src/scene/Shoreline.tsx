import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Board } from '../game/types'
import { buildIslandField, publishIslandField, type OceanRock } from './ocean/islandField'
import { SEA_LEVEL } from './ocean/oceanConfig'
import { createRockGeometry, createSurfSkirt } from './ocean/surfSkirt'
import { oceanNoiseGlsl } from './ocean/waveGlsl'
import { useReducedMotion } from './useReducedMotion'

const skirtVertex = /* glsl */`
  varying vec2 vSkirtUv;
  varying vec3 vSkirtWorld;
  void main() {
    vSkirtUv = uv;
    vSkirtWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skirtFragment = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vSkirtUv;
  varying vec3 vSkirtWorld;
  ${oceanNoiseGlsl}

  void main() {
    // Surge marches around the coast so the whole ring never pulses at once.
    float around = vSkirtUv.x * 24.0;
    float surge = 0.5 + 0.5 * sin(uTime * 0.62 - around * 1.7 + oceanFbm(vSkirtWorld.xz * 0.7) * 3.0);
    float reach = 0.34 + surge * 0.52;

    float up = 1.0 - vSkirtUv.y;                  // 1 at the rock, 0 at the sea
    float body = smoothstep(reach + 0.24, reach - 0.18, up);
    // The water shader now draws the waterline itself, so the skirt is only
    // the spray thrown up the rock face. Fine grain, low alpha: at the game
    // camera the old settings just widened the white mass at the coast.
    float texture = oceanFbm(vSkirtWorld.xz * 13.0 + vec2(uTime * 0.26, -uTime * 0.20));
    float torn = smoothstep(0.34, 0.66, texture + body * 0.30 - 0.14);
    float crestLine = smoothstep(0.62, 1.0, up) * (0.45 + surge * 0.55);

    float alpha = clamp(body * torn * 0.40 + crestLine * torn * 0.46, 0.0, 1.0);
    alpha *= smoothstep(0.0, 0.30, up) * 0.30;

    gl_FragColor = vec4(uColor * (0.86 + torn * 0.34), alpha);
    #include <colorspace_fragment>
  }
`

function SurfSkirt({ outline, reducedMotion }: { outline: THREE.Vector2[]; reducedMotion: boolean }) {
  const geometry = useMemo(() => createSurfSkirt(outline, 0.16, 0.22, 0.20), [outline])
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color('#cfe4e2') } }), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(({ clock }) => { if (!reducedMotion) uniforms.uTime.value = clock.elapsedTime })
  return <mesh geometry={geometry} position={[0, SEA_LEVEL, 0]} renderOrder={2}>
    <shaderMaterial
      uniforms={uniforms}
      vertexShader={skirtVertex}
      fragmentShader={skirtFragment}
      transparent
      depthWrite={false}
      side={THREE.DoubleSide}
      toneMapped={false}
    />
  </mesh>
}

function OffshoreRocks({ rocks }: { rocks: OceanRock[] }) {
  const variants = useMemo(() => [0, 1, 2].map((variant) => ({
    geometry: createRockGeometry(variant),
    members: rocks.filter((rock) => rock.variant === variant),
  })), [rocks])

  useEffect(() => () => { for (const variant of variants) variant.geometry.dispose() }, [variants])

  return <>{variants.map((variant, index) => (
    variant.members.length
      ? <RockCluster key={index} geometry={variant.geometry} rocks={variant.members} />
      : null
  ))}</>
}

function RockCluster({ geometry, rocks }: { geometry: THREE.BufferGeometry; rocks: OceanRock[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const instanced = mesh.current
    if (!instanced) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    rocks.forEach((rock, index) => {
      const half = rock.height * 0.5
      euler.set(rock.tilt, rock.rotation, rock.tilt * 0.7)
      quaternion.setFromEuler(euler)
      matrix.compose(
        new THREE.Vector3(rock.x, SEA_LEVEL - half * 0.42, rock.z),
        quaternion,
        new THREE.Vector3(rock.radius, half, rock.radius),
      )
      instanced.setMatrixAt(index, matrix)
    })
    instanced.instanceMatrix.needsUpdate = true
    instanced.computeBoundingSphere()
  }, [rocks])

  return <instancedMesh ref={mesh} args={[geometry, undefined, rocks.length]} castShadow receiveShadow>
    <meshStandardMaterial color="#4e5052" roughness={0.72} metalness={0.04} flatShading />
  </instancedMesh>
}

export function ShallowWater({ board }: { board: Board }) {
  const reducedMotion = useReducedMotion()
  const field = useMemo(() => buildIslandField(board), [board])
  useLayoutEffect(() => { publishIslandField(field) }, [field])
  return <group>
    <OffshoreRocks rocks={field.rocks} />
    <SurfSkirt outline={field.outline} reducedMotion={reducedMotion} />
  </group>
}
