import { ContactShadows, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { createTerrainForestLookDevLights, createTerrainForestModel } from './generated/createTerrainForestModel'
import { createTerrainPastureModel } from './generated/createTerrainPastureModel'

function ForestReview() {
  const model = useMemo(() => createTerrainForestModel(), [])
  const lights = useMemo(() => createTerrainForestLookDevLights(), [])
  useEffect(() => () => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
    })
  }, [model])
  return <>
    <primitive object={lights} />
    <primitive object={model} />
    <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#f3f3f1" roughness={1} />
    </mesh>
  </>
}

function GeneratedForestReview() {
  const { scene } = useGLTF('/assets/generated/forest/source-sam.glb')
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      object.material = materials.map((source) => {
        const material = source.clone()
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = 0
          material.envMapIntensity = 0.35
        }
        return material
      })
      if (object.material.length === 1) object.material = object.material[0]
    })
    return clone
  }, [scene])
  return <primitive object={model} position={[0, 0.456, 0]} scale={2} />
}

function PastureReview() {
  const model = useMemo(() => createTerrainPastureModel(), [])
  useEffect(() => () => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
    })
  }, [model])
  return <primitive object={model} />
}

function ReferenceLights() {
  return <>
    <hemisphereLight args={['#f4f7f7', '#5f7077', 1.18]} />
    <directionalLight
      position={[-4.8, 7.5, 4.2]}
      color="#ffdbad"
      intensity={4.25}
      castShadow
      shadow-mapSize-width={4096}
      shadow-mapSize-height={4096}
      shadow-camera-near={0.1}
      shadow-camera-far={20}
      shadow-camera-left={-3}
      shadow-camera-right={3}
      shadow-camera-top={3}
      shadow-camera-bottom={-3}
      shadow-bias={-0.00025}
      shadow-normalBias={0.018}
      shadow-radius={6}
      shadow-blurSamples={16}
      shadow-intensity={0.62}
    />
    <directionalLight position={[4, 4.5, -4]} color="#c7dce3" intensity={0.86} />
  </>
}

export function AssetReviewApp() {
  const search = new URLSearchParams(window.location.search)
  const assetId = search.get('asset-review')
  const view = search.get('view')
  const topView = view === 'top'
  const closeView = view === 'close'
  const pastureReview = assetId === '02-terrain-pasture'
  const generatedSource = search.get('source') === 'glb'
  return <main style={{ width: '100vw', height: '100vh', background: '#f3f3f1' }}>
    <Canvas
      shadows="variance"
      camera={{
        position: topView ? [0, 6.8, 0.001] : closeView ? [1.5, 1.65, 2.15] : pastureReview ? [2, 2.1, 2.8] : [2.4, 2.55, 3.45],
        fov: topView ? 20 : closeView ? 30 : 26,
        near: 0.1,
        far: 100,
      }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.2
        gl.outputColorSpace = THREE.SRGBColorSpace
        camera.lookAt(0, 0.25, 0)
      }}
    >
      <color attach="background" args={['#f3f3f1']} />
      <Suspense fallback={null}>{assetId === '02-terrain-pasture' ? <>
        <ReferenceLights />
        <PastureReview />
        <ContactShadows position={[0, 0.006, 0]} scale={5} opacity={0.18} blur={4} far={3} color="#59656b" frames={1} />
        <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#f3f3f1" roughness={1} />
        </mesh>
      </> : generatedSource ? <>
        <ReferenceLights />
        <GeneratedForestReview />
        <ContactShadows position={[0, 0.006, 0]} scale={5} opacity={0.18} blur={4} far={3} color="#59656b" frames={1} />
        <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#f3f3f1" roughness={1} />
        </mesh>
      </> : <ForestReview />}</Suspense>
    </Canvas>
  </main>
}
