import assert from 'node:assert/strict'
import { chooseSimulationAction } from './simulationPolicy'
import { applyAction, createGame, currentActorId, getPlayerView, scorePlayer } from './engine'
import { RESOURCES } from './types'

let matches = 0
let actions = 0

for (const playerCount of [3, 4] as const) {
  for (let seed = 101; seed <= 112; seed += 1) {
    let game = createGame({
      seed,
      privateRandomSeed: seed * 7919,
      controllers: Array(playerCount).fill('agent'),
    })
    for (let step = 0; step < 2_000 && game.phase !== 'game-over'; step += 1) {
      const actorId = currentActorId(game)
      assert.ok(game.legalActions.length, `seed ${seed} reached ${game.phase} without a legal action`)
      const action = chooseSimulationAction(getPlayerView(game, actorId))
      assert.ok(action, `seed ${seed} simulation could not resolve ${game.phase}`)
      const result = applyAction(game, action)
      assert.equal(result.ok, true, `seed ${seed} rejected ${action.type} during ${game.phase}`)
      if (!result.ok) break
      game = result.state
      actions += 1
      for (const resource of RESOURCES) {
        const total = game.bank[resource] + game.players.reduce((sum, player) => sum + player.resources[resource], 0)
        assert.equal(total, 19, `seed ${seed} lost ${resource} conservation at revision ${game.revision}`)
        assert.ok(game.players.every((player) => player.resources[resource] >= 0), `seed ${seed} created negative ${resource}`)
      }
      assert.ok(game.players.every((player) => player.roads.length <= 15 && player.settlements.length <= 5 && player.cities.length <= 4), `seed ${seed} exceeded a piece limit`)
    }
    assert.equal(game.phase, 'game-over', `seed ${seed} did not finish within 2,000 actions`)
    assert.ok(game.winnerId)
    assert.ok(scorePlayer(game, game.winnerId!) >= 10)
    matches += 1
  }
}

console.log(`simulation check passed: ${matches} complete 3/4-player matches, ${actions} validated actions`)
