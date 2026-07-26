import assert from 'node:assert/strict'
import { chooseSimulationAction } from './simulationPolicy'
import { applyAction, createGame, getPlayerView, legalActionsForPlayer, playerColorForSeat } from './engine'
import { parsePlayerAction, seatsWithColor } from './room'
import type { GameAction, GameState } from './types'

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

/* ------------------------------------------------- trading more than once -- */

const tableAt = (seed: number, seats = 3) => {
  const state = createGame({ seed, controllers: Array<'agent'>(seats).fill('agent') })
  state.phase = 'action'
  state.activePlayerIndex = 0
  state.actingPlayerId = 'p0'
  state.lastRoll = [3, 4]
  return state
}
const play = (state: GameState, action: GameAction, label: string) => {
  const result = applyAction(state, action)
  assert.equal(result.ok, true, `${label}: ${result.ok ? '' : result.message}`)
  if (!result.ok) throw new Error(label)
  return result.state
}
const offerLegal = (state: GameState, playerId = 'p0') =>
  legalActionsForPlayer(state, playerId).some((action) => action.type === 'offer-trade')

// Catan lets you trade as often as you like on your own turn, in any mix of bank,
// harbour and player. This walks eight trades through one turn and checks the
// engine never closes the door, and that every answer is separately identifiable.
const manyTrades = tableAt(211)
const harbor = manyTrades.board.harbors.find((candidate) => candidate.ratio === 3)!
manyTrades.players[0].ports = [harbor.id]
// Fourteen brick pays for two 4:1 bank trades and two 3:1 harbour trades; the ore
// comes off the rivals. Everything is taken out of the bank so the 19-card supply
// still balances.
manyTrades.players[0].resources = { brick: 14, lumber: 0, ore: 0, grain: 0, wool: 0 }
manyTrades.players[1].resources = { brick: 0, lumber: 0, ore: 4, grain: 0, wool: 0 }
manyTrades.players[2].resources = { brick: 0, lumber: 0, ore: 4, grain: 0, wool: 0 }
manyTrades.bank.brick -= 14
manyTrades.bank.ore -= 8

let table = manyTrades
const resolutions: number[] = []
for (const [index, partner] of ['p1', 'p2', 'p1', 'p2'].entries()) {
  // bank at 4:1, then the harbour at 3:1, then a player, over and over
  table = play(table, { type: 'maritime-trade', give: 'brick', receive: 'grain', ratio: index % 2 ? 3 : 4 }, `bank trade ${index}`)
  assert.equal(table.phase, 'action', 'a bank trade never leaves the action phase')
  assert.equal(offerLegal(table), true, 'a bank trade must not retire player trading')
  table = play(table, { type: 'offer-trade', trade: { fromPlayerId: 'p0', toPlayerId: partner, give: { grain: 1 }, receive: { ore: 1 } } }, `offer ${index}`)
  assert.equal(table.phase, 'trade-response')
  table = play(table, { type: 'respond-trade', accept: true }, `accept ${index}`)
  assert.equal(table.phase, 'action', 'an answered trade hands the turn straight back')
  assert.equal(table.actingPlayerId, 'p0')
  assert.equal(table.pendingTrade, undefined, 'a settled offer leaves nothing pending')
  assert.equal(table.tradeOffer, undefined, 'a settled offer leaves nothing on the table')
  assert.equal(table.tradeResolution?.outcome, 'accepted')
  assert.equal(table.tradeResolution?.acceptedBy, partner)
  resolutions.push(table.tradeResolution!.id)
  assert.equal(offerLegal(table), true, `trade ${index + 1} must not be the last one this turn`)
}
assert.deepEqual(resolutions, [...resolutions].toSorted((a, b) => a - b), 'offer ids only ever climb')
assert.equal(new Set(resolutions).size, resolutions.length, 'no two answers in a turn share an id')
assert.equal(table.players[0].resources.ore, 4, 'four player trades landed four ore')
assert.equal(legalActionsForPlayer(table, 'p0').some((action) => action.type === 'end-turn'), true)

// The bug the client hit: nothing about a completed trade may look like a live one.
const afterAccept = table
assert.equal(afterAccept.tradeResolution!.id < afterAccept.nextTradeId, true, 'the last answer always names an offer that is already closed')
assert.equal(afterAccept.tradeOffer, undefined)

/* ------------------------------------------------------- broadcast offers -- */

const broadcast = tableAt(212, 4)
broadcast.players[0].resources = { brick: 2, lumber: 0, ore: 0, grain: 0, wool: 0 }
for (const seat of [1, 2, 3]) broadcast.players[seat].resources = { brick: 0, lumber: 0, ore: 2, grain: 0, wool: 0 }
const opened = play(broadcast, { type: 'broadcast-trade', trade: { fromPlayerId: 'p0', give: { brick: 1 }, receive: { ore: 1 } } }, 'broadcast')
assert.deepEqual(opened.tradeOffer?.toPlayerIds, ['p1', 'p2', 'p3'], 'a broadcast offer is open to every rival at once')
assert.equal(opened.pendingTrade?.toPlayerId, 'p1', 'the old one-target field points at whoever is on the clock')
for (const seat of ['p1', 'p2', 'p3']) {
  const actions = legalActionsForPlayer(opened, seat)
  assert.equal(actions.some((action) => action.type === 'accept-trade' && action.playerId === seat), true, `${seat} can take a broadcast offer`)
  assert.equal(actions.some((action) => action.type === 'decline-trade' && action.playerId === seat), true, `${seat} can refuse a broadcast offer`)
}
assert.deepEqual(legalActionsForPlayer(opened, 'p0'), [{ type: 'withdraw-trade', offerId: opened.tradeOffer!.id, playerId: 'p0' }], 'the offerer can only take it back')

// Two seats reach for the same offer. The engine is a reducer over one ordered
// stream, so the first one applied wins and the second is told plainly.
const offerId = opened.tradeOffer!.id
const firstAccept = play(opened, { type: 'accept-trade', offerId, playerId: 'p2' }, 'p2 accepts first')
assert.equal(firstAccept.tradeResolution?.acceptedBy, 'p2')
assert.equal(firstAccept.players[2].resources.brick, 1)
const lateAccept = applyAction(firstAccept, { type: 'accept-trade', offerId, playerId: 'p1' })
assert.equal(lateAccept.ok, false, 'a second acceptance of a settled offer is refused')
assert.equal(lateAccept.ok === false && lateAccept.message.includes('already settled'), true)
assert.equal(firstAccept.players[1].resources.ore, 2, 'the seat that lost the race keeps its cards')
// A stale client that replays the winner's own acceptance is refused the same way.
assert.equal(applyAction(firstAccept, { type: 'accept-trade', offerId, playerId: 'p2' }).ok, false)

// Every rival refusing the same bundle is a state the engine knows, not one the
// interface has to add up.
let refused = play(broadcast, { type: 'broadcast-trade', trade: { fromPlayerId: 'p0', give: { brick: 1 }, receive: { ore: 1 } } }, 'broadcast again')
const refusedId = refused.tradeOffer!.id
refused = play(refused, { type: 'decline-trade', offerId: refusedId, playerId: 'p1' }, 'p1 declines')
assert.equal(refused.phase, 'trade-response', 'one refusal does not end an offer to the table')
assert.equal(refused.pendingTrade?.toPlayerId, 'p2', 'the clock moves to the next seat that has not answered')
refused = play(refused, { type: 'decline-trade', offerId: refusedId, playerId: 'p2' }, 'p2 declines')
refused = play(refused, { type: 'decline-trade', offerId: refusedId, playerId: 'p3' }, 'p3 declines')
assert.equal(refused.phase, 'action')
assert.equal(refused.actingPlayerId, 'p0')
assert.equal(refused.tradeResolution?.outcome, 'no-takers', 'the engine reports no takers itself')
assert.deepEqual(refused.tradeResolution?.declinedBy, ['p1', 'p2', 'p3'])
assert.equal(offerLegal(refused), true, 'a refused offer leaves you free to try another')

// A directed offer that one seat refuses is a decline, not no-takers: the rest of
// the table was never asked.
const oneRefusal = play(broadcast, { type: 'offer-trade', trade: { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { ore: 1 } } }, 'directed offer')
const declined = play(oneRefusal, { type: 'respond-trade', accept: false }, 'p1 declines')
assert.equal(declined.tradeResolution?.outcome, 'declined')
assert.deepEqual(declined.tradeResolution?.declinedBy, ['p1'])

// The offerer can take an offer back while it is open.
const withdrawn = play(opened, { type: 'withdraw-trade', offerId, playerId: 'p0' }, 'withdraw')
assert.equal(withdrawn.phase, 'action')
assert.equal(withdrawn.tradeResolution?.outcome, 'withdrawn')
assert.equal(withdrawn.players[0].resources.brick, 2, 'taking an offer back moves no cards')
assert.equal(applyAction(opened, { type: 'withdraw-trade', offerId, playerId: 'p1' }).ok, false, 'only the offerer can take it back')

// An offer the offerer can no longer cover comes off the table instead of sitting
// there as a promise nobody can keep.
const stale = structuredClone(opened)
stale.players[0].resources.brick = 0
const invalidated = play(stale, { type: 'decline-trade', offerId, playerId: 'p1' }, 'decline against an empty hand')
assert.equal(invalidated.tradeResolution?.outcome, 'invalidated')
assert.equal(invalidated.phase, 'action')
assert.equal(invalidated.actingPlayerId, 'p0')
assert.equal(legalActionsForPlayer(stale, 'p2').some((action) => action.type === 'accept-trade'), false, 'nobody is offered a trade the offerer cannot pay')

// A counteroffer answers the old offer and opens a new one, so both are legible.
const countered = play(opened, { type: 'counter-trade', trade: { fromPlayerId: 'p1', toPlayerId: 'p0', give: { ore: 1 }, receive: { brick: 2 } } }, 'counter a broadcast')
assert.equal(countered.tradeResolution?.outcome, 'countered')
assert.equal(countered.tradeResolution?.id, offerId)
assert.equal(countered.tradeOffer?.id, offerId + 1, 'the counteroffer is an offer of its own')
assert.deepEqual(countered.tradeOffer?.toPlayerIds, ['p0'])
assert.equal(countered.actingPlayerId, 'p0')
assert.equal(countered.tradeResolution!.id < countered.tradeOffer!.id, true, 'an answer always names an older offer than the one on the table')

/* --------------------------------------------------- broadcast and secrets -- */

const broadcastView = JSON.stringify(getPlayerView(opened, 'p1'))
assert.equal(broadcastView.includes('"ore":2') && getPlayerView(opened, 'p1').privateState.resources.ore === 2, true)
const rivalHands = getPlayerView(opened, 'p1').publicState.players.filter((player) => player.id !== 'p1')
assert.equal(rivalHands.every((player) => !('resources' in player) && !('development' in player)), true, 'an open offer must not hand out a rival hand')
assert.equal(getPlayerView(opened, 'p3').legalActions.every((action) => action.type !== 'accept-trade' || action.playerId === 'p3'), true, 'a seat is only ever offered its own answer')

// The transport still decides who may speak: an action that is not in a seat's own
// legal list is not parseable, so a seat cannot answer for anybody else.
assert.equal(parsePlayerAction(getPlayerView(opened, 'p1'), { type: 'accept-trade', offerId, playerId: 'p2' }), undefined, 'one seat cannot accept on behalf of another')
assert.equal(parsePlayerAction(getPlayerView(opened, 'p1'), { type: 'accept-trade', offerId, playerId: 'p1' })?.type, 'accept-trade')
assert.equal(parsePlayerAction(getPlayerView(broadcast, 'p0'), { type: 'broadcast-trade', trade: { fromPlayerId: 'p0', give: { brick: 2 }, receive: { ore: 3 } } })?.type, 'broadcast-trade', 'a broadcast bundle bigger than one card still parses')
assert.equal(parsePlayerAction(getPlayerView(broadcast, 'p0'), { type: 'broadcast-trade', trade: { fromPlayerId: 'p0', give: { brick: 9 }, receive: { ore: 1 } } }), undefined, 'you cannot offer cards you do not hold')

/* --------------------------------------------------------- seats and colour -- */

const seatColors = seatsWithColor([
  { id: 'p0', name: 'You', controller: 'human', isHost: true },
  { id: 'p1', name: 'Marlow', controller: 'agent', isHost: false },
  { id: 'p2', name: 'Ansel', controller: 'agent', isHost: false },
])
assert.deepEqual(seatColors.map((seat) => seat.color), [playerColorForSeat(0), playerColorForSeat(1), playerColorForSeat(2)])
const seatedGame = getPlayerView(broadcast, 'p0')
assert.deepEqual(
  seatsWithColor(seatColors.slice(0, 3), seatedGame).map((seat) => seat.color),
  seatedGame.publicState.players.slice(0, 3).map((player) => player.color),
  'once a game is running the seat colour is the one the board is already using',
)

// An answer belongs to the turn it was given on. Left in place it would ride in
// every view for the rest of the game.
const endsTurn = play(declined, { type: 'end-turn' }, 'end the turn after a trade')
assert.equal(endsTurn.tradeResolution, undefined, 'a settled answer does not follow the game around')
assert.equal(declined.tradeResolution?.outcome, 'declined', 'and it was there for the turn it belonged to')

/* ------------------------------------------------- a room stored mid-trade -- */

// A room that was sitting in `trade-response` when this state landed has a
// pendingTrade and no offer. A reconnect into it must still find a move.
const legacyRoom = tableAt(213)
legacyRoom.players[0].resources.brick = 1
legacyRoom.players[1].resources.grain = 1
legacyRoom.phase = 'trade-response'
legacyRoom.actingPlayerId = 'p1'
legacyRoom.pendingTrade = { fromPlayerId: 'p0', toPlayerId: 'p1', give: { brick: 1 }, receive: { grain: 1 } }
delete (legacyRoom as Partial<GameState>).tradeOffer
delete (legacyRoom as Partial<GameState>).nextTradeId
const legacyActions = legalActionsForPlayer(legacyRoom, 'p1')
assert.equal(legacyActions.some((action) => action.type === 'respond-trade' && action.accept), true, 'a room stored mid-trade still offers an answer')
const legacyAccepted = play(legacyRoom, { type: 'respond-trade', accept: true }, 'answer a room stored mid-trade')
assert.equal(legacyAccepted.phase, 'action')
assert.equal(legacyAccepted.players[0].resources.grain, 1)
assert.equal(legacyAccepted.tradeResolution?.outcome, 'accepted')
const legacyNext = play(legacyAccepted, { type: 'offer-trade', trade: { fromPlayerId: 'p0', toPlayerId: 'p2', give: { grain: 1 }, receive: { wool: 1 } } }, 'a fresh offer in a room stored mid-trade')
assert.equal(legacyNext.tradeOffer!.id > legacyAccepted.tradeResolution!.id, true, 'ids keep climbing even where they had to start from nothing')

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
