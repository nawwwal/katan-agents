import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const vertexShader = /* glsl */`
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 p = position;
    float waveA = sin(p.x * 2.4 + uTime * 0.58) * 0.012;
    float waveB = cos(p.y * 3.1 - uTime * 0.46) * 0.008;
    float waveC = sin((p.x + p.y) * 1.55 + uTime * 0.27) * 0.006;
    vWave = waveA + waveB + waveC;
    p.z += vWave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */`
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vec3 deep = vec3(0.006, 0.165, 0.225);
    vec3 midWater = vec3(0.018, 0.285, 0.345);
    vec3 lagoon = vec3(0.065, 0.45, 0.43);
    vec2 detailUv = (vUv - vec2(0.5)) * 3.8095238 + vec2(0.5);
    float radius = length(detailUv - vec2(0.5));
    float coast = 1.0 - smoothstep(0.12, 0.225, radius);
    float bandsA = sin(detailUv.x * 74.0 + detailUv.y * 21.0 + uTime * 0.35);
    float bandsB = cos(detailUv.y * 92.0 - detailUv.x * 14.0 - uTime * 0.28);
    float ripple = (bandsA + bandsB) * 0.035;
    vec3 color = mix(deep, midWater, 0.38 + ripple);
    color = mix(color, lagoon, coast * 0.48);
    float glint = pow(max(0.0, sin(detailUv.x * 83.0 - detailUv.y * 61.0 + uTime * 0.7)), 34.0) * (0.06 + coast * 0.08);
    float caustic = pow(max(0.0, bandsA * bandsB), 10.0) * coast * 0.12;
    gl_FragColor = vec4(color + glint + caustic, 0.82);
  }
`

export function Water({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  useFrame(({ clock }) => {
    if (material.current && !reducedMotion) material.current.uniforms.uTime.value = clock.elapsedTime
  })

  return <mesh position={[0, -0.42, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow renderOrder={-5}>
    <planeGeometry args={[160, 160, 96, 96]} />
    <shaderMaterial
      ref={material}
      uniforms={uniforms}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      transparent
      depthWrite={false}
    />
  </mesh>
}
