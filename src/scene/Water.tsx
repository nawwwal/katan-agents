import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const vertexShader = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  float waterHeight(vec2 p, float time) {
    float a = sin(dot(p, vec2(0.78, 0.31)) + time * 0.46) * 0.052;
    float b = sin(dot(p, vec2(-0.34, 1.12)) - time * 0.38) * 0.031;
    float c = sin(dot(p, vec2(1.61, -0.58)) + time * 0.24) * 0.014;
    return a + b + c;
  }

  void main() {
    vec3 p = position;
    vWave = waterHeight(p.xy, uTime);
    p.z += vWave;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec3 deep = vec3(0.010, 0.105, 0.155);
    vec3 midWater = vec3(0.015, 0.305, 0.385);
    vec3 shoal = vec3(0.055, 0.555, 0.565);
    vec3 sky = vec3(0.285, 0.665, 0.720);
    vec2 p = vWorldPosition.xz;
    float phaseA = dot(p, vec2(0.78, 0.31)) + uTime * 0.46;
    float phaseB = dot(p, vec2(-0.34, 1.12)) - uTime * 0.38;
    float phaseC = dot(p, vec2(1.61, -0.58)) + uTime * 0.24;
    float dhdx = cos(phaseA) * 0.0406 - cos(phaseB) * 0.0105 + cos(phaseC) * 0.0225;
    float dhdz = cos(phaseA) * 0.0161 + cos(phaseB) * 0.0347 - cos(phaseC) * 0.0081;
    vec3 normal = normalize(vec3(-dhdx, 1.0, -dhdz));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
    vec3 sunDir = normalize(vec3(-0.50, 0.78, 0.36));
    float sunGlint = pow(max(dot(reflect(-sunDir, normal), viewDir), 0.0), 92.0);
    float radius = length(p);
    float nearIsland = 1.0 - smoothstep(5.0, 8.5, radius);
    float broad = noise2(p * 0.34 + vec2(uTime * 0.025, -uTime * 0.018));
    float fine = noise2(p * 2.4 + vec2(-uTime * 0.06, uTime * 0.045));
    float crest = smoothstep(0.060, 0.083, vWave + fine * 0.018);
    vec3 color = mix(deep, midWater, 0.44 + broad * 0.24);
    color = mix(color, shoal, nearIsland * 0.20);
    color = mix(color, sky, fresnel * 0.42);
    color += vec3(1.0, 0.76, 0.48) * sunGlint * 0.78;
    color += vec3(0.56, 0.88, 0.87) * crest * 0.055;
    color *= 0.92 + fine * 0.13;
    gl_FragColor = vec4(color, 1.0);
  }
`

export function Water({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  useFrame(({ clock }) => {
    if (material.current && !reducedMotion) material.current.uniforms.uTime.value = clock.elapsedTime
  })

  return <mesh position={[0, -0.42, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow renderOrder={-5}>
    <planeGeometry args={[160, 160, 160, 160]} />
    <shaderMaterial
      ref={material}
      uniforms={uniforms}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      depthWrite
    />
  </mesh>
}
