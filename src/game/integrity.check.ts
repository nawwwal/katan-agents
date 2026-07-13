import assert from 'node:assert/strict'
import { chooseSimulationAction } from './simulationPolicy'
import { applyAction, createGame, getPlayerView } from './engine'

const hiddenCardGame = createGame({ seed: 41, controllers: ['human', 'agent', 'agent'] })
hiddenCardGame.players[1].development = ['victory-point']
hiddenCardGame.players[1].boughtDevelopment = ['knight']
hiddenCardGame.players[1].resources = { brick: 1, lumber: 1, ore: 1, grain: 1, wool: 1 }

const hiddenCardView = getPlayerView(hiddenCardGame, 'p0')
const redacted = JSON.stringify(hiddenCardView)
assert.equal('seed' in hiddenCardView.publicState, false, 'the deterministic random seed must not be exposed to an agent')
assert.equal('privateRandomSeed' in hiddenCardView.publicState, false, 'the private random stream must not be exposed to an agent')
assert.equal(redacted.includes('knight'), false, 'opponent fresh development identity must stay private')
assert.equal(redacted.includes('victory-point'), false, 'opponent hidden victory card must stay private')
assert.equal(hiddenCardView.publicState.players[1].publicScore, 0, 'opponent hidden victory points must not alter public score')

const malformedTradeGame = createGame({ seed: 42, controllers: ['human', 'agent', 'agent'] })
malformedTradeGame.phase = 'action'
malformedTradeGame.activePlayerIndex = 0
malformedTradeGame.actingPlayerId = 'p0'
malformedTradeGame.players[1].resources.grain = 1
const malformedTrade = applyAction(malformedTradeGame, {
  type: 'offer-trade',
  trade: {
    fromPlayerId: 'p0',
    toPlayerId: 'p1',
    give: { brick: -1 },
    receive: { grain: 1 },
  },
})
assert.equal(malformedTrade.ok, false, 'negative domestic-trade amounts must be rejected')

const tradeGame = createGame({ seed: 44, controllers: ['human', 'agent', 'agent'] })
tradeGame.phase = 'action'
tradeGame.activePlayerIndex = 0
tradeGame.actingPlayerId = 'p0'
tradeGame.players[0].resources.brick = 1
tradeGame.players[1].resources.grain = 1
const offeredTrade = applyAction(tradeGame, {
  type: 'offer-trade',
  trade: { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { grain: 1 } },
})
assert.equal(offeredTrade.ok, true, 'a valid domestic offer should enter response state')
if (!offeredTrade.ok) throw new Error('expected offer state')
assert.equal(offeredTrade.state.phase, 'trade-response')
assert.equal(offeredTrade.state.actingPlayerId, 'p1')
assert.deepEqual(offeredTrade.events[0].trade, { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { grain: 1 } }, 'public trade events must retain exact terms for every player and spectator')
assert.deepEqual(getPlayerView(offeredTrade.state, 'p1').legalActions.slice(0, 2), [{ type: 'respond-trade', accept: true }, { type: 'respond-trade', accept: false }])
const acceptedTrade = applyAction(offeredTrade.state, { type: 'respond-trade', accept: true })
assert.equal(acceptedTrade.ok, true, 'an affordable domestic offer should be accepted')
if (!acceptedTrade.ok) throw new Error('expected accepted trade state')
assert.equal(acceptedTrade.state.phase, 'action')
assert.equal(acceptedTrade.state.actingPlayerId, 'p0')
assert.equal(acceptedTrade.state.players[0].resources.grain, 1)
assert.equal(acceptedTrade.state.players[1].resources.brick, 1)
assert.deepEqual(acceptedTrade.events[0].trade, { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { grain: 1 } })

const multiTradeGame = createGame({ seed: 46, controllers: ['human', 'agent', 'agent'] })
multiTradeGame.phase = 'action'
multiTradeGame.activePlayerIndex = 0
multiTradeGame.actingPlayerId = 'p0'
multiTradeGame.players[0].resources.brick = 2
multiTradeGame.players[0].resources.lumber = 1
multiTradeGame.players[1].resources.grain = 2
const multiOffer = applyAction(multiTradeGame, {
  type: 'offer-trade',
  trade: { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 2, lumber: 1 }, receive: { grain: 2 } },
})
assert.equal(multiOffer.ok, true, 'domestic offers must support multiple cards and resource types')
if (!multiOffer.ok) throw new Error('expected multi-card offer')
const multiAccepted = applyAction(multiOffer.state, { type: 'respond-trade', accept: true })
assert.equal(multiAccepted.ok, true)
if (!multiAccepted.ok) throw new Error('expected accepted multi-card offer')
assert.equal(multiAccepted.state.players[0].resources.grain, 2)
assert.equal(multiAccepted.state.players[1].resources.brick, 2)
assert.equal(multiAccepted.state.players[1].resources.lumber, 1)

const counterGame = createGame({ seed: 45, controllers: ['human', 'agent', 'agent'] })
counterGame.phase = 'action'
counterGame.activePlayerIndex = 0
counterGame.actingPlayerId = 'p0'
counterGame.players[0].resources.brick = 1
counterGame.players[0].resources.ore = 1
counterGame.players[1].resources.wool = 1
const firstOffer = applyAction(counterGame, { type: 'offer-trade', trade: { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { grain: 1 } } })
assert.equal(firstOffer.ok, true)
if (!firstOffer.ok) throw new Error('expected first offer')
const counterOffer = applyAction(firstOffer.state, { type: 'counter-trade', trade: { fromPlayerId: 'p1', toPlayerId: 'p0', give: { wool: 1 }, receive: { ore: 1 } } })
assert.equal(counterOffer.ok, true, 'the target should be able to make a counteroffer to the active player')
if (!counterOffer.ok) throw new Error('expected counteroffer')
assert.equal(counterOffer.state.actingPlayerId, 'p0')
const acceptedCounter = applyAction(counterOffer.state, { type: 'respond-trade', accept: true })
assert.equal(acceptedCounter.ok, true)
if (!acceptedCounter.ok) throw new Error('expected accepted counteroffer')
assert.equal(acceptedCounter.state.actingPlayerId, 'p0', 'the original active player must resume after any trade chain')
assert.equal(acceptedCounter.state.players[0].resources.wool, 1)
assert.equal(acceptedCounter.state.players[1].resources.ore, 1)

const monopolyGame = createGame({ seed: 43, controllers: ['agent', 'agent', 'agent'] })
monopolyGame.phase = 'monopoly'
monopolyGame.activePlayerIndex = 0
monopolyGame.actingPlayerId = 'p0'
monopolyGame.players[1].resources.ore = 3
monopolyGame.players[2].resources.ore = 2

const samePublicGame = structuredClone(monopolyGame)
samePublicGame.players[1].resources = { brick: 3, lumber: 0, ore: 0, grain: 0, wool: 0 }
samePublicGame.players[2].resources = { brick: 2, lumber: 0, ore: 0, grain: 0, wool: 0 }

assert.deepEqual(
  chooseSimulationAction(getPlayerView(monopolyGame, 'p0')),
  chooseSimulationAction(getPlayerView(samePublicGame, 'p0')),
  'simulation decisions must not change when only hidden opponent resource types change',
)

console.log('integrity check passed')
