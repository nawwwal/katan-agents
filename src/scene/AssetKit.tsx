import { useGLTF } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const KIT_URL = '/assets/3d/katan-kit.glb'

export type KatanAssetName =
  | 'BoardFrame'
  | 'TerrainForest'
  | 'TerrainPasture'
  | 'TerrainFields'
  | 'TerrainHills'
  | 'TerrainMountains'
  | 'TerrainDesert'
  | 'Road'
  | 'Settlement'
  | 'City'
  | 'Port'
  | 'Robber'
  | 'NumberToken'
  | 'NumberTokenRim'

type AssetPart = { node: string; tint?: boolean }

const ASSET_PARTS: Record<KatanAssetName, AssetPart[]> = {
  BoardFrame: [
    { node: 'BoardFrameCliff' },
    { node: 'BoardFrameBeach' },
    { node: 'BoardFrameTurf' },
    { node: 'BoardFrameRocks' },
  ],
  TerrainForest: [{ node: 'TerrainForestGround' }, { node: 'TerrainForestDetails' }],
  TerrainPasture: [{ node: 'TerrainPastureGround' }, { node: 'TerrainPastureDetails' }],
  TerrainFields: [{ node: 'TerrainFieldsGround' }, { node: 'TerrainFieldsDetails' }],
  TerrainHills: [{ node: 'TerrainHillsGround' }, { node: 'TerrainHillsDetails' }],
  TerrainMountains: [{ node: 'TerrainMountainsGround' }, { node: 'TerrainMountainsRocks' }, { node: 'TerrainMountainsDetails' }],
  TerrainDesert: [{ node: 'TerrainDesertGround' }, { node: 'TerrainDesertDetails' }],
  Road: [{ node: 'RoadSurface' }, { node: 'RoadStones' }, { node: 'RoadPlayer', tint: true }],
  Settlement: [
    { node: 'SettlementStone' },
    { node: 'SettlementPlaster' },
    { node: 'SettlementTimber' },
    { node: 'SettlementRoof' },
    { node: 'SettlementWindows' },
    { node: 'SettlementPlayer', tint: true },
  ],
  City: [
    { node: 'CityStone' },
    { node: 'CityPlaster' },
    { node: 'CityTimber' },
    { node: 'CityRoof' },
    { node: 'CityWindows' },
    { node: 'CityPlayer', tint: true },
  ],
  Port: [{ node: 'Port' }],
  Robber: [{ node: 'Robber' }],
  NumberToken: [{ node: 'NumberToken', tint: true }],
  NumberTokenRim: [{ node: 'NumberTokenRim', tint: true }],
}

type AssetMeshProps = Omit<ThreeElements['group'], 'name'> & {
  asset: KatanAssetName
  color?: string
}

export function AssetMesh({ asset, color, ...props }: AssetMeshProps) {
  const { nodes } = useGLTF(KIT_URL)
  const meshes = useMemo(() => ASSET_PARTS[asset].map((part) => {
    const node = nodes[part.node]
    if (!(node instanceof THREE.Mesh)) throw new Error(`Missing Katan asset part: ${part.node}`)
    const source = node.material as THREE.MeshStandardMaterial
    const matrix = node.matrix.clone()
    if (!color || !part.tint) return { ...part, geometry: node.geometry, material: source, source, matrix }
    const material = source.clone()
    material.color.set(color)
    return { ...part, geometry: node.geometry, material, source, matrix }
  }), [asset, color, nodes])

  useEffect(() => () => {
    for (const mesh of meshes) if (mesh.material !== mesh.source) mesh.material.dispose()
  }, [meshes])

  return <group {...props}>
    {meshes.map((mesh) => <mesh key={mesh.node} geometry={mesh.geometry} material={mesh.material} matrix={mesh.matrix} matrixAutoUpdate={false} castShadow receiveShadow />)}
  </group>
}

useGLTF.preload(KIT_URL)
