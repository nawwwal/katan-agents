import assert from 'node:assert/strict'
import { applyAction, createGame, scorePlayer } from './engine'

let game = createGame({ seed: 11, controllers: ['human', 'agent', 'agent'] })
assert.equal(game.phase, 'setup-settlement')

for (let step = 0; step < 12; step += 1) {
  const action = game.legalActions[0]
  assert.ok(action)
  const result = applyAction(game, action)
  assert.equal(result.ok, true)
  if (result.ok) game = result.state
}

assert.equal(game.phase, 'pre-roll')
assert.equal(game.players.every((player) => player.settlements.length === 2 && player.roads.length === 2), true)
assert.equal(game.players.reduce((total, player) => total + Object.values(player.resources).reduce((sum, n) => sum + n, 0), 0) > 0, true)

const roll = applyAction(game, { type: 'roll-dice' })
assert.equal(roll.ok, true)
if (roll.ok) game = roll.state
assert.ok(['action', 'discard', 'move-robber'].includes(game.phase))
assert.equal(scorePlayer(game, game.players[0].id) >= 2, true)

console.log(`engine check passed: phase=${game.phase}, revision=${game.revision}`)
