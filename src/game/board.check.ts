import assert from 'node:assert/strict'
import { createBoard } from './board'

const board = createBoard(7)

assert.equal(board.hexes.length, 19)
assert.equal(Object.keys(board.vertices).length, 54)
assert.equal(Object.keys(board.edges).length, 72)
assert.equal(board.hexes.filter((hex) => hex.terrain === 'desert').length, 1)

const numbers = board.hexes.flatMap((hex) => (hex.number ? [hex.number] : [])).sort((a, b) => a - b)
assert.deepEqual(numbers, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12])

for (const edge of Object.values(board.edges)) {
  assert.equal(edge.vertices.length, 2)
  for (const vertexId of edge.vertices) assert.ok(board.vertices[vertexId].edges.includes(edge.id))
}

for (const hex of board.hexes.filter((tile) => tile.number === 6 || tile.number === 8)) {
  for (const neighborId of hex.neighbors) {
    const neighbor = board.hexes.find((tile) => tile.id === neighborId)
    assert.notEqual(neighbor?.number, hex.number === 6 ? 8 : 6)
  }
}

console.log(`board check passed: ${board.hexes.length} hexes, ${Object.keys(board.vertices).length} vertices, ${Object.keys(board.edges).length} edges`)
