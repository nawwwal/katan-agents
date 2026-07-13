import type { Board, BoardEdge, BoardVertex, Harbor, HexTile, Resource, Terrain } from './types.js'
import { RESOURCES } from './types.js'

const SQRT3 = Math.sqrt(3)
const TERRAIN: Terrain[] = [
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
  'desert',
]
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const

export const seededRandom = (seed: number) => {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

const pointKey = (x: number, z: number) => `${Math.round(x * 1000)}:${Math.round(z * 1000)}`

export const createBoard = (seed = 1): Board => {
  const random = seededRandom(seed)
  const coords: Array<{ q: number; r: number }> = []
  for (let q = -2; q <= 2; q += 1) {
    const minR = Math.max(-2, -q - 2)
    const maxR = Math.min(2, -q + 2)
    for (let r = minR; r <= maxR; r += 1) coords.push({ q, r })
  }
  coords.sort((a, b) => a.r - b.r || a.q - b.q)

  const terrain = shuffle(TERRAIN, random)
  const vertices: Record<string, BoardVertex> = {}
  const edges: Record<string, BoardEdge> = {}
  const vertexByPoint = new Map<string, string>()
  const edgeByPair = new Map<string, string>()

  const hexes: HexTile[] = coords.map(({ q, r }, index) => {
    const x = SQRT3 * (q + r / 2)
    const z = 1.5 * r
    const vertexIds: string[] = []
    for (let corner = 0; corner < 6; corner += 1) {
      const angle = ((60 * corner + 30) * Math.PI) / 180
      const vx = x + Math.cos(angle)
      const vz = z + Math.sin(angle)
      const key = pointKey(vx, vz)
      let id = vertexByPoint.get(key)
      if (!id) {
        id = `v${vertexByPoint.size}`
        vertexByPoint.set(key, id)
        vertices[id] = { id, x: vx, z: vz, hexes: [], edges: [], neighbors: [] }
      }
      vertices[id].hexes.push(`h${index}`)
      vertexIds.push(id)
    }
    const edgeIds: string[] = []
    for (let side = 0; side < 6; side += 1) {
      const pair = [vertexIds[side], vertexIds[(side + 1) % 6]].sort()
      const key = pair.join(':')
      let id = edgeByPair.get(key)
      if (!id) {
        id = `e${edgeByPair.size}`
        edgeByPair.set(key, id)
        edges[id] = { id, vertices: pair as [string, string], hexes: [] }
        for (const vertexId of pair) vertices[vertexId].edges.push(id)
        vertices[pair[0]].neighbors.push(pair[1])
        vertices[pair[1]].neighbors.push(pair[0])
      }
      edges[id].hexes.push(`h${index}`)
      edgeIds.push(id)
    }
    return { id: `h${index}`, q, r, x, z, terrain: terrain[index], vertices: vertexIds, edges: edgeIds, neighbors: [] }
  })

  const byCoord = new Map(hexes.map((hex) => [`${hex.q}:${hex.r}`, hex.id]))
  for (const hex of hexes) {
    hex.neighbors = DIRECTIONS.flatMap(([dq, dr]) => {
      const neighbor = byCoord.get(`${hex.q + dq}:${hex.r + dr}`)
      return neighbor ? [neighbor] : []
    })
  }

  const productive = hexes.filter((hex) => hex.terrain !== 'desert')
  let assigned = false
  for (let attempt = 0; attempt < 1000 && !assigned; attempt += 1) {
    const numbers = shuffle(NUMBERS, random)
    productive.forEach((hex, index) => { hex.number = numbers[index] })
    assigned = productive.every((hex) => {
      if (hex.number !== 6 && hex.number !== 8) return true
      return hex.neighbors.every((id) => {
        const value = hexes.find((candidate) => candidate.id === id)?.number
        return value !== 6 && value !== 8
      })
    })
  }
  if (!assigned) throw new Error('Unable to place number tokens')

  const harborKinds: Array<Resource | 'generic'> = shuffle([...RESOURCES, 'generic', 'generic', 'generic', 'generic'], random)
  const coast = Object.values(edges)
    .filter((edge) => edge.hexes.length === 1)
    .sort((a, b) => {
      const midpoint = (edge: BoardEdge) => {
        const [one, two] = edge.vertices.map((id) => vertices[id])
        return { x: (one.x + two.x) / 2, z: (one.z + two.z) / 2 }
      }
      const ma = midpoint(a)
      const mb = midpoint(b)
      return Math.atan2(ma.z, ma.x) - Math.atan2(mb.z, mb.x)
    })
  const harbors: Harbor[] = harborKinds.map((kind, index) => {
    const edge = coast[Math.floor((index * coast.length) / harborKinds.length)]
    const harbor: Harbor = { id: `port${index}`, edgeId: edge.id, ratio: kind === 'generic' ? 3 : 2 }
    if (kind !== 'generic') harbor.resource = kind
    for (const vertexId of edge.vertices) vertices[vertexId].harborId = harbor.id
    return harbor
  })

  const desert = hexes.find((hex) => hex.terrain === 'desert')
  if (!desert) throw new Error('Board requires a desert')
  return { hexes, vertices, edges, harbors, robberHexId: desert.id }
}
