import * as THREE from 'three'

export type PastureModelRuntime = {
  nodes: Record<string, THREE.Object3D>
  meshes: Record<string, THREE.Mesh>
  sockets: Record<string, THREE.Object3D>
  colliders: Record<string, unknown>
}

const clay = new THREE.MeshStandardMaterial({ color: '#bcb39c', roughness: 0.92 })
const darkClay = new THREE.MeshStandardMaterial({ color: '#4a463e', roughness: 0.94 })
const soilClay = new THREE.MeshStandardMaterial({ color: '#675d49', roughness: 0.96 })
const stoneClay = new THREE.MeshStandardMaterial({ color: '#817b6c', roughness: 0.95, flatShading: true })

const bodyGeometry = new THREE.SphereGeometry(1, 20, 14)
const headGeometry = new THREE.SphereGeometry(1, 14, 10)
const earGeometry = new THREE.ConeGeometry(1, 1, 4)
const legGeometry = new THREE.CylinderGeometry(1, 1, 1, 7)
const rockGeometry = new THREE.IcosahedronGeometry(1, 1)

function makeHexTop() {
  const shape = new THREE.Shape()
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3
    const x = Math.cos(angle) * 0.985
    const y = Math.sin(angle) * 0.985
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

function addSheep(
  root: THREE.Group,
  runtime: PastureModelRuntime,
  id: string,
  position: [number, number],
  rotation: number,
  grazing: boolean,
  scale = 1,
) {
  const sheep = new THREE.Group()
  sheep.name = id
  sheep.position.set(position[0], 0.38, position[1])
  sheep.rotation.y = rotation
  sheep.scale.setScalar(scale)

  const body = new THREE.Mesh(bodyGeometry, clay)
  body.name = `${id}-body`
  body.scale.set(0.19, 0.13, 0.12)
  body.castShadow = true
  body.receiveShadow = true
  sheep.add(body)

  const neck = new THREE.Group()
  neck.position.set(0.2, grazing ? -0.02 : 0.015, 0)
  neck.rotation.z = grazing ? -0.78 : -0.12
  const head = new THREE.Mesh(headGeometry, darkClay)
  head.name = `${id}-head`
  head.position.x = 0.07
  head.scale.set(0.098, 0.074, 0.08)
  head.castShadow = true
  neck.add(head)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, darkClay)
    ear.position.set(0.035, 0.025, side * 0.07)
    ear.rotation.set(Math.PI / 2, 0, side * 0.65)
    ear.scale.set(0.025, 0.055, 0.018)
    ear.castShadow = true
    neck.add(ear)
  }
  sheep.add(neck)

  for (const x of [-0.12, 0.12]) {
    for (const z of [-0.075, 0.075]) {
      const leg = new THREE.Mesh(legGeometry, darkClay)
      leg.position.set(x, -0.15, z)
      leg.scale.set(0.018, 0.08, 0.018)
      leg.castShadow = true
      sheep.add(leg)
    }
  }

  root.add(sheep)
  runtime.nodes[id] = sheep
  runtime.meshes[`${id}-body`] = body
  runtime.meshes[`${id}-head`] = head
  runtime.sockets[`${id}-head`] = neck
  runtime.colliders[id] = { type: 'capsule', radius: 0.14, height: 0.3 }
}

function addRockCluster(root: THREE.Group, id: string, x: number, z: number, scale: number, count: number) {
  const cluster = new THREE.Group()
  cluster.name = id
  cluster.position.set(x, 0.2, z)
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.37
    const radius = index === 0 ? 0 : 0.12 + (index % 3) * 0.035
    const rock = new THREE.Mesh(rockGeometry, stoneClay)
    rock.position.set(Math.cos(angle) * radius, (index === 0 ? 0.1 : 0.04) * scale, Math.sin(angle) * radius)
    rock.rotation.set(index * 0.41, index * 0.77, index * 0.23)
    const size = scale * (index === 0 ? 0.3 : 0.13 + (index % 3) * 0.025)
    rock.scale.set(size * 1.08, size * (0.65 + (index % 2) * 0.16), size * 0.9)
    rock.castShadow = true
    rock.receiveShadow = true
    cluster.add(rock)
  }
  root.add(cluster)
}

export function createTerrainPastureModel() {
  const root = new THREE.Group()
  root.name = 'TerrainPasture'
  const runtime: PastureModelRuntime = { nodes: { root }, meshes: {}, sockets: {}, colliders: {} }

  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(0.997, 0.997, 0.18, 6, 2, false, Math.PI / 6),
    soilClay,
  )
  slab.name = 'ground-slab'
  slab.position.y = 0.09
  slab.castShadow = true
  slab.receiveShadow = true
  root.add(slab)

  const top = new THREE.Mesh(makeHexTop(), clay)
  top.name = 'pasture-top'
  top.rotation.x = -Math.PI / 2
  top.position.y = 0.185
  top.receiveShadow = true
  root.add(top)
  runtime.nodes['ground-slab'] = slab
  runtime.meshes['ground-slab'] = slab
  runtime.meshes['pasture-top'] = top
  runtime.sockets['ground-top'] = top
  runtime.colliders['ground-slab'] = { type: 'cylinder', radius: 0.997, height: 0.18 }

  addRockCluster(root, 'rock-left', -0.48, -0.34, 0.55, 8)
  addRockCluster(root, 'rock-right', 0.56, 0.43, 0.34, 6)
  addSheep(root, runtime, 'sheep-alert', [-0.42, 0.28], -0.2, false, 0.72)
  addSheep(root, runtime, 'sheep-near', [0.24, 0.35], -2.2, true, 0.74)
  addSheep(root, runtime, 'sheep-far', [0.4, -0.36], 2.45, true, 0.68)

  root.userData.sculptRuntime = runtime
  root.userData.sculptPass = 'blockout'
  return root
}
