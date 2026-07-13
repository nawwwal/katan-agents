import assert from 'node:assert/strict'
import { applyAction, createGame, legalActionsForPlayer } from './engine'
import type { Board, GameAction, GameState, Resource } from './types'

const setActionTurn = (game: GameState, playerIndex: number) => {
  game.activePlayerIndex = playerIndex
  game.actingPlayerId = game.players[playerIndex].id
  game.phase = 'action'
  game.lastRoll = [3, 4]
}

const productionGame = createGame({ seed: 70, controllers: ['human', 'agent', 'agent'] })
let productionRevision = 0
let productionTotal = 7
while (productionTotal === 7) {
  productionGame.revision = productionRevision
  productionGame.phase = 'pre-roll'
  productionGame.activePlayerIndex = 0
  productionGame.actingPlayerId = 'p0'
  const probe = applyAction(productionGame, { type: 'roll-dice' })
  if (!probe.ok) throw new Error('production probe failed')
  productionTotal = probe.state.lastRoll![0] + probe.state.lastRoll![1]
  if (productionTotal === 7) productionRevision += 1
}
const producingHex = productionGame.board.hexes.find((hex) => hex.number === productionTotal && hex.terrain !== 'desert')
assert.ok(producingHex)
const productionResource = producingHex.terrain as Resource

productionGame.buildings = {
  [producingHex.vertices[0]]: { playerId: 'p0', type: 'settlement' },
  [producingHex.vertices[2]]: { playerId: 'p1', type: 'settlement' },
}
productionGame.players[0].settlements = [producingHex.vertices[0]]
productionGame.players[1].settlements = [producingHex.vertices[2]]
productionGame.bank[productionResource] = 1
const shortage = applyAction(productionGame, { type: 'roll-dice' })
assert.equal(shortage.ok, true)
if (!shortage.ok) throw new Error('shortage roll failed')
assert.equal(shortage.state.players[0].resources[productionResource], 0)
assert.equal(shortage.state.players[1].resources[productionResource], 0)
assert.equal(shortage.state.bank[productionResource], 1, 'multiple players receive none when the bank cannot satisfy that resource')

const soleClaim = structuredClone(productionGame)
soleClaim.buildings = { [producingHex.vertices[0]]: { playerId: 'p0', type: 'city' } }
soleClaim.players[0].settlements = []
soleClaim.players[0].cities = [producingHex.vertices[0]]
soleClaim.players[1].settlements = []
const partial = applyAction(soleClaim, { type: 'roll-dice' })
assert.equal(partial.ok, true)
if (!partial.ok) throw new Error('single-player shortage roll failed')
assert.equal(partial.state.players[0].resources[productionResource], 1)
assert.equal(partial.state.bank[productionResource], 0, 'a sole claimant receives the remaining supply')

const developmentGame = createGame({ seed: 71, controllers: ['human', 'agent', 'agent'] })
setActionTurn(developmentGame, 0)
developmentGame.players[0].resources = { brick: 0, lumber: 0, ore: 1, grain: 1, wool: 1 }
developmentGame.developmentDeck = ['knight']
const bought = applyAction(developmentGame, { type: 'buy-development' })
assert.equal(bought.ok, true)
if (!bought.ok) throw new Error('development purchase failed')
assert.equal(applyAction(bought.state, { type: 'play-development', card: 'knight' }).ok, false, 'a purchased card cannot be played that turn')
const ended = applyAction(bought.state, { type: 'end-turn' })
assert.equal(ended.ok, true)
if (!ended.ok) throw new Error('turn end failed')
assert.deepEqual(ended.state.players[0].boughtDevelopment, [])
ended.state.activePlayerIndex = 0
ended.state.actingPlayerId = 'p0'
ended.state.phase = 'pre-roll'
assert.equal(applyAction(ended.state, { type: 'play-development', card: 'knight' }).ok, true, 'the card becomes playable on a later turn')

const emptyPlentyBank = createGame({ seed: 74, controllers: ['human', 'agent', 'agent'] })
setActionTurn(emptyPlentyBank, 0)
emptyPlentyBank.players[0].development = ['year-of-plenty']
emptyPlentyBank.bank = { brick: 1, lumber: 0, ore: 0, grain: 0, wool: 0 }
assert.equal(legalActionsForPlayer(emptyPlentyBank, 'p0').some((action) => action.type === 'play-development' && action.card === 'year-of-plenty'), false, 'Year of Plenty must not be advertised when the bank has fewer than two cards')
assert.equal(applyAction(emptyPlentyBank, { type: 'play-development', card: 'year-of-plenty' }).ok, false, 'Year of Plenty must not enter a dead-end phase')

const findRoadPath = (board: Board) => {
  const search = (vertexId: string, edges: string[], vertices: string[]): { edges: string[]; vertices: string[] } | undefined => {
    if (edges.length === 5 && vertices.slice(1, -1).some((id) => board.vertices[id].edges.length === 3)) return { edges, vertices }
    if (edges.length >= 5) return undefined
    for (const edgeId of board.vertices[vertexId].edges) {
      if (edges.includes(edgeId)) continue
      const edge = board.edges[edgeId]
      const next = edge.vertices[0] === vertexId ? edge.vertices[1] : edge.vertices[0]
      if (vertices.includes(next)) continue
      const result = search(next, [...edges, edgeId], [...vertices, next])
      if (result) return result
    }
  }
  for (const vertexId of Object.keys(board.vertices)) {
    const result = search(vertexId, [], [vertexId])
    if (result) return result
  }
  throw new Error('board needs a five-road path')
}

const roadGame = createGame({ seed: 72, controllers: ['human', 'agent', 'agent'] })
const path = findRoadPath(roadGame.board)
roadGame.roadOwners = Object.fromEntries(path.edges.map((edgeId) => [edgeId, 'p0']))
roadGame.players[0].roads = [...path.edges]
setActionTurn(roadGame, 0)
const roadAward = applyAction(roadGame, { type: 'end-turn' })
assert.equal(roadAward.ok, true)
if (!roadAward.ok) throw new Error('road award turn failed')
assert.equal(roadAward.state.longestRoad?.playerId, 'p0')

const blockedRoad = roadAward.state
const blockingVertex = path.vertices.slice(1, -1).find((vertexId) => blockedRoad.board.vertices[vertexId].edges.some((edgeId) => !path.edges.includes(edgeId)))!
const feeder = blockedRoad.board.vertices[blockingVertex].edges.find((edgeId) => !path.edges.includes(edgeId))!
blockedRoad.roadOwners[feeder] = 'p1'
blockedRoad.players[1].roads.push(feeder)
setActionTurn(blockedRoad, 1)
blockedRoad.players[1].resources = { brick: 1, lumber: 1, ore: 0, grain: 1, wool: 1 }
const interrupted = applyAction(blockedRoad, { type: 'build-settlement', vertexId: blockingVertex })
assert.equal(interrupted.ok, true)
if (!interrupted.ok) throw new Error('road interruption build failed')
assert.notEqual(interrupted.state.longestRoad?.playerId, 'p0', 'an opponent settlement interrupts a continuous road')

const victoryGame = createGame({ seed: 73, controllers: ['human', 'agent', 'agent'] })
victoryGame.players[2].cities = ['a', 'b', 'c', 'd']
victoryGame.players[2].settlements = ['e', 'f']
setActionTurn(victoryGame, 0)
const beforeTheirTurn = applyAction(victoryGame, { type: 'end-turn' })
assert.equal(beforeTheirTurn.ok, true)
if (!beforeTheirTurn.ok) throw new Error('pre-victory turn failed')
assert.equal(beforeTheirTurn.state.winnerId, undefined, 'ten points do not win outside that player’s turn')
beforeTheirTurn.state.activePlayerIndex = 2
beforeTheirTurn.state.actingPlayerId = 'p2'
beforeTheirTurn.state.phase = 'pre-roll'
const onTheirTurn = applyAction(beforeTheirTurn.state, { type: 'roll-dice' })
assert.equal(onTheirTurn.ok, true)
if (!onTheirTurn.ok) throw new Error('victory roll failed')
assert.equal(onTheirTurn.state.winnerId, 'p2')
assert.equal(onTheirTurn.state.phase, 'game-over')

const robberGame = createGame({ seed: 75, controllers: ['human', 'agent', 'agent'] })
setActionTurn(robberGame, 0)
robberGame.phase = 'move-robber'
const robberTarget = robberGame.board.hexes.find((hex) => hex.id !== robberGame.board.robberHexId)!
const [emptyVictimVertex, fundedVictimVertex] = robberTarget.vertices
robberGame.buildings = {
  [emptyVictimVertex]: { playerId: 'p1', type: 'settlement' },
  [fundedVictimVertex]: { playerId: 'p2', type: 'settlement' },
}
robberGame.players[1].settlements = [emptyVictimVertex]
robberGame.players[2].settlements = [fundedVictimVertex]
robberGame.players[2].resources.brick = 1
const movedRobber = applyAction(robberGame, { type: 'move-robber', hexId: robberTarget.id })
assert.equal(movedRobber.ok, true)
if (!movedRobber.ok) throw new Error('robber move failed')
assert.deepEqual(movedRobber.state.robberVictims.toSorted(), ['p1', 'p2'], 'adjacent opponents remain selectable even with no cards')
const emptyRobbery = applyAction(movedRobber.state, { type: 'steal-from', playerId: 'p1' })
assert.equal(emptyRobbery.ok, true)
if (!emptyRobbery.ok) throw new Error('zero-card robbery failed')
assert.equal(emptyRobbery.events.at(-1)?.message, 'Agent Blue had no resource cards to steal.')

const roadBuildingGame = createGame({ seed: 76, controllers: ['human', 'agent', 'agent'] })
setActionTurn(roadBuildingGame, 0)
const roadOrigin = Object.values(roadBuildingGame.board.vertices).find((vertex) => vertex.edges.length >= 2)!
roadBuildingGame.buildings = { [roadOrigin.id]: { playerId: 'p0', type: 'settlement' } }
roadBuildingGame.players[0].settlements = [roadOrigin.id]
roadBuildingGame.phase = 'road-building'
roadBuildingGame.pendingRoads = 2
const freeRoadActions = legalActionsForPlayer(roadBuildingGame, 'p0')
assert.equal(freeRoadActions.some((action) => action.type === 'build-road'), true)
assert.equal(freeRoadActions.some((action) => action.type === 'finish-road-building'), false, 'Road Building cannot end while a free road is legal')
assert.equal(applyAction(roadBuildingGame, { type: 'finish-road-building' }).ok, false)

const harborTradeGame = createGame({ seed: 77, controllers: ['human', 'agent', 'agent'] })
setActionTurn(harborTradeGame, 0)
const genericHarbor = harborTradeGame.board.harbors.find((harbor) => harbor.ratio === 3)!
harborTradeGame.players[0].ports = [genericHarbor.id]
harborTradeGame.players[0].resources.brick = 4
const brickForGrain = legalActionsForPlayer(harborTradeGame, 'p0')
  .filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade')
  .filter((action) => action.give === 'brick' && action.receive === 'grain')
assert.deepEqual(brickForGrain.map((action) => action.ratio), [3, 4], 'harbor rates supplement the baseline 4:1 rate')
assert.equal(applyAction(harborTradeGame, { type: 'maritime-trade', give: 'brick', receive: 'grain', ratio: 4 }).ok, true)

console.log('rules check passed: supply, development timing, road interruption, robber victims, Road Building, maritime rates, active-turn victory')
