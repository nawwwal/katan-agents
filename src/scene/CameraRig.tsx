import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'

const TARGET = new THREE.Vector3(0, 0, 0)

export function CameraRig({ cinematic = false, reducedMotion = false, focus, focusRevision }: { cinematic?: boolean; reducedMotion?: boolean; focus?: [number, number]; focusRevision?: number }) {
  const { camera, size, invalidate } = useThree()
  const controls = useRef<MapControlsImpl>(null)
  const focusRemaining = useRef(0)
  const focusPoint = useRef(new THREE.Vector3())

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const narrow = size.width / size.height < 0.72
    camera.fov = narrow ? 43 : 31
    if (narrow) camera.position.set(13.2, 16.4, 16.0)
    else camera.position.set(7.7, 10.3, 9.8)
    camera.lookAt(TARGET)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, invalidate, size.height, size.width])

  useEffect(() => {
    if (!focus || reducedMotion) return
    focusPoint.current.set(focus[0], 0.36, focus[1])
    focusRemaining.current = 1.9
  }, [focus?.[0], focus?.[1], focusRevision, reducedMotion])

  useFrame((_, delta) => {
    if (!controls.current || cinematic || reducedMotion) return
    focusRemaining.current = Math.max(0, focusRemaining.current - delta)
    const target = focusRemaining.current > 0 ? focusPoint.current : TARGET
    controls.current.target.lerp(target, 1 - Math.exp(-delta * (focusRemaining.current > 0 ? 5.2 : 2.6)))
    controls.current.update()
  })

  return <MapControls
    ref={controls}
    makeDefault
    enableDamping
    autoRotate={cinematic && !reducedMotion}
    autoRotateSpeed={0.24}
    dampingFactor={0.08}
    enableRotate
    minPolarAngle={0.58}
    maxPolarAngle={0.82}
    minAzimuthAngle={-0.62}
    maxAzimuthAngle={0.62}
    minDistance={9}
    maxDistance={34}
    zoomSpeed={0.6}
    panSpeed={0.45}
    target={TARGET}
  />
}
