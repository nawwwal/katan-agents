import { useEffect, useRef } from 'react'
import type { Controller, GameState, PlayerColor } from '../game/types'
import { scorePlayer } from '../game/engine'

export type JourneyStage = 'title' | 'configure' | 'introduction' | 'match' | 'summary'
export type PlayableController = Exclude<Controller, 'spectator'>
export type SeatConfig = { name: string; controller: PlayableController }

const controllerCopy: Record<PlayableController, string> = {
  human: 'You make every decision on this device.',
  bot: 'A quick deterministic rival plays from public information.',
  agent: 'A local process receives one redacted view and chooses a legal action.',
}

const colorNames: Record<PlayerColor, string> = {
  coral: 'Coral',
  blue: 'Royal blue',
  amber: 'Amber',
  ivory: 'Ivory',
}

type JourneyProps = {
  stage: JourneyStage
  mode: 'play' | 'spectate'
  seats: SeatConfig[]
  seed: number
  game?: GameState
  onChooseMode: (mode: 'play' | 'spectate') => void
  onSeatChange: (index: number, patch: Partial<SeatConfig>) => void
  onSeatCount: (count: 3 | 4) => void
  onSeed: (seed: number) => void
  onBack: () => void
  onCreate: () => void
  onEnter: () => void
  onRematch: () => void
}

export function Journey({ stage, mode, seats, seed, game, onChooseMode, onSeatChange, onSeatCount, onSeed, onBack, onCreate, onEnter, onRematch }: JourneyProps) {
  const stageRef = useRef<HTMLElement>(null)
  useEffect(() => { if (stage !== 'match') stageRef.current?.focus() }, [stage])
  if (stage === 'match') return null

  if (stage === 'summary' && game) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    const standings = [...game.players].sort((left, right) => scorePlayer(game, right.id) - scorePlayer(game, left.id))
    return <section ref={stageRef} className="journey-layer summary-screen" aria-labelledby="summary-title" tabIndex={-1}>
      <div className="summary-glow" />
      <div className="celebration" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
      <div className="summary-card">
        <span className="title-kicker">The final bell has rung</span>
        <div className={`summary-crest ${winner?.color ?? 'amber'}`}>★</div>
        <h2 id="summary-title">{winner?.name ?? 'A settler'} wins the island</h2>
        <p>{winner ? scorePlayer(game, winner.id) : 10} victory points secured the crown.</p>
        <ol className="standings-list">
          {standings.map((player, index) => <li key={player.id} className={player.color}>
            <span>{index + 1}</span>
            <strong>{player.name}</strong>
            <small>{player.controller === 'human' ? 'Human' : player.controller === 'agent' ? 'Local agent' : 'Built-in bot'}</small>
            <b>{scorePlayer(game, player.id)} VP</b>
            <em>{game.longestRoad?.playerId === player.id ? 'Longest Road' : ''}{game.longestRoad?.playerId === player.id && game.largestArmy?.playerId === player.id ? ' · ' : ''}{game.largestArmy?.playerId === player.id ? 'Largest Army' : ''}</em>
          </li>)}
        </ol>
        <div className="summary-events"><strong>Closing moments</strong>{game.events.slice(-3).map((event) => <span key={event.id}>{event.message}</span>)}</div>
        <div className="summary-actions"><button className="journey-secondary" onClick={onBack}>Return to title</button><button className="journey-primary" onClick={onRematch}>Rematch</button></div>
      </div>
    </section>
  }

  if (stage === 'title') {
    return <section ref={stageRef} className="journey-layer title-screen" aria-labelledby="game-title" tabIndex={-1}>
      <div className="title-card">
        <span className="title-kicker">A living island strategy game</span>
        <h1 id="game-title">KATAN</h1>
        <p>Settle a changing island, trade with rivals, and race to ten victory points.</p>
        <div className="title-actions">
          <button className="journey-primary" onClick={() => onChooseMode('play')}>Start game</button>
          <button className="journey-secondary" onClick={() => onChooseMode('spectate')}>Watch agents</button>
        </div>
        <small>Human, built-in bot, and local-agent seats share the same legal actions.</small>
      </div>
    </section>
  }

  if (stage === 'configure') {
    const humanSeat = seats.findIndex((seat) => seat.controller === 'human')
    const humanCount = seats.filter((seat) => seat.controller === 'human').length
    const validTable = mode === 'spectate' ? humanCount === 0 : humanCount === 1
    return <section ref={stageRef} className="journey-layer configure-screen" aria-labelledby="configure-title" tabIndex={-1}>
      <div className="configuration-card">
        <header>
          <button className="journey-back" onClick={onBack} aria-label="Back to title">←</button>
          <div><span>{mode === 'spectate' ? 'Spectator match' : 'New island'}</span><h2 id="configure-title">Choose the table</h2></div>
          <div className="seat-count" role="group" aria-label="Player count"><button aria-label="3 players" aria-pressed={seats.length === 3} className={seats.length === 3 ? 'active' : ''} onClick={() => onSeatCount(3)}>3</button><button aria-label="4 players" aria-pressed={seats.length === 4} className={seats.length === 4 ? 'active' : ''} onClick={() => onSeatCount(4)}>4</button></div>
        </header>
        <div className="seat-grid">
          {seats.map((seat, index) => <article className={`seat-card seat-${index}`} key={index}>
            <span className="seat-number">{index + 1}</span>
            <div className="seat-heading"><strong>{colorNames[(['coral', 'blue', 'amber', 'ivory'] as PlayerColor[])[index]]}</strong><small>{controllerCopy[seat.controller]}</small></div>
            <label>Player name<input value={seat.name} maxLength={22} onChange={(event) => onSeatChange(index, { name: event.target.value })} /></label>
            <label>Controller<select value={seat.controller} onChange={(event) => onSeatChange(index, { controller: event.target.value as PlayableController })}>
              <option value="human" disabled={mode === 'spectate' || (humanSeat >= 0 && humanSeat !== index)}>Human</option>
              <option value="bot">Built-in bot</option>
              <option value="agent">Local agent</option>
            </select></label>
          </article>)}
        </div>
        <footer><p>{mode === 'spectate' ? 'Every seat is automated. You can pause the table and inspect any public state.' : humanCount === 1 ? 'One local human seat keeps private cards on this screen; automated rivals receive redacted views.' : 'Choose exactly one Human controller before creating the island.'}</p><label className="seed-control">Island seed<input type="number" min="1" max="999999" value={seed} onChange={(event) => onSeed(Math.max(1, Math.min(999999, Number(event.target.value) || 1)))} /></label><button className="journey-primary" disabled={!validTable} onClick={() => onCreate()}>Create island</button></footer>
      </div>
    </section>
  }

  if (!game) return null
  const firstRound = game.setupOrder.slice(0, game.players.length)
  return <section ref={stageRef} className="journey-layer introduction-screen" aria-labelledby="introduction-title" tabIndex={-1}>
    <div className="introduction-card">
      <span className="title-kicker">The island is ready</span>
      <h2 id="introduction-title">First to 10 points wins</h2>
      <p>Build two starting settlements and roads. Your second settlement collects one resource from each neighboring productive tile.</p>
      <ol className="turn-order">
        {firstRound.map((playerIndex, order) => { const player = game.players[playerIndex]; return <li key={player.id} className={player.color}><span>{order + 1}</span><strong>{player.name}</strong><small>{player.controller === 'human' ? 'Human' : player.controller === 'agent' ? 'Local agent' : 'Built-in bot'}</small></li> })}
      </ol>
      <div className="setup-rule"><strong>Snake setup</strong><span>The order reverses after everyone places once, so the final player places twice in a row.</span></div>
      <button className="journey-primary" onClick={onEnter}>Enter the island</button>
    </div>
  </section>
}
