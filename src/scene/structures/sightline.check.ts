import assert from 'node:assert/strict'
import { createBoard } from '../../game/board'
import { BUILDING_PROFILE, buildingHeadroom, buildingSightScale } from './Buildings'

// A number token is game state, and a building standing at a hex corner sits
// partly over the tile behind it. The terrain now obeys a sight-line contract
// so no landform can bury a token; this asserts the pieces obey the same one,
// because with the ground clear the settlement and city walls were the next
// thing found clipping a neighbouring tile's number at grazing angles.
//
// Run across several boards, since which corners carry numbered neighbours
// changes with the layout.

let corners = 0
let clamped = 0
let worst = 1
for (const seed of [7, 28, 91, 404, 1337]) {
  const board = createBoard(seed)
  for (const vertex of Object.values(board.vertices)) {
    for (const type of ['settlement', 'city'] as const) {
      corners += 1
      const scale = buildingSightScale(board, vertex.id, type)
      const headroom = buildingHeadroom(board, vertex.id, type)
      assert.ok(
        BUILDING_PROFILE[type].top * scale <= headroom + 1e-9,
        `${type} at ${vertex.id} on seed ${seed} still reaches over its token cone`,
      )
      assert.ok(scale > 0.6, `${type} at ${vertex.id} on seed ${seed} would have to shrink past 0.6`)
      if (scale < 1) clamped += 1
      worst = Math.min(worst, scale)
    }
  }
}

console.log(`sight line: ${corners} building placements checked, ${clamped} clamped, worst scale ${worst.toFixed(3)}`)
