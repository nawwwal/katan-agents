import * as THREE from 'three'

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>
  meshes: Record<string, THREE.Mesh>
  sockets: Record<string, THREE.Object3D>
  colliders: Record<string, unknown>
  destructionGroups: Record<string, THREE.Object3D[]>
}

const loader = new THREE.TextureLoader()
const groundAlbedo = loader.load('/assets/generated/forest/ground-albedo-runtime.webp')
const groundNormal = loader.load('/assets/generated/forest/ground-normal.webp')
const groundRoughness = loader.load('/assets/generated/forest/ground-roughness.webp')
const loadMaterialTexture = (path: string, color = false) => {
  const texture = loader.load(path)
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.7, 1.7)
  texture.anisotropy = 8
  return texture
}
const needleAlbedo = loadMaterialTexture('/assets/generated/forest/materials/needles-albedo-runtime.webp', true)
const needleNormal = loadMaterialTexture('/assets/generated/forest/materials/needles-normal.webp')
const needleRoughness = loadMaterialTexture('/assets/generated/forest/materials/needles-roughness.webp')
for (const texture of [groundAlbedo, groundNormal, groundRoughness]) {
  texture.colorSpace = texture === groundAlbedo ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = 8
}

const sideAlbedo = loader.load('/assets/generated/forest/side-albedo-runtime.webp')
sideAlbedo.colorSpace = THREE.SRGBColorSpace
sideAlbedo.wrapS = THREE.RepeatWrapping
sideAlbedo.repeat.set(3, 1)
sideAlbedo.anisotropy = 8
const sideMaterial = new THREE.MeshStandardMaterial({ map: sideAlbedo, color: '#d4c7a8', roughness: 0.96 })
const groundMaterial = new THREE.MeshStandardMaterial({
  map: groundAlbedo,
  normalMap: groundNormal,
  roughnessMap: groundRoughness,
  normalScale: new THREE.Vector2(0.34, 0.34),
  roughness: 0.9,
})
const barkMaterial = new THREE.MeshStandardMaterial({ color: '#49382a', roughness: 0.96 })
const branchMaterial = new THREE.MeshStandardMaterial({ color: '#203e2c', roughness: 0.96 })
const needleMaterial = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  map: needleAlbedo,
  normalMap: needleNormal,
  roughnessMap: needleRoughness,
  normalScale: new THREE.Vector2(0.38, 0.38),
  roughness: 0.88,
})
const rockMaterial = new THREE.MeshStandardMaterial({
  color: '#646a66',
  roughness: 0.96,
  flatShading: true,
})
const rockDarkMaterial = new THREE.MeshStandardMaterial({ color: '#48504d', roughness: 0.98, flatShading: true })
const mossMaterial = new THREE.MeshStandardMaterial({ color: '#74812f', roughness: 1 })

const trunkGeometry = new THREE.CylinderGeometry(0.035, 0.055, 0.42, 7)
const trunkFlareGeometry = new THREE.ConeGeometry(0.09, 0.14, 7, 1)
const branchGeometry = new THREE.CylinderGeometry(0.006, 0.018, 1, 5, 1)
const needleSprayGeometry = new THREE.ConeGeometry(0.014, 0.064, 3, 1)
const rootGeometry = new THREE.ConeGeometry(0.03, 0.16, 5, 1)
const rockGeometry = new THREE.IcosahedronGeometry(0.1, 1)

const makeHexTop = () => {
  const shape = new THREE.Shape()
  for (let i = 0; i < 6; i += 1) {
    // CylinderGeometry uses x=sin(theta), z=cos(theta). After the XY shape is
    // rotated onto XZ, a zero-degree start produces the same six vertices.
    // Starting this at PI/6 rotates the cap 30 degrees and causes overhangs.
    const angle = i * Math.PI / 3
    const x = Math.cos(angle) * 0.985
    const y = Math.sin(angle) * 0.985
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 1) {
    const x = geometry.attributes.position.getX(i)
    const y = geometry.attributes.position.getY(i)
    uv.setXY(i, x * 0.5 + 0.5, y * 0.5 + 0.5)
  }
  return geometry
}

const addTree = (
  root: THREE.Group,
  runtime: ProceduralModelRuntime,
  id: string,
  x: number,
  z: number,
  height: number,
  lean = 0,
) => {
  const tree = new THREE.Group()
  tree.name = id
  tree.position.set(x, 0.19, z)
  tree.rotation.z = lean

  const trunk = new THREE.Mesh(trunkGeometry, barkMaterial)
  trunk.position.y = 0.21
  trunk.scale.setScalar(height)
  trunk.castShadow = true
  tree.add(trunk)
  const flare = new THREE.Mesh(trunkFlareGeometry, barkMaterial)
  flare.name = `${id}-trunk-flare`
  flare.position.y = 0.07
  flare.scale.setScalar(height)
  flare.castShadow = true
  flare.receiveShadow = true
  tree.add(flare)

  root.add(tree)
  runtime.nodes[id] = tree
  runtime.meshes[`${id}-trunk`] = trunk
  runtime.sockets[`${id}-root`] = tree
  runtime.colliders[id] = { type: 'cylinder', radius: 0.22, height: height * 0.94 }
  runtime.destructionGroups[id] = [tree]
}

const addConiferCanopy = (root: THREE.Group, trees: Array<[string, number, number, number, number?]>) => {
  const tiers = 9
  const branchesPerTier = 10
  const spraysPerBranch = 18
  const branches = new THREE.InstancedMesh(branchGeometry, branchMaterial, trees.length * tiers * branchesPerTier)
  const needles = new THREE.InstancedMesh(needleSprayGeometry, needleMaterial, trees.length * tiers * branchesPerTier * spraysPerBranch)
  const roots = new THREE.InstancedMesh(rootGeometry, barkMaterial, trees.length * 4)
  branches.name = 'conifer-primary-branches'
  needles.name = 'conifer-needle-sprays'
  roots.name = 'conifer-root-flares'
  for (const mesh of [branches, needles, roots]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const direction = new THREE.Vector3()
  const leafDirection = new THREE.Vector3()
  const side = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const radial = new THREE.Vector3()
  const keyDirection = new THREE.Vector3(-0.58, 0.78, 0.24).normalize()
  const needleColor = new THREE.Color()
  const shadowNeedle = new THREE.Color('#789078')
  const sunNeedle = new THREE.Color('#d1bd73')
  let branchInstance = 0
  let needleInstance = 0
  let rootInstance = 0
  trees.forEach(([, x, z, height], treeIndex) => {
    for (let rootIndex = 0; rootIndex < 4; rootIndex += 1) {
      const angle = rootIndex / 4 * Math.PI * 2 + treeIndex * 0.42
      direction.set(Math.cos(angle), -0.42, Math.sin(angle)).normalize()
      position.set(x, 0.205, z).addScaledVector(direction, 0.055 * height)
      quaternion.setFromUnitVectors(up, direction)
      scale.set(height, height, height)
      matrix.compose(position, quaternion, scale)
      roots.setMatrixAt(rootInstance, matrix)
      rootInstance += 1
    }
    for (let tier = 0; tier < tiers; tier += 1) {
      const t = tier / (tiers - 1)
      const length = (0.31 - t * 0.18) * height
      const baseY = 0.19 + (0.3 + tier * 0.071) * height
      for (let branch = 0; branch < branchesPerTier; branch += 1) {
        const noise = Math.sin((treeIndex + 1) * 13.17 + tier * 7.31 + branch * 3.77)
        const angle = branch / branchesPerTier * Math.PI * 2 + tier * 0.53 + treeIndex * 0.37 + noise * 0.12
        const branchLength = length * (0.86 + (noise + 1) * 0.13)
        direction.set(Math.cos(angle), -0.42 + t * 0.25 + noise * 0.055, Math.sin(angle)).normalize()
        position.set(x, baseY + noise * 0.014 * height, z).addScaledVector(direction, branchLength * 0.48)
        quaternion.setFromUnitVectors(up, direction)
        scale.set(height, branchLength, height)
        matrix.compose(position, quaternion, scale)
        branches.setMatrixAt(branchInstance, matrix)
        branchInstance += 1

        side.set(-Math.sin(angle), 0, Math.cos(angle))
        binormal.crossVectors(direction, side).normalize()
        for (let spray = 0; spray < spraysPerBranch; spray += 1) {
          const along = 0.08 + spray * 0.05
          const leafAngle = spray * 2.399 + tier * 0.31 + noise * 0.2
          radial.copy(side).multiplyScalar(Math.cos(leafAngle)).addScaledVector(binormal, Math.sin(leafAngle)).normalize()
          position.set(x, baseY + noise * 0.014 * height, z)
            .addScaledVector(direction, branchLength * along)
            .addScaledVector(radial, branchLength * 0.04)
          leafDirection.copy(direction).multiplyScalar(0.72)
            .addScaledVector(up, 0.18 + t * 0.12)
            .addScaledVector(radial, 0.5)
            .normalize()
          quaternion.setFromUnitVectors(up, leafDirection)
          const sprayScale = height * (1.05 - t * 0.2) * (0.88 + spray * 0.018)
          scale.set(sprayScale, sprayScale, sprayScale)
          matrix.compose(position, quaternion, scale)
          needles.setMatrixAt(needleInstance, matrix)
          const sun = THREE.MathUtils.clamp((leafDirection.dot(keyDirection) + 0.25) / 1.25, 0, 1)
          needleColor.lerpColors(shadowNeedle, sunNeedle, sun * 0.68)
          needles.setColorAt(needleInstance, needleColor)
          needleInstance += 1
        }
      }
    }
  })
  for (const mesh of [branches, needles, roots]) mesh.instanceMatrix.needsUpdate = true
  if (needles.instanceColor) needles.instanceColor.needsUpdate = true
  root.add(branches, needles, roots)
}

const addRock = (root: THREE.Group, id: string, x: number, z: number, scale: number, rotation: number) => {
  const cluster = new THREE.Group()
  cluster.name = id
  cluster.position.set(x, 0.19, z)
  for (let part = 0; part < 3; part += 1) {
    const rock = new THREE.Mesh(rockGeometry, part === 1 ? rockDarkMaterial : rockMaterial)
    const partScale = scale * (part === 0 ? 1 : 0.58 + part * 0.08)
    rock.position.set((part - 1) * scale * 0.07, part === 0 ? scale * 0.055 : scale * 0.035, (part % 2 ? 1 : -1) * scale * 0.045)
    rock.rotation.set(rotation * (0.35 + part * 0.2), rotation + part * 1.4, rotation * 0.22 - part * 0.17)
    rock.scale.set(partScale * 1.12, partScale * (0.62 + part * 0.06), partScale * 0.9)
    rock.castShadow = true
    rock.receiveShadow = true
    cluster.add(rock)
  }
  root.add(cluster)
  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.064, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mossMaterial)
  moss.position.set(x - scale * 0.04, 0.205 + scale * 0.035, z + scale * 0.025)
  moss.scale.set(scale * 0.55, scale * 0.12, scale * 0.42)
  root.add(moss)
}

export function createTerrainForestModel(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'TerrainForest'
  const runtime: ProceduralModelRuntime = { nodes: { root }, meshes: {}, sockets: {}, colliders: {}, destructionGroups: {} }

  const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.997, 0.997, 0.18, 6, 2, false, Math.PI / 6), sideMaterial)
  slab.name = 'ground-slab'
  slab.position.y = 0.09
  slab.receiveShadow = true
  slab.castShadow = true
  root.add(slab)

  const top = new THREE.Mesh(makeHexTop(), groundMaterial)
  top.name = 'ground-top'
  top.rotation.x = -Math.PI / 2
  top.position.y = 0.185
  top.receiveShadow = true
  root.add(top)
  runtime.nodes['ground-slab'] = slab
  runtime.meshes['ground-slab'] = slab
  runtime.meshes['ground-top'] = top
  runtime.colliders['ground-slab'] = { type: 'cylinder', radius: 0.997, height: 0.18 }

  const trees: Array<[string, number, number, number, number?]> = [
    ['pine-nw-hero', -0.48, -0.34, 1.08, -0.018],
    ['pine-nw-back', -0.18, -0.56, 0.87, 0.012],
    ['pine-north', 0.12, -0.56, 0.72, -0.01],
    ['pine-ne-hero', 0.5, -0.3, 0.98, 0.016],
    ['pine-east-back', 0.67, -0.02, 0.67, -0.01],
    ['pine-east-front', 0.54, 0.28, 0.76, 0.018],
    ['pine-se-hero', 0.39, 0.54, 0.92, -0.014],
    ['pine-se-small', 0.67, 0.34, 0.5, 0.012],
    ['pine-sw-front', -0.43, 0.49, 0.78, -0.018],
    ['pine-sw-small', -0.64, 0.28, 0.5, 0.014],
    ['pine-west-small', -0.67, 0.13, 0.6, 0.01],
  ]
  trees.forEach(([id, x, z, height, lean]) => addTree(root, runtime, id, x, z, height, lean))
  addConiferCanopy(root, trees)

  ;[
    [-0.7, -0.18, 0.8, 0.4], [-0.27, 0.12, 0.55, 1.1], [0.27, 0.16, 0.72, 0.2],
    [0.73, 0.25, 0.58, 0.8], [-0.25, 0.67, 0.64, 1.9], [0.22, -0.72, 0.48, 1.4],
  ].forEach(([x, z, scale, rotation], index) => addRock(root, `rock-${index}`, x, z, scale, rotation))

  root.userData.sculptRuntime = runtime
  root.userData.sculptPass = 'structural-pass'
  return root
}

export function createTerrainForestLookDevLights(): THREE.Group {
  const lights = new THREE.Group()
  lights.add(new THREE.HemisphereLight(0xf6f7f2, 0x52646b, 1.12))
  const key = new THREE.DirectionalLight(0xffe2bd, 2.4)
  key.position.set(-4.5, 7.5, 5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.00035
  key.shadow.normalBias = 0.018
  lights.add(key)
  const fill = new THREE.DirectionalLight(0xb9dce8, 1.08)
  fill.position.set(4, 3.5, -4)
  lights.add(fill)
  return lights
}
