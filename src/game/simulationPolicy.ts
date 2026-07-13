import type { GameAction, PlayerView, PublicGameState, Resource } from './types'

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

const settlementValue = (state: PublicGameState, vertexId: string) => {
  const vertex = state.board.vertices[vertexId]
  const resources = new Set<Resource>()
  let score = 0
  for (const hexId of vertex.hexes) {
    const hex = state.board.hexes.find((tile) => tile.id === hexId)
    if (!hex || hex.terrain === 'desert') continue
    score += PIPS[hex.number ?? 0] ?? 0
    resources.add(hex.terrain)
  }
  return score + resources.size * 1.6 + (vertex.harborId ? 2 : 0)
}

export const chooseSimulationAction = (view: PlayerView): GameAction | undefined => {
  const { playerId, publicState: state, legalActions: actions } = view
  if (!actions.length) return undefined

  const winning = actions.find((action) => {
    if (!['build-city', 'build-settlement'].includes(action.type)) return false
    const player = state.players.find((candidate) => candidate.id === playerId)
    if (!player) return false
    const hiddenVictoryPoints = view.privateState.development.filter((card) => card === 'victory-point').length
    return player.publicScore + hiddenVictoryPoints + 1 >= 10
  })
  if (winning) return winning

  const setupSettlements = actions.filter((action): action is Extract<GameAction, { type: 'place-settlement' }> => action.type === 'place-settlement')
  if (setupSettlements.length) return setupSettlements.toSorted((a, b) => settlementValue(state, b.vertexId) - settlementValue(state, a.vertexId))[0]

  const discard = actions.find((action) => action.type === 'discard')
  if (discard) return discard
  const tradeResponse = actions.find((action) => action.type === 'respond-trade' && action.accept)
    ?? actions.find((action) => action.type === 'respond-trade')
  if (tradeResponse) return tradeResponse
  const roll = actions.find((action) => action.type === 'roll-dice')
  if (roll) return roll

  const robberMoves = actions.filter((action): action is Extract<GameAction, { type: 'move-robber' }> => action.type === 'move-robber')
  if (robberMoves.length) {
    return robberMoves.toSorted((a, b) => {
      const pressure = (hexId: string) => {
        const hex = state.board.hexes.find((tile) => tile.id === hexId)
        if (!hex) return -100
        return hex.vertices.reduce((score, vertexId) => {
          const owner = state.buildings[vertexId]?.playerId
          if (!owner) return score
          return score + (owner === playerId ? -6 : 4)
        }, PIPS[hex.number ?? 0] ?? 0)
      }
      return pressure(b.hexId) - pressure(a.hexId)
    })[0]
  }

  const victims = actions.filter((action): action is Extract<GameAction, { type: 'steal-from' }> => action.type === 'steal-from')
  if (victims.length) {
    return victims.toSorted((a, b) =>
      (state.players.find((player) => player.id === b.playerId)?.resourceCount ?? 0)
      - (state.players.find((player) => player.id === a.playerId)?.resourceCount ?? 0),
    )[0]
  }

  const year = actions.filter((action): action is Extract<GameAction, { type: 'choose-year-of-plenty' }> => action.type === 'choose-year-of-plenty')
  if (year.length) return year.find((action) => action.resources.includes('ore') && action.resources.includes('grain')) ?? year[0]

  const monopoly = actions.filter((action): action is Extract<GameAction, { type: 'choose-monopoly' }> => action.type === 'choose-monopoly')
  if (monopoly.length) return monopoly.toSorted((a, b) =>
    view.privateState.resources[a.resource] - view.privateState.resources[b.resource],
  )[0]

  const city = actions.find((action) => action.type === 'build-city')
  if (city) return city
  const settlement = actions
    .filter((action): action is Extract<GameAction, { type: 'build-settlement' }> => action.type === 'build-settlement')
    .toSorted((a, b) => settlementValue(state, b.vertexId) - settlementValue(state, a.vertexId))[0]
  if (settlement) return settlement

  const road = actions.find((action) => action.type === 'build-road' || action.type === 'place-road')
  if (road) return road
  const finishRoads = actions.find((action) => action.type === 'finish-road-building')
  if (finishRoads) return finishRoads
  const development = actions.find((action) => action.type === 'buy-development')
  if (development) return development

  const card = actions.find((action) => action.type === 'play-development')
  if (card) return card

  const trade = actions.find((action) => action.type === 'maritime-trade')
  if (trade) return trade
  return actions.find((action) => action.type === 'end-turn') ?? actions[0]
}
