/**
 * Tier 1: the rules questions, answered in memory.
 *
 * The engine is a pure reducer, so a thousand games cost a second and nothing
 * here needs a browser, a screenshot or a human. Everything in this file is a
 * question about state -- what is legal, what a seven takes, who the robber may
 * rob, whether the same seed replays to the same byte -- and no question of
 * that shape should ever be asked of a running app again.
 *
 * `simulation.check.ts` already plays 24 matches for resource conservation and
 * piece limits. This file covers what that one does not: turn flow, a turn
 * carrying several trades across bank, harbour and player, the discard-on-seven
 * arithmetic, robber and victim selection, determinism and replay, and the
 * bookkeeping invariants that have to hold across a whole match.
 */
import assert from 'node:assert/strict'
import { applyAction, createGame, currentActorId, getPlayerView, legalActionsForPlayer } from './engine'
import { chooseSimulationAction } from './simulationPolicy'
import { RESOURCES } from './types'
import type { GameAction, GameState, Resource } from './types'

const advance = (state: GameState, action: GameAction, why: string) => {
  const result = applyAction(state, action)
  assert.equal(result.ok, true, `${why}: ${result.ok ? '' : result.message}`)
  if (!result.ok) throw new Error(why)
  return result.state
}

const rejects = (state: GameState, action: GameAction, why: string) => {
  assert.equal(applyAction(state, action).ok, false, why)
}

/**
 * Roll a chosen pair. The `dice` field on the action is inert -- the engine
 * always draws its own -- so the only way to ask for a seven is to hand
 * `applyAction` the random source it would otherwise seed itself.
 */
const roll = (state: GameState, one: number, two: number, why: string) => {
  const values = [(one - 1) / 6 + 0.01, (two - 1) / 6 + 0.01]
  let index = 0
  const result = applyAction(state, { type: 'roll-dice' }, () => values[index++] ?? 0.5)
  assert.equal(result.ok, true, `${why}: ${result.ok ? '' : result.message}`)
  if (!result.ok) throw new Error(why)
  assert.deepEqual(result.state.lastRoll, [one, two], `${why}: the forced roll did not land`)
  return result.state
}

const totalCards = (state: GameState, playerId: string) =>
  RESOURCES.reduce((sum, resource) => sum + state.players.find((player) => player.id === playerId)!.resources[resource], 0)

const bankTotal = (state: GameState) => RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0)

/** Play the snake setup with the policy so every check starts from a real board. */
const afterSetup = (seed: number) => {
  let state = createGame({ seed, privateRandomSeed: seed * 31, controllers: ['human', 'agent', 'agent'] })
  for (let step = 0; step < 40 && state.phase.startsWith('setup'); step += 1) {
    const action = chooseSimulationAction(getPlayerView(state, currentActorId(state)))
    assert.ok(action, 'setup produced no legal action')
    state = advance(state, action!, 'setup')
  }
  assert.equal(state.phase, 'pre-roll', 'setup must end in pre-roll')
  return state
}

/* ------------------------------------------------------------- turn flow -- */

{
  const state = afterSetup(301)
  const first = currentActorId(state)
  assert.ok(state.players.every((player) => player.settlements.length === 2 && player.roads.length === 2), 'setup deals two settlements and two roads each')

  for (const player of state.players) {
    if (player.id === first) continue
    assert.equal(legalActionsForPlayer(state, player.id).length, 0, 'only the seat on the clock has legal actions')
  }
  rejects({ ...state }, { type: 'end-turn' }, 'a turn cannot end before the dice are rolled')

  const rolled = roll(state, 4, 5, 'roll nine')
  assert.equal(rolled.phase, 'action', 'a nine leaves the seat in its action phase')
  rejects(rolled, { type: 'roll-dice' }, 'a seat rolls once per turn')

  const ended = advance(rolled, { type: 'end-turn' }, 'end the turn')
  assert.equal(ended.phase, 'pre-roll', 'the next seat starts before the dice')
  assert.equal(ended.activePlayerIndex, (state.activePlayerIndex + 1) % state.players.length, 'the turn passes to the next seat in order')
  assert.notEqual(currentActorId(ended), first, 'the seat that ended is no longer on the clock')
  assert.equal(ended.revision, rolled.revision + 1, 'every accepted action advances the revision by one')
  console.log('qa: turn flow ok')
}

/* ---------------------------------------------------------------- trades -- */

{
  // One turn, four trades: bank at 4:1, a generic harbour at 3:1, a resource
  // harbour at 2:1, and a deal with another seat. The turn has to survive all
  // four and still be the same seat's action phase at the end.
  let state = afterSetup(302)
  const me = state.players[state.activePlayerIndex]
  const them = state.players.find((player) => player.id !== me.id)!
  const generic = state.board.harbors.find((harbor) => harbor.ratio === 3)!
  const specific = state.board.harbors.find((harbor) => harbor.ratio === 2)!
  const harbourResource = specific.resource as Resource
  me.ports = [generic.id, specific.id]
  me.resources = { brick: 6, lumber: 6, ore: 6, grain: 6, wool: 6 }
  me.resources[harbourResource] = 6
  them.resources = { brick: 3, lumber: 3, ore: 3, grain: 3, wool: 3 }
  state = roll(state, 4, 5, 'roll nine')

  const legal = legalActionsForPlayer(state, me.id)
  const ratesFor = (give: Resource) => new Set(legal
    .filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade' && action.give === give)
    .map((action) => action.ratio))
  assert.deepEqual([...ratesFor(harbourResource)].toSorted(), [2, 3, 4], 'a resource harbour supplements the 3:1 and 4:1 rates')
  const plain = RESOURCES.find((resource) => resource !== harbourResource)!
  assert.deepEqual([...ratesFor(plain)].toSorted(), [3, 4], 'a generic harbour supplements only the 4:1 rate')

  const bankBefore = bankTotal(state)
  const trade = (give: Resource, receive: Resource, ratio: 2 | 3 | 4) => {
    const before = { ...state.players.find((player) => player.id === me.id)!.resources }
    state = advance(state, { type: 'maritime-trade', give, receive, ratio }, `${ratio}:1 trade`)
    const after = state.players.find((player) => player.id === me.id)!.resources
    assert.equal(after[give], before[give] - ratio, `a ${ratio}:1 trade spends exactly ${ratio}`)
    assert.equal(after[receive], before[receive] + 1, `a ${ratio}:1 trade returns exactly one`)
    assert.equal(state.phase, 'action', 'trading does not end the turn')
    assert.equal(currentActorId(state), me.id, 'trading does not pass the turn')
  }
  // A different resource per rate, because a 4:1 leaves too little behind to
  // pay for the 3:1 that follows it.
  const spare = RESOURCES.filter((resource) => resource !== harbourResource)
  trade(spare[0], harbourResource, 4)
  trade(spare[1], harbourResource, 3)
  trade(harbourResource, spare[2], 2)
  assert.equal(bankTotal(state), bankBefore + (4 - 1) + (3 - 1) + (2 - 1), 'the bank keeps the difference on every maritime trade')

  // The fourth trade of the turn is with a seat, not the sea. Both halves are
  // taken from what the engine actually offers, so this keeps holding while the
  // trade surface is being reworked.
  const offer = legalActionsForPlayer(state, me.id)
    .find((action): action is Extract<GameAction, { type: 'offer-trade' }> => action.type === 'offer-trade' && action.trade.toPlayerId === them.id)
  assert.ok(offer, 'a seat with cards can offer a trade')
  const myGive = RESOURCES.find((resource) => (offer!.trade.give[resource] ?? 0) > 0)!
  const myReceive = RESOURCES.find((resource) => (offer!.trade.receive[resource] ?? 0) > 0)!
  const mineBefore = { ...state.players.find((player) => player.id === me.id)!.resources }
  const theirsBefore = { ...state.players.find((player) => player.id === them.id)!.resources }
  state = advance(state, offer!, 'offer a trade')
  assert.equal(state.phase, 'trade-response', 'an offer puts the table into a response')
  const answer = legalActionsForPlayer(state, them.id)
    .find((action) => (action.type === 'accept-trade') || (action.type === 'respond-trade' && action.accept))
  assert.ok(answer, 'the seat being offered to can accept')
  state = advance(state, answer!, 'accept the trade')
  const mineAfter = state.players.find((player) => player.id === me.id)!.resources
  const theirsAfter = state.players.find((player) => player.id === them.id)!.resources
  assert.equal(mineAfter[myGive], mineBefore[myGive] - (offer!.trade.give[myGive] ?? 0), 'the offering seat hands over what it offered')
  assert.equal(mineAfter[myReceive], mineBefore[myReceive] + (offer!.trade.receive[myReceive] ?? 0), 'the offering seat receives what it asked for')
  assert.equal(theirsAfter[myGive], theirsBefore[myGive] + (offer!.trade.give[myGive] ?? 0), 'the accepting seat receives what was offered')
  assert.equal(theirsAfter[myReceive], theirsBefore[myReceive] - (offer!.trade.receive[myReceive] ?? 0), 'the accepting seat hands over what was asked')
  assert.equal(state.phase, 'action', 'an accepted trade returns the turn to its owner')
  assert.equal(currentActorId(state), me.id, 'a player trade does not pass the turn')
  console.log('qa: four trades in one turn ok')
}

/* ------------------------------------------------------------ the seven -- */

{
  let state = afterSetup(303)
  const [a, b, c] = state.players
  // Eight, nine and fifteen cards. Half, rounded down, and only over seven.
  a.resources = { brick: 2, lumber: 2, ore: 2, grain: 2, wool: 0 }
  b.resources = { brick: 3, lumber: 2, ore: 2, grain: 1, wool: 1 }
  c.resources = { brick: 3, lumber: 3, ore: 3, grain: 3, wool: 3 }
  const held = [8, 9, 15]
  state.players.forEach((player, index) => assert.equal(totalCards(state, player.id), held[index], 'the fixture deals the hand it meant to'))

  const bankBefore = bankTotal(state)
  state = roll(state, 3, 4, 'roll a seven')
  assert.equal(state.phase, 'discard', 'a seven with full hands opens the discard')
  assert.deepEqual(state.discardRemaining, { [a.id]: 4, [b.id]: 4, [c.id]: 7 }, 'a seven takes half of every hand over seven, rounded down')

  let guard = 0
  while (state.phase === 'discard' && guard < 6) {
    guard += 1
    const actor = state.actingPlayerId!
    const discard = legalActionsForPlayer(state, actor).find((action) => action.type === 'discard')
    assert.ok(discard, 'a seat that owes cards is given a discard to make')
    rejects(state, { type: 'end-turn' }, 'nothing else happens while cards are owed')
    state = advance(state, discard!, 'discard')
  }
  assert.equal(state.phase, 'move-robber', 'the robber moves once every hand is legal again')
  assert.deepEqual(state.discardRemaining, {}, 'no debt survives the discard')
  assert.equal(bankTotal(state), bankBefore + 4 + 4 + 7, 'discarded cards return to the bank')
  // Fifteen cards owes seven and keeps eight; the rule is half rounded down,
  // not "down to seven".
  state.players.forEach((player, index) => assert.equal(totalCards(state, player.id), held[index] - Math.floor(held[index] / 2) * (held[index] > 7 ? 1 : 0), 'each hand loses exactly what it owed'))

  // A hand of exactly seven is safe, and a table with no full hands skips
  // straight to the robber.
  let light = afterSetup(304)
  for (const player of light.players) player.resources = { brick: 2, lumber: 2, ore: 1, grain: 1, wool: 1 }
  light = roll(light, 3, 4, 'roll a seven on light hands')
  assert.equal(light.phase, 'move-robber', 'seven cards is not too many')
  console.log('qa: discard-on-seven ok')
}

/* ------------------------------------------------------- robber and prey -- */

{
  let state = afterSetup(305)
  state = roll(state, 3, 4, 'roll a seven')
  while (state.phase === 'discard') {
    const discard = legalActionsForPlayer(state, state.actingPlayerId!).find((action) => action.type === 'discard')!
    state = advance(state, discard, 'discard')
  }
  assert.equal(state.phase, 'move-robber', 'a seven ends at the robber')
  const thief = currentActorId(state)
  rejects(state, { type: 'move-robber', hexId: state.board.robberHexId }, 'the robber has to go somewhere new')
  rejects(state, { type: 'move-robber', hexId: 'not-a-hex' }, 'the robber only stands on real tiles')
  assert.equal(
    legalActionsForPlayer(state, thief).some((action) => action.type === 'move-robber' && action.hexId === state.board.robberHexId),
    false,
    'the tile the robber is on is never offered',
  )

  // A tile with somebody else's building on it, so the victim list is real.
  const target = state.board.hexes.find((hex) => hex.id !== state.board.robberHexId
    && hex.vertices.some((vertexId) => state.buildings[vertexId] && state.buildings[vertexId].playerId !== thief))!
  const expected = new Set(target.vertices
    .map((vertexId) => state.buildings[vertexId]?.playerId)
    .filter((playerId): playerId is string => Boolean(playerId) && playerId !== thief))
  const moved = advance(state, { type: 'move-robber', hexId: target.id }, 'move the robber')
  assert.equal(moved.board.robberHexId, target.id, 'the robber ends on the tile it was sent to')
  assert.deepEqual(new Set(moved.robberVictims), expected, 'every adjacent owner but the thief is a candidate, once each')
  assert.equal(moved.robberVictims.includes(thief), false, 'nobody robs themselves')
  assert.equal(moved.phase, 'choose-victim', 'a tile with neighbours asks who to rob')

  const victim = moved.robberVictims[0]
  const outsider = moved.players.find((player) => player.id !== thief && !moved.robberVictims.includes(player.id))
  if (outsider) rejects(moved, { type: 'steal-from', playerId: outsider.id }, 'only a seat built beside the tile can be robbed')
  const victimBefore = totalCards(moved, victim)
  const thiefBefore = totalCards(moved, thief)
  const stolen = advance(moved, { type: 'steal-from', playerId: victim }, 'steal a card')
  const moves = victimBefore > 0 ? 1 : 0
  assert.equal(totalCards(stolen, victim), victimBefore - moves, 'a robbery takes exactly one card, or none from an empty hand')
  assert.equal(totalCards(stolen, thief), thiefBefore + moves, 'the card the victim lost is the card the thief gained')
  assert.deepEqual(stolen.robberVictims, [], 'the victim list is cleared once someone is robbed')
  assert.equal(stolen.phase, 'action', 'the turn resumes after the robbery')
  assert.equal(currentActorId(stolen), thief, 'the robbery does not pass the turn')

  // An empty tile robs nobody and hands the turn straight back.
  const empty = state.board.hexes.find((hex) => hex.id !== state.board.robberHexId && hex.vertices.every((vertexId) => !state.buildings[vertexId]))
  if (empty) {
    const quiet = advance(state, { type: 'move-robber', hexId: empty.id }, 'move the robber to an empty tile')
    assert.deepEqual(quiet.robberVictims, [], 'an empty tile offers no victims')
    assert.equal(quiet.phase, 'action', 'an empty tile returns the turn without a choice')
  }
  console.log('qa: robber and victim selection ok')
}

/* -------------------------------------------------- determinism, replay -- */

const playMatch = (seed: number) => {
  let state = createGame({ seed, privateRandomSeed: seed * 7919, controllers: ['agent', 'agent', 'agent'] })
  const script: GameAction[] = []
  for (let step = 0; step < 3_000 && state.phase !== 'game-over'; step += 1) {
    const action = chooseSimulationAction(getPlayerView(state, currentActorId(state)))
    assert.ok(action, `seed ${seed} stalled in ${state.phase}`)
    script.push(action!)
    state = advance(state, action!, `seed ${seed} ${action!.type}`)
  }
  return { state, script }
}

const replay = (seed: number, script: GameAction[]) => {
  let state = createGame({ seed, privateRandomSeed: seed * 7919, controllers: ['agent', 'agent', 'agent'] })
  for (const action of script) state = advance(state, action, `replay ${action.type}`)
  return state
}

{
  const seed = 306
  const first = playMatch(seed)
  const second = playMatch(seed)
  assert.equal(JSON.stringify(first.script), JSON.stringify(second.script), 'the same seed produces the same match')
  assert.equal(JSON.stringify(first.state), JSON.stringify(second.state), 'the same seed ends in the same state')
  assert.equal(JSON.stringify(replay(seed, first.script)), JSON.stringify(first.state), 'replaying the action log reproduces the state exactly')

  const different = playMatch(seed + 1)
  assert.notEqual(JSON.stringify(different.state.board), JSON.stringify(first.state.board), 'a different seed deals a different island')
  console.log(`qa: determinism and replay ok over ${first.script.length} actions`)
}

/* ------------------------------------------------- whole-match invariants -- */

{
  let matches = 0
  let actions = 0
  for (let seed = 401; seed <= 404; seed += 1) {
    let state = createGame({ seed, privateRandomSeed: seed * 104_729, controllers: ['agent', 'agent', 'agent', 'agent'] })
    const deckStart = state.developmentDeck.length
    let bought = 0
    let played = 0
    let knightsPlayed = 0
    let revision = state.revision
    for (let step = 0; step < 3_000 && state.phase !== 'game-over'; step += 1) {
      const actor = currentActorId(state)
      assert.ok(state.legalActions.length, `seed ${seed} offered nothing to do in ${state.phase}`)
      const action = chooseSimulationAction(getPlayerView(state, actor))
      assert.ok(action, `seed ${seed} could not resolve ${state.phase}`)
      if (action!.type === 'buy-development') bought += 1
      if (action!.type === 'play-development') {
        played += 1
        if (action!.card === 'knight') knightsPlayed += 1
      }
      state = advance(state, action!, `seed ${seed} ${action!.type}`)
      actions += 1
      assert.equal(state.revision, revision + 1, `seed ${seed} skipped a revision`)
      revision = state.revision

      // The board and the players never disagree about who owns what.
      const buildings = Object.entries(state.buildings)
      assert.equal(buildings.length, state.players.reduce((sum, player) => sum + player.settlements.length + player.cities.length, 0), `seed ${seed} lost a building`)
      for (const [vertexId, building] of buildings) {
        const owner = state.players.find((player) => player.id === building.playerId)!
        const list = building.type === 'city' ? owner.cities : owner.settlements
        assert.ok(list.includes(vertexId), `seed ${seed} has a ${building.type} the owner does not know about`)
      }
      assert.equal(Object.keys(state.roadOwners).length, state.players.reduce((sum, player) => sum + player.roads.length, 0), `seed ${seed} lost a road`)
      assert.ok(state.board.hexes.some((hex) => hex.id === state.board.robberHexId), `seed ${seed} put the robber off the island`)

      // Development cards are conserved: what left the deck is held or has been played.
      const held = state.players.reduce((sum, player) => sum + player.development.length, 0)
      assert.equal(deckStart - state.developmentDeck.length, bought, `seed ${seed} drew a card the deck did not have`)
      assert.equal(held, bought - played, `seed ${seed} lost track of a development card`)
      assert.equal(state.players.reduce((sum, player) => sum + player.playedKnights, 0), knightsPlayed, `seed ${seed} miscounted knights`)

      // Awards only ever sit with a seat that has actually earned them.
      if (state.largestArmy) {
        const holder = state.players.find((player) => player.id === state.largestArmy!.playerId)!
        assert.equal(holder.playedKnights, state.largestArmy.size, `seed ${seed} gave Largest Army the wrong size`)
        assert.ok(state.largestArmy.size >= 3, `seed ${seed} gave Largest Army away below three knights`)
      }
      if (state.longestRoad) {
        assert.ok(state.longestRoad.length >= 5, `seed ${seed} gave Longest Road away below five`)
        assert.ok(state.players.some((player) => player.id === state.longestRoad!.playerId), `seed ${seed} gave Longest Road to nobody`)
      }
      if (state.phase !== 'discard') {
        for (const player of state.players) assert.ok(RESOURCES.every((resource) => player.resources[resource] >= 0), `seed ${seed} went negative`)
      }
    }
    assert.equal(state.phase, 'game-over', `seed ${seed} never finished`)
    assert.ok(state.winnerId, `seed ${seed} finished without a winner`)
    matches += 1
  }
  console.log(`qa: ${matches} four-player matches held every invariant across ${actions} actions`)
}

console.log('qa rules check passed')
