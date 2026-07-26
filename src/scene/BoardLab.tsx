import { useMemo } from 'react'
import { applyAction, createGame, currentActorId, getPlayerView, legalActionsForPlayer } from '../game/engine'
import { parseBoardOptions } from '../game/board'
import { toDisplayState } from '../game/room'
import { GameScene } from './GameScene'

// ponytail: visual-QA-only route (?board). Renders the island with no UI chrome
// so screenshot agents get a deterministic frame to grade against art/reference.
export function BoardLab() {
  const params = new URLSearchParams(window.location.search)
  const seed = Number(params.get('seed') ?? 28)
  const populate = params.get('populate') !== '0'
  const cinematic = params.get('cinematic') === '1'
  // Board generation options are readable from the query string so a QA frame can pin any
  // island: ?desert=center&harbors=fixed&pips=0.
  const boardOptions = parseBoardOptions({
    desert: params.get('desert') ?? undefined,
    harbors: params.get('harbors') ?? undefined,
    balancedPips: params.get('pips') === null ? undefined : params.get('pips') !== '0',
  })
  const optionKey = JSON.stringify(boardOptions)

  const game = useMemo(() => {
    let state = createGame({ seed, boardOptions: JSON.parse(optionKey), controllers: ['human', 'agent', 'agent'], names: ['You', 'Marlow', 'Ansel'] })
    if (populate) {
      // Walk the deterministic opening so settlements and roads are on the board.
      for (let step = 0; step < 40 && state.phase !== 'action'; step += 1) {
        const action = legalActionsForPlayer(state, currentActorId(state))[0]
        if (!action) break
        const result = applyAction(state, action, () => 0.5)
        if (!result.ok) break
        state = result.state
      }
    }
    return toDisplayState(getPlayerView(state, state.players[0].id))
  }, [seed, populate, optionKey])

  return <div style={{ position: 'fixed', inset: 0, background: '#04121b' }}>
    <GameScene game={game} placementMode={null} interactive={false} cinematic={cinematic} onAction={() => {}} />
  </div>
}
