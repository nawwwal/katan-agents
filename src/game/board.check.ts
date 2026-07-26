import assert from 'node:assert/strict'
import { createBoard, numberConflict, pipsFor, terrainConflict } from './board'
import { defaultBoardOptions } from './types'
import type { Board, BoardOptions, Terrain } from './types'

const SWEEP = 600
const TERRAIN_TALLY: Array<[Terrain, number]> = [['lumber', 4], ['wool', 4], ['grain', 4], ['brick', 3], ['ore', 3], ['desert', 1]]
const NUMBER_MULTISET = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
const ringOf = (hex: { q: number; r: number }) => Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r))
const sectorOf = (hex: { q: number; r: number; x: number; z: number }) =>
  ringOf(hex) === 0 ? -1 : ((Math.round(Math.atan2(hex.z, hex.x) / (Math.PI / 3)) % 6) + 6) % 6

const optionSets: Array<[string, BoardOptions]> = [
  ['defaults', defaultBoardOptions()],
  ['pips off', { balancedPips: false, desert: 'random', harbors: 'shuffled' }],
  ['centre desert', { balancedPips: true, desert: 'center', harbors: 'fixed' }],
  ['edge desert', { balancedPips: true, desert: 'edge', harbors: 'shuffled' }],
  ['fixed harbours', { balancedPips: true, desert: 'random', harbors: 'fixed' }],
]

/** Topology is canonical and must never move, whatever the seed or the options. */
const assertTopology = (board: Board, label: string) => {
  assert.equal(board.hexes.length, 19, label)
  assert.equal(Object.keys(board.vertices).length, 54, label)
  assert.equal(Object.keys(board.edges).length, 72, label)
  assert.equal(board.harbors.length, 9, label)
  for (const edge of Object.values(board.edges)) {
    assert.equal(edge.vertices.length, 2, label)
    for (const vertexId of edge.vertices) assert.ok(board.vertices[vertexId].edges.includes(edge.id), label)
  }
  for (const harbor of board.harbors) assert.ok(board.edges[harbor.edgeId], label)
}

/** The four hard invariants. Not options, never relaxed, no seed may violate them. */
const assertInvariants = (board: Board, label: string) => {
  const byId = new Map(board.hexes.map((hex) => [hex.id, hex]))
  for (const hex of board.hexes) {
    for (const neighborId of hex.neighbors) {
      const neighbor = byId.get(neighborId)
      assert.ok(neighbor, label)
      assert.equal(terrainConflict(hex.terrain, neighbor.terrain), false, `${label}: ${hex.terrain} touches ${hex.id}/${neighbor.id}`)
      if (hex.number === undefined || neighbor.number === undefined) continue
      assert.equal(numberConflict(hex.number, neighbor.number), false, `${label}: ${hex.number} touches ${neighbor.number} at ${hex.id}/${neighbor.id}`)
    }
  }
}

/** 19 tiles, one desert, the printed terrain tally and the printed number multiset. */
const assertLegalCatan = (board: Board, label: string) => {
  for (const [terrain, count] of TERRAIN_TALLY) {
    assert.equal(board.hexes.filter((hex) => hex.terrain === terrain).length, count, `${label}: ${terrain} count`)
  }
  const numbers = board.hexes.flatMap((hex) => hex.number === undefined ? [] : [hex.number]).sort((a, b) => a - b)
  assert.deepEqual(numbers, NUMBER_MULTISET, label)
  assert.equal(board.hexes.find((hex) => hex.terrain === 'desert')?.number, undefined, label)
  assert.equal(board.robberHexId, board.hexes.find((hex) => hex.terrain === 'desert')?.id, label)
  const kinds = board.harbors.map((harbor) => harbor.resource ?? 'generic').sort()
  assert.deepEqual(kinds, ['brick', 'generic', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool'], label)
}

let maxNodes = 0
let relaxedBoards = 0
for (const [label, options] of optionSets) {
  for (let seed = 0; seed < SWEEP; seed += 1) {
    const board = createBoard(seed, options)
    assertTopology(board, `${label}#${seed}`)
    assertInvariants(board, `${label}#${seed}`)
    assertLegalCatan(board, `${label}#${seed}`)
    maxNodes = Math.max(maxNodes, board.generation.nodes)
    if (board.generation.relaxed.length) relaxedBoards += 1

    const desert = board.hexes.find((hex) => hex.terrain === 'desert')!
    if (options.desert === 'center') assert.equal(ringOf(desert), 0, `${label}#${seed}: desert should be central`)
    if (options.desert === 'edge') assert.equal(ringOf(desert), 2, `${label}#${seed}: desert should be coastal`)

    if (options.balancedPips && !board.generation.relaxed.includes('balancedPips')) {
      for (const vertex of Object.values(board.vertices)) {
        const total = vertex.hexes.reduce((sum, id) => sum + pipsFor(board.hexes.find((hex) => hex.id === id)?.number), 0)
        assert.ok(total <= 12, `${label}#${seed}: intersection ${vertex.id} carries ${total} pips`)
      }
      const sectors = [0, 0, 0, 0, 0, 0]
      const tiles = [0, 0, 0, 0, 0, 0]
      for (const hex of board.hexes) {
        const sector = sectorOf(hex)
        if (sector < 0) continue
        sectors[sector] += pipsFor(hex.number)
        if (hex.terrain !== 'desert') tiles[sector] += 1
      }
      for (let sector = 0; sector < 6; sector += 1) {
        assert.ok(sectors[sector] >= tiles[sector] * 2, `${label}#${seed}: wedge ${sector} starved at ${sectors[sector]}`)
        assert.ok(sectors[sector] <= tiles[sector] * 4, `${label}#${seed}: wedge ${sector} overloaded at ${sectors[sector]}`)
      }
    }
  }
}

// Restarts should keep total search work tiny; the bounded worst case is 209,600 nodes.
assert.ok(maxNodes < 10_000, `search explored ${maxNodes} nodes, far more than restarts should need`)
assert.equal(relaxedBoards, 0, `${relaxedBoards} boards had to drop balancedPips`)

// Determinism: same seed plus same options is byte-identical, and the options change the board.
for (const [label, options] of optionSets) {
  for (const seed of [0, 7, 28, 1_234, 0xff_ff_ff_ff]) {
    assert.deepEqual(createBoard(seed, options), createBoard(seed, options), `${label}#${seed} is not reproducible`)
  }
}
assert.notDeepEqual(
  createBoard(28, defaultBoardOptions()).hexes.map((hex) => hex.terrain),
  createBoard(29, defaultBoardOptions()).hexes.map((hex) => hex.terrain),
  'different seeds should give different islands',
)
assert.notDeepEqual(
  createBoard(28, { balancedPips: true, desert: 'random', harbors: 'fixed' }).harbors,
  createBoard(28, { balancedPips: true, desert: 'random', harbors: 'shuffled' }).harbors,
  'harbour layout should respond to its option',
)

// Shuffle is an interactive control, so generation has to stay in single-digit milliseconds.
for (let seed = 0; seed < 200; seed += 1) createBoard(seed, defaultBoardOptions())
const timings: number[] = []
for (let seed = 0; seed < 2_000; seed += 1) {
  const started = performance.now()
  createBoard(seed, defaultBoardOptions())
  timings.push(performance.now() - started)
}
timings.sort((a, b) => a - b)
const median = timings[Math.floor(timings.length / 2)]
const p99 = timings[Math.floor(timings.length * 0.99)]
const slowest = timings[timings.length - 1]
assert.ok(p99 < 5, `p99 generation took ${p99.toFixed(2)}ms`)
assert.ok(slowest < 20, `slowest generation took ${slowest.toFixed(2)}ms`)

console.log(`board check passed: ${optionSets.length * SWEEP} boards across ${optionSets.length} option sets, four adjacency invariants held, legal Catan multisets, deterministic per seed, max ${maxNodes} search nodes, generation median ${median.toFixed(3)}ms / p99 ${p99.toFixed(3)}ms / max ${slowest.toFixed(3)}ms`)
