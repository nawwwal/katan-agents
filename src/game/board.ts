import type {
  Board,
  BoardConstraint,
  BoardEdge,
  BoardOptions,
  BoardVertex,
  DesertPlacement,
  Harbor,
  HarborLayout,
  HexTile,
  Resource,
  Terrain,
} from './types.js'
import { BOARD_CONSTRAINTS, RESOURCES, defaultBoardOptions } from './types.js'

const SQRT3 = Math.sqrt(3)
const TERRAINS: Terrain[] = ['lumber', 'wool', 'grain', 'brick', 'ore', 'desert']
const TERRAIN_COUNTS = [4, 4, 4, 3, 3, 1]
const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const NUMBER_COUNTS = [1, 2, 2, 2, 2, 2, 2, 2, 2, 1]
const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const
/** Classic printed harbour ring, read clockwise from the eastern coast. */
const FIXED_HARBORS: Array<Resource | 'generic'> = ['generic', 'grain', 'ore', 'generic', 'wool', 'generic', 'brick', 'lumber', 'generic']

/**
 * Hard invariants of every Katan island. These are not options and are never relaxed:
 * no two identical terrains touch, no two identical numbers touch, no red number (6, 8)
 * touches another red number, and no rare number (2, 12) touches another rare number.
 */
export const terrainConflict = (left: Terrain, right: Terrain) => left === right
export const numberConflict = (left: number, right: number) =>
  left === right
  || ((left === 6 || left === 8) && (right === 6 || right === 8))
  || ((left === 2 || left === 12) && (right === 2 || right === 12))

/**
 * Search bounds. Terrain and numbers are each solved by randomised backtracking with forward
 * checking over bitmask domains, most-constrained-hex-first. A typical solve finishes in about
 * forty nodes, but the runtime distribution is heavy-tailed: a bad early choice can send one
 * run into tens of thousands of nodes. Rather than let that tail reach the host, a run that
 * passes RESTART_NODE_CAP is abandoned and restarted with fresh randomness, up to
 * RESTART_LIMIT times. Restarts are what keep the p99 in microseconds.
 *
 * The last attempt gets FINAL_NODE_BUDGET so a genuinely hard instance is still solved rather
 * than wrongly reported as impossible. Worst case is RESTART_LIMIT * RESTART_NODE_CAP +
 * FINAL_NODE_BUDGET nodes, which is bounded and, in practice, never approached.
 *
 * `balancedPips` is the single soft constraint and is propagated inside the same search. If it
 * makes an island unsatisfiable the generator re-solves without it, records it in
 * `board.generation.relaxed`, and the UI tells the host the pips could not be balanced. The
 * four adjacency invariants are never relaxed.
 */
const RESTART_NODE_CAP = 400
const RESTART_LIMIT = 24
const FINAL_NODE_BUDGET = 200_000
/** No intersection may sit on more than this many pips when balancedPips is on. */
const VERTEX_PIP_CAP = 12
/**
 * Per-wedge pip band when balancedPips is on, scaled by how many productive tiles the wedge
 * actually has, so a wedge holding the desert is not asked for the same total as a full one.
 * The island averages 3.2 pips per productive tile; this holds every wedge between 2 and 4.
 */
const SECTOR_PIPS_PER_TILE_FLOOR = 2
const SECTOR_PIPS_PER_TILE_CAP = 4
/** Highest pip value a single tile can carry, used to bound what a wedge can still gain. */
const MAX_TILE_PIPS = 5

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

export const pipsFor = (value: number | undefined) => value === undefined ? 0 : 6 - Math.abs(7 - value)

const pointKey = (x: number, z: number) => `${Math.round(x * 1000)}:${Math.round(z * 1000)}`
const ring = (hex: { q: number; r: number }) => Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r))

/**
 * The island topology is canonical and seed-independent: hex positions, vertex ids and
 * edge ids never change, only what sits on them. It is built once per process so a shuffle
 * never pays for it.
 */
const buildTopology = () => {
  const coords: Array<{ q: number; r: number }> = []
  for (let q = -2; q <= 2; q += 1) {
    const minR = Math.max(-2, -q - 2)
    const maxR = Math.min(2, -q + 2)
    for (let r = minR; r <= maxR; r += 1) coords.push({ q, r })
  }
  coords.sort((a, b) => a.r - b.r || a.q - b.q)

  const vertices: BoardVertex[] = []
  const edges: Array<{ id: string; vertices: [string, string]; hexes: string[] }> = []
  const vertexByPoint = new Map<string, number>()
  const edgeByPair = new Map<string, number>()
  const hexes = coords.map(({ q, r }, index) => {
    const x = SQRT3 * (q + r / 2)
    const z = 1.5 * r
    const vertexIds: string[] = []
    for (let corner = 0; corner < 6; corner += 1) {
      const angle = ((60 * corner + 30) * Math.PI) / 180
      const vx = x + Math.cos(angle)
      const vz = z + Math.sin(angle)
      const key = pointKey(vx, vz)
      let slot = vertexByPoint.get(key)
      if (slot === undefined) {
        slot = vertices.length
        vertexByPoint.set(key, slot)
        vertices.push({ id: `v${slot}`, x: vx, z: vz, hexes: [], edges: [], neighbors: [] })
      }
      vertices[slot].hexes.push(`h${index}`)
      vertexIds.push(vertices[slot].id)
    }
    const edgeIds: string[] = []
    for (let side = 0; side < 6; side += 1) {
      const pair = [vertexIds[side], vertexIds[(side + 1) % 6]].sort() as [string, string]
      const key = pair.join(':')
      let slot = edgeByPair.get(key)
      if (slot === undefined) {
        slot = edges.length
        edgeByPair.set(key, slot)
        edges.push({ id: `e${slot}`, vertices: pair, hexes: [] })
        for (const vertexId of pair) vertices[Number(vertexId.slice(1))].edges.push(`e${slot}`)
        vertices[Number(pair[0].slice(1))].neighbors.push(pair[1])
        vertices[Number(pair[1].slice(1))].neighbors.push(pair[0])
      }
      edges[slot].hexes.push(`h${index}`)
      edgeIds.push(edges[slot].id)
    }
    return { id: `h${index}`, q, r, x, z, vertices: vertexIds, edges: edgeIds }
  })

  const byCoord = new Map(hexes.map((hex, index) => [`${hex.q}:${hex.r}`, index]))
  const neighbors = hexes.map((hex) => DIRECTIONS.flatMap(([dq, dr]) => {
    const slot = byCoord.get(`${hex.q + dq}:${hex.r + dr}`)
    return slot === undefined ? [] : [slot]
  }))
  const neighborIds = neighbors.map((slots) => slots.map((slot) => hexes[slot].id))
  // Six 60° wedges. The centre tile belongs to none of them.
  const sectors = hexes.map((hex) => ring(hex) === 0 ? -1 : ((Math.round(Math.atan2(hex.z, hex.x) / (Math.PI / 3)) % 6) + 6) % 6)
  const hexVertexSlots = hexes.map((hex) => hex.vertices.map((id) => Number(id.slice(1))))
  const vertexHexSlots = vertices.map((vertex) => vertex.hexes.map((id) => Number(id.slice(1))))
  const coast = edges
    .filter((edge) => edge.hexes.length === 1)
    .map((edge) => {
      const [one, two] = edge.vertices.map((id) => vertices[Number(id.slice(1))])
      return { id: edge.id, angle: Math.atan2((one.z + two.z) / 2, (one.x + two.x) / 2) }
    })
    .sort((a, b) => a.angle - b.angle)
    .map((edge) => edge.id)
  const centerSlot = hexes.findIndex((hex) => ring(hex) === 0)
  const edgeSlots = hexes.flatMap((hex, index) => ring(hex) === 2 ? [index] : [])

  return { hexes, vertices, edges, neighbors, neighborIds, sectors, hexVertexSlots, vertexHexSlots, coast, centerSlot, edgeSlots }
}

const TOPOLOGY = buildTopology()

type SolveHooks = {
  /** Return false to reject this assignment. Never called after a rejection. */
  assign: (slot: number, valueIndex: number) => boolean
  undo: (slot: number, valueIndex: number) => void
  /** Final acceptance test once every slot is filled. */
  complete: () => boolean
}

type SolveInput = {
  neighbors: number[][]
  counts: readonly number[]
  /** conflictMasks[v] is the bitmask of values that may not sit next to value v. */
  conflictMasks: Int32Array
  random: () => number
  nodeBudget: number
  pinned?: { slot: number; valueIndex: number }
  hooks?: SolveHooks
}

/**
 * Randomised backtracking with forward checking. Each unassigned hex keeps a bitmask of
 * values still legal beside its assigned neighbours; assigning a value strips the conflicting
 * bits from neighbouring domains and the search backtracks the moment a domain empties.
 * Hexes are chosen most-constrained-first; values are drawn in a count-weighted random order
 * so different seeds give genuinely different islands from the same solver.
 */
const solve = ({ neighbors, counts, conflictMasks, random, nodeBudget, pinned, hooks }: SolveInput) => {
  const slotCount = neighbors.length
  const valueCount = counts.length
  const fullMask = (1 << valueCount) - 1
  const remaining = Int32Array.from(counts)
  const domain = new Int32Array(slotCount).fill(fullMask)
  const assigned = new Int32Array(slotCount).fill(-1)
  // Each assignment can prune up to six neighbours, two Int32s apiece, so the stride is 12.
  const TRAIL_STRIDE = 12
  const trail = new Int32Array(slotCount * TRAIL_STRIDE)
  // One candidate window per recursion depth; a shared buffer would be clobbered by children.
  const choices = new Int32Array((slotCount + 1) * valueCount)
  let nodes = 0

  const apply = (slot: number, valueIndex: number) => {
    const mask = conflictMasks[valueIndex]
    let trailLength = 0
    const base = slot * TRAIL_STRIDE
    for (const neighbor of neighbors[slot]) {
      if (assigned[neighbor] >= 0) continue
      const removed = domain[neighbor] & mask
      if (!removed) continue
      domain[neighbor] &= ~removed
      trail[base + trailLength] = neighbor
      trail[base + trailLength + 1] = removed
      trailLength += 2
    }
    assigned[slot] = valueIndex
    remaining[valueIndex] -= 1
    return trailLength
  }

  const revert = (slot: number, valueIndex: number, trailLength: number) => {
    const base = slot * TRAIL_STRIDE
    for (let offset = 0; offset < trailLength; offset += 2) domain[trail[base + offset]] |= trail[base + offset + 1]
    assigned[slot] = -1
    remaining[valueIndex] += 1
  }

  const availableMask = () => {
    let mask = 0
    for (let index = 0; index < valueCount; index += 1) if (remaining[index] > 0) mask |= 1 << index
    return mask
  }

  const step = (depth: number): boolean => {
    nodes += 1
    if (nodes > nodeBudget) return false
    const available = availableMask()
    let target = -1
    let targetMask = 0
    let targetSize = valueCount + 1
    for (let slot = 0; slot < slotCount; slot += 1) {
      if (assigned[slot] >= 0) continue
      const mask = domain[slot] & available
      if (!mask) return false
      let size = 0
      for (let bits = mask; bits; bits &= bits - 1) size += 1
      if (size < targetSize) {
        target = slot
        targetMask = mask
        targetSize = size
        if (size === 1) break
      }
    }
    if (target < 0) return hooks ? hooks.complete() : true

    const window = depth * valueCount
    let choiceCount = 0
    let weight = 0
    for (let index = 0; index < valueCount; index += 1) {
      if (!(targetMask & (1 << index))) continue
      choices[window + choiceCount] = index
      choiceCount += 1
      weight += remaining[index]
    }
    while (choiceCount > 0) {
      let roll = random() * weight
      let picked = choiceCount - 1
      for (let index = 0; index < choiceCount; index += 1) {
        roll -= remaining[choices[window + index]]
        if (roll < 0) {
          picked = index
          break
        }
      }
      const valueIndex = choices[window + picked]
      weight -= remaining[valueIndex]
      choiceCount -= 1
      choices[window + picked] = choices[window + choiceCount]
      if (hooks && !hooks.assign(target, valueIndex)) continue
      const trailLength = apply(target, valueIndex)
      if (step(depth + 1)) return true
      revert(target, valueIndex, trailLength)
      hooks?.undo(target, valueIndex)
    }
    return false
  }

  if (pinned) {
    if (remaining[pinned.valueIndex] <= 0) return { assigned: undefined, nodes }
    if (hooks && !hooks.assign(pinned.slot, pinned.valueIndex)) return { assigned: undefined, nodes }
    apply(pinned.slot, pinned.valueIndex)
  }
  if (!step(0)) return { assigned: undefined, nodes }
  return { assigned, nodes }
}

type Solution = { assigned: Int32Array; nodes: number; attempts: number }

/** Runs a solve under restarts and reports the total work, so callers see one bounded search. */
const solveWithRestarts = (run: (nodeBudget: number) => { assigned: Int32Array | undefined; nodes: number }): Solution | undefined => {
  let nodes = 0
  for (let attempt = 1; attempt <= RESTART_LIMIT; attempt += 1) {
    const result = run(RESTART_NODE_CAP)
    nodes += result.nodes
    if (result.assigned) return { assigned: result.assigned, nodes, attempts: attempt }
  }
  const last = run(FINAL_NODE_BUDGET)
  nodes += last.nodes
  return last.assigned ? { assigned: last.assigned, nodes, attempts: RESTART_LIMIT + 1 } : undefined
}

const conflictMasksFor = <V>(values: readonly V[], conflicts: (left: V, right: V) => boolean) => {
  const masks = new Int32Array(values.length)
  for (let left = 0; left < values.length; left += 1) {
    for (let right = 0; right < values.length; right += 1) if (conflicts(values[left], values[right])) masks[left] |= 1 << right
  }
  return masks
}

const TERRAIN_MASKS = conflictMasksFor(TERRAINS, terrainConflict)
const NUMBER_MASKS = conflictMasksFor(NUMBERS, numberConflict)
const NUMBER_PIPS = NUMBERS.map((value) => pipsFor(value))

const isDesertPlacement = (value: unknown): value is DesertPlacement => value === 'random' || value === 'center' || value === 'edge'
const isHarborLayout = (value: unknown): value is HarborLayout => value === 'shuffled' || value === 'fixed'

/** Accepts anything and returns a complete, safe options record. Used on the wire. */
export const parseBoardOptions = (value: unknown): BoardOptions => {
  const defaults = defaultBoardOptions()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const input = value as Record<string, unknown>
  return {
    balancedPips: typeof input.balancedPips === 'boolean' ? input.balancedPips : defaults.balancedPips,
    desert: isDesertPlacement(input.desert) ? input.desert : defaults.desert,
    harbors: isHarborLayout(input.harbors) ? input.harbors : defaults.harbors,
  }
}

export const parseBoardSeed = (value: unknown): number | undefined => {
  const seed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xff_ff_ff_ff) return undefined
  return seed
}

/** Solves the numbers over a fixed terrain layout. `balancedPips` is propagated, not filtered. */
const solveNumbers = (productiveSlots: number[], balancedPips: boolean, random: () => number, nodeBudget: number) => {
  const slotOf = new Map(productiveSlots.map((hexSlot, index) => [hexSlot, index]))
  const neighbors = productiveSlots.map((hexSlot) => TOPOLOGY.neighbors[hexSlot].flatMap((neighbor) => {
    const slot = slotOf.get(neighbor)
    return slot === undefined ? [] : [slot]
  }))
  if (!balancedPips) return solve({ neighbors, counts: NUMBER_COUNTS, conflictMasks: NUMBER_MASKS, random, nodeBudget })

  const vertexPips = new Int32Array(TOPOLOGY.vertices.length)
  const sectorPips = new Int32Array(6)
  const sectorOpen = new Int32Array(6)
  for (const hexSlot of productiveSlots) {
    const sector = TOPOLOGY.sectors[hexSlot]
    if (sector >= 0) sectorOpen[sector] += 1
  }
  const sectorFloor = Int32Array.from(sectorOpen, (tiles) => tiles * SECTOR_PIPS_PER_TILE_FLOOR)
  const sectorCap = Int32Array.from(sectorOpen, (tiles) => tiles * SECTOR_PIPS_PER_TILE_CAP)
  // A wedge that can no longer reach the floor even if every tile it has left is a 6 or an 8
  // is dead, so the search abandons it immediately instead of discovering it at the leaf.
  const reachable = () => {
    for (let sector = 0; sector < 6; sector += 1) {
      if (sectorPips[sector] + sectorOpen[sector] * MAX_TILE_PIPS < sectorFloor[sector]) return false
    }
    return true
  }
  const hooks: SolveHooks = {
    assign: (slot, valueIndex) => {
      const hexSlot = productiveSlots[slot]
      const pips = NUMBER_PIPS[valueIndex]
      const sector = TOPOLOGY.sectors[hexSlot]
      if (sector >= 0 && sectorPips[sector] + pips > sectorCap[sector]) return false
      for (const vertex of TOPOLOGY.hexVertexSlots[hexSlot]) {
        if (vertexPips[vertex] + pips > VERTEX_PIP_CAP) return false
      }
      for (const vertex of TOPOLOGY.hexVertexSlots[hexSlot]) vertexPips[vertex] += pips
      if (sector >= 0) {
        sectorPips[sector] += pips
        sectorOpen[sector] -= 1
      }
      if (reachable()) return true
      hooks.undo(slot, valueIndex)
      return false
    },
    undo: (slot, valueIndex) => {
      const hexSlot = productiveSlots[slot]
      const pips = NUMBER_PIPS[valueIndex]
      for (const vertex of TOPOLOGY.hexVertexSlots[hexSlot]) vertexPips[vertex] -= pips
      const sector = TOPOLOGY.sectors[hexSlot]
      if (sector >= 0) {
        sectorPips[sector] -= pips
        sectorOpen[sector] += 1
      }
    },
    complete: () => {
      for (let sector = 0; sector < 6; sector += 1) if (sectorPips[sector] < sectorFloor[sector]) return false
      return true
    },
  }
  return solve({ neighbors, counts: NUMBER_COUNTS, conflictMasks: NUMBER_MASKS, random, nodeBudget, hooks })
}

export const createBoard = (seed = 1, options: BoardOptions = defaultBoardOptions()): Board => {
  const random = seededRandom(seed)

  const pinnedDesert = options.desert === 'random'
    ? undefined
    : options.desert === 'center'
      ? TOPOLOGY.centerSlot
      : TOPOLOGY.edgeSlots[Math.floor(random() * TOPOLOGY.edgeSlots.length)]
  const terrain = solveWithRestarts((nodeBudget) => solve({
    neighbors: TOPOLOGY.neighbors,
    counts: TERRAIN_COUNTS,
    conflictMasks: TERRAIN_MASKS,
    random,
    nodeBudget,
    pinned: pinnedDesert === undefined ? undefined : { slot: pinnedDesert, valueIndex: TERRAINS.indexOf('desert') },
  }))
  if (!terrain) throw new Error('No terrain layout satisfies the island invariants')

  const productiveSlots = TOPOLOGY.hexes.flatMap((_, slot) => TERRAINS[terrain.assigned[slot]] === 'desert' ? [] : [slot])
  const relaxed: BoardConstraint[] = []
  let attempts = terrain.attempts
  let numbers = solveWithRestarts((nodeBudget) => solveNumbers(productiveSlots, options.balancedPips, random, nodeBudget))
  if (!numbers && options.balancedPips) {
    // Documented fallback: keep every hard invariant, drop the one soft constraint, and
    // report it so the host is told the pips could not be balanced on this island.
    relaxed.push(...BOARD_CONSTRAINTS)
    numbers = solveWithRestarts((nodeBudget) => solveNumbers(productiveSlots, false, random, nodeBudget))
  }
  if (!numbers) throw new Error('No number layout satisfies the island invariants')
  attempts += numbers.attempts

  const numberBySlot = new Int32Array(TOPOLOGY.hexes.length).fill(-1)
  productiveSlots.forEach((hexSlot, index) => { numberBySlot[hexSlot] = NUMBERS[numbers.assigned[index]] })

  // Copies, not references: two boards from the same process must never share arrays.
  const vertices: Record<string, BoardVertex> = {}
  for (const vertex of TOPOLOGY.vertices) {
    vertices[vertex.id] = { id: vertex.id, x: vertex.x, z: vertex.z, hexes: [...vertex.hexes], edges: [...vertex.edges], neighbors: [...vertex.neighbors] }
  }
  const edges: Record<string, BoardEdge> = {}
  for (const edge of TOPOLOGY.edges) edges[edge.id] = { id: edge.id, vertices: [...edge.vertices] as [string, string], hexes: [...edge.hexes] }

  const hexes: HexTile[] = TOPOLOGY.hexes.map((hex, slot) => ({
    id: hex.id,
    q: hex.q,
    r: hex.r,
    x: hex.x,
    z: hex.z,
    terrain: TERRAINS[terrain.assigned[slot]],
    ...(numberBySlot[slot] > 0 ? { number: numberBySlot[slot] } : {}),
    vertices: [...hex.vertices],
    edges: [...hex.edges],
    neighbors: [...TOPOLOGY.neighborIds[slot]],
  }))

  const harborKinds = options.harbors === 'fixed'
    ? FIXED_HARBORS
    : shuffle([...RESOURCES, 'generic', 'generic', 'generic', 'generic'] as Array<Resource | 'generic'>, random)
  const harbors: Harbor[] = harborKinds.map((kind, index) => {
    const edgeId = TOPOLOGY.coast[Math.floor((index * TOPOLOGY.coast.length) / harborKinds.length)]
    const harbor: Harbor = { id: `port${index}`, edgeId, ratio: kind === 'generic' ? 3 : 2 }
    if (kind !== 'generic') harbor.resource = kind
    for (const vertexId of edges[edgeId].vertices) vertices[vertexId].harborId = harbor.id
    return harbor
  })

  const desert = hexes.find((hex) => hex.terrain === 'desert')
  if (!desert) throw new Error('Board requires a desert')
  return {
    hexes,
    vertices,
    edges,
    harbors,
    robberHexId: desert.id,
    generation: { seed, options, relaxed, attempts, nodes: terrain.nodes + numbers.nodes },
  }
}
