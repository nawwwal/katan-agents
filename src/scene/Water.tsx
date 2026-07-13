import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const vertexShader = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 p = position;
    float waveA = sin(p.x * 0.70 + p.y * 0.16 + uTime * 0.42) * 0.046;
    float waveB = cos(p.y * 0.84 - p.x * 0.14 - uTime * 0.34) * 0.032;
    float waveC = sin((p.x + p.y) * 0.40 + uTime * 0.19) * 0.022;
    vWave = waveA + waveB + waveC;
    p.z += vWave;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 deep = vec3(0.006, 0.165, 0.245);
    vec3 midWater = vec3(0.020, 0.390, 0.485);
    vec3 sky = vec3(0.18, 0.63, 0.70);
    vec2 p = vWorldPosition.xz;
    float broad = 0.5 + 0.5 * sin(p.x * 0.92 + p.y * 0.53 + uTime * 0.22);
    float crossWave = 0.5 + 0.5 * cos(p.y * 1.25 - p.x * 0.41 - uTime * 0.18);
    float phaseA = p.x * 0.70 + p.y * 0.16 + uTime * 0.42;
    float phaseB = p.y * 0.84 - p.x * 0.14 - uTime * 0.34;
    float phaseC = (p.x + p.y) * 0.40 + uTime * 0.19;
    float dhdx = cos(phaseA) * 0.0322 + sin(phaseB) * 0.0045 + cos(phaseC) * 0.0088;
    float dhdz = cos(phaseA) * 0.0074 - sin(phaseB) * 0.0269 + cos(phaseC) * 0.0088;
    vec3 normal = normalize(vec3(-dhdx, 1.0, -dhdz));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    vec3 sunDir = normalize(vec3(-0.45, 0.84, 0.30));
    float sunGlint = pow(max(dot(reflect(-sunDir, normal), viewDir), 0.0), 72.0);
    float crestA = sin((p.x - p.y * 0.66) * 3.20 + uTime * 0.40) * 0.5 + 0.5;
    float crestB = sin((p.y + p.x * 0.34) * 4.70 - uTime * 0.31) * 0.5 + 0.5;
    float aaA = max(fwidth(crestA), 0.008);
    float aaB = max(fwidth(crestB), 0.008);
    float softLines = smoothstep(0.965 - aaA, 0.965 + aaA, crestA) * 0.64
      + smoothstep(0.978 - aaB, 0.978 + aaB, crestB) * 0.36;
    vec3 color = mix(deep, midWater, 0.39 + broad * 0.10 + crossWave * 0.05 + vWave * 0.55);
    color = mix(color, sky, fresnel * 0.46);
    color += vec3(1.0, 0.78, 0.48) * sunGlint * 0.34;
    color += vec3(0.24, 0.72, 0.75) * softLines * 0.032;
    // A restrained surface pass over the authored ocean image. The image
    // supplies high-frequency detail; this layer supplies depth, glints, and
    // subtle motion without replacing it with a flat opaque shader.
    gl_FragColor = vec4(color, 0.30);
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
