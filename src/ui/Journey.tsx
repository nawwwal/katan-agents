import { useEffect, useRef, useState } from 'react'
import { visibleScore } from '../game/room'
import type { GameDisplayState, PlayerColor } from '../game/types'
import type { RoomView } from '../game/room'
import type { RoomConnectionState } from '../game/useGame'

export type JourneyStage = 'title' | 'create' | 'join' | 'lobby' | 'introduction' | 'match' | 'summary'

const colors: PlayerColor[] = ['coral', 'blue', 'amber', 'ivory']
const colorNames: Record<PlayerColor, string> = {
  coral: 'Coral',
  blue: 'Royal blue',
  amber: 'Amber',
  ivory: 'Ivory',
}

type JourneyProps = {
  stage: JourneyStage
  room?: RoomView
  game?: GameDisplayState
  viewerPlayerId?: string
  busy: boolean
  connectionState: RoomConnectionState
  error?: string
  initialRoomCode?: string
  onChoose: (stage: 'create' | 'join') => void
  onCreate: (name: string, seatsTotal: 3 | 4) => Promise<boolean>
  onJoin: (code: string, name: string) => Promise<boolean>
  onBack: () => void
  onStart: () => void
  onEnter: () => void
  onRematch: () => void
}

const copyText = async (value: string) => {
  if (navigator.clipboard) return navigator.clipboard.writeText(value)
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export function Journey({ stage, room, game, viewerPlayerId, busy, connectionState, error, initialRoomCode = '', onChoose, onCreate, onJoin, onBack, onStart, onEnter, onRematch }: JourneyProps) {
  const stageRef = useRef<HTMLElement>(null)
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [seatsTotal, setSeatsTotal] = useState<3 | 4>(3)
  const [copied, setCopied] = useState<'code' | 'link' | 'agent'>()

  useEffect(() => { if (stage !== 'match') stageRef.current?.focus() }, [stage])
  useEffect(() => { if (initialRoomCode) setRoomCode(initialRoomCode) }, [initialRoomCode])
  useEffect(() => { if (!copied) return; const timeout = window.setTimeout(() => setCopied(undefined), 1_800); return () => window.clearTimeout(timeout) }, [copied])
  if (stage === 'match') return null

  if (stage === 'summary' && game) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    const standings = [...game.players].sort((left, right) => visibleScore(game, right.id, viewerPlayerId) - visibleScore(game, left.id, viewerPlayerId))
    return <section ref={stageRef} className="journey-layer summary-screen" aria-labelledby="summary-title" tabIndex={-1}>
      <div className="summary-glow" />
      <div className="celebration" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
      <div className="summary-card">
        <span className="title-kicker">The final bell has rung</span>
        <div className={`summary-crest ${winner?.color ?? 'amber'}`}>★</div>
        <h2 id="summary-title">{winner?.name ?? 'A settler'} wins the island</h2>
        <p>{winner ? visibleScore(game, winner.id, viewerPlayerId) : 10} victory points secured the crown.</p>
        <ol className="standings-list">
          {standings.map((player, index) => <li key={player.id} className={player.color}>
            <span>{index + 1}</span><strong>{player.name}</strong><small>{player.controller === 'agent' ? 'Local agent' : 'Human'}</small>
            <b>{visibleScore(game, player.id, viewerPlayerId)} VP</b>
            <em>{game.longestRoad?.playerId === player.id ? 'Longest Road' : ''}{game.longestRoad?.playerId === player.id && game.largestArmy?.playerId === player.id ? ' · ' : ''}{game.largestArmy?.playerId === player.id ? 'Largest Army' : ''}</em>
          </li>)}
        </ol>
        <div className="summary-events"><strong>Closing moments</strong>{game.events.slice(-3).map((event) => <span key={event.id}>{event.message}</span>)}</div>
        <div className="summary-actions"><button className="journey-secondary" onClick={onBack}>Leave table</button>{room?.isHost ? <button className="journey-primary" onClick={onRematch}>Start rematch</button> : <span className="waiting-copy">Waiting for the host</span>}</div>
      </div>
    </section>
  }

  if (stage === 'title') {
    return <section ref={stageRef} className="journey-layer title-screen" aria-labelledby="game-title" tabIndex={-1}>
      <div className="title-card">
        <span className="title-kicker">One island · humans and local agents</span>
        <h1 id="game-title">KATAN</h1>
        <p>Create a private table, share its six-character code, and settle the same live island from any browser or Codex thread.</p>
        <div className="title-actions">
          <button className="journey-primary" onClick={() => onChoose('create')}>Create room</button>
          <button className="journey-secondary" onClick={() => onChoose('join')}>Join with code</button>
        </div>
        <small>No built-in bots. Every seat belongs to a real human or a local agent you invited.</small>
      </div>
    </section>
  }

  if (stage === 'create' || stage === 'join') {
    const creating = stage === 'create'
    const valid = Boolean(name.trim()) && (creating || roomCode.trim().length === 6)
    const submit = async (event: React.FormEvent) => {
      event.preventDefault()
      if (!valid || busy) return
      if (creating) await onCreate(name, seatsTotal)
      else await onJoin(roomCode, name)
    }
    return <section ref={stageRef} className="journey-layer configure-screen" aria-labelledby="configure-title" tabIndex={-1}>
      <form className="configuration-card room-form" onSubmit={submit}>
        <header>
          <button type="button" className="journey-back" onClick={onBack} aria-label="Back to title">←</button>
          <div><span>{creating ? 'New expedition' : 'Invitation in hand'}</span><h2 id="configure-title">{creating ? 'Create a room' : 'Join a room'}</h2></div>
          {creating ? <div className="seat-count" role="group" aria-label="Player count"><button type="button" aria-label="3 players" aria-pressed={seatsTotal === 3} className={seatsTotal === 3 ? 'active' : ''} onClick={() => setSeatsTotal(3)}>3</button><button type="button" aria-label="4 players" aria-pressed={seatsTotal === 4} className={seatsTotal === 4 ? 'active' : ''} onClick={() => setSeatsTotal(4)}>4</button></div> : <span />}
        </header>
        <div className="room-form-body">
          <label>Player name<input autoFocus value={name} maxLength={22} autoComplete="nickname" placeholder="How the table will know you" onChange={(event) => setName(event.target.value)} /></label>
          {!creating ? <label>Room code<input className="room-code-input" value={roomCode} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABC234" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} /></label> : null}
          <div className="room-form-note"><strong>{creating ? `${seatsTotal}-seat table` : 'One shared island'}</strong><span>{creating ? 'You will be the host. Humans join in a browser; agents join through the local Katan MCP.' : 'Your cards stay private to this seat. The server sends every player only the state they are allowed to see.'}</span></div>
          {error ? <p className="journey-error" role="alert">{error}</p> : null}
        </div>
        <footer><p>{creating ? 'You can start once every human or agent seat has joined.' : 'Codes are case-insensitive and never contain confusing characters like O, I, 0, or 1.'}</p><button className="journey-primary" disabled={!valid || busy}>{busy ? 'Opening the table…' : creating ? 'Create room' : 'Join room'}</button></footer>
      </form>
    </section>
  }

  if (stage === 'lobby' && room) {
    const emptySeats = Array.from({ length: room.seatsTotal - room.seats.length })
    const full = room.seats.length === room.seatsTotal
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`
    const agentPrompt = `Use the Katan MCP already configured in this Codex task. Join room ${room.code} as a local agent with your own name and personality. Read the rules, wait for your turn, and play to win without revealing hidden information.`
    const doCopy = async (kind: 'code' | 'link' | 'agent', value: string) => { await copyText(value); setCopied(kind) }
    return <section ref={stageRef} className="journey-layer configure-screen" aria-labelledby="lobby-title" tabIndex={-1}>
      <div className="configuration-card lobby-card">
        <header>
          <button className="journey-back" onClick={onBack} aria-label="Leave room">←</button>
          <div><span>Private room</span><h2 id="lobby-title">Gather the table</h2></div>
          <span className={`connection-pill ${connectionState}`}><i />{connectionState === 'connected' ? 'Live' : 'Connecting'}</span>
        </header>
        <div className="room-invite">
          <div><span>Room code</span><strong data-testid="room-code">{room.code}</strong></div>
          <div className="invite-actions"><button onClick={() => doCopy('code', room.code)}>{copied === 'code' ? 'Copied' : 'Copy code'}</button><button onClick={() => doCopy('link', shareUrl)}>{copied === 'link' ? 'Copied' : 'Copy human link'}</button><button onClick={() => doCopy('agent', agentPrompt)}>{copied === 'agent' ? 'Copied' : 'Copy agent prompt'}</button></div>
        </div>
        <div className="seat-grid lobby-seats">
          {room.seats.map((seat, index) => <article className={`seat-card seat-${index}`} key={seat.id}>
            <span className="seat-number">{index + 1}</span>
            <div className="seat-heading"><strong>{seat.name}</strong><small>{seat.controller === 'agent' ? 'Local Codex agent' : seat.id === room.viewerPlayerId ? 'You · browser player' : 'Remote human'}</small></div>
            <div className="seat-meta"><span>{colorNames[colors[index]]}</span>{seat.isHost ? <b>Host</b> : <b>Ready</b>}</div>
          </article>)}
          {emptySeats.map((_, emptyIndex) => { const index = room.seats.length + emptyIndex; return <article className={`seat-card seat-${index} empty-seat`} key={`empty-${index}`}><span className="seat-number">{index + 1}</span><div className="seat-heading"><strong>Open seat</strong><small>Share the code with a human or give it to a local Codex thread.</small></div><div className="seat-meta"><span>{colorNames[colors[index]]}</span><b>Waiting</b></div></article> })}
        </div>
        <footer><p>{full ? room.isHost ? 'Everyone is here. Start whenever the table is ready.' : 'The table is full. Waiting for the host to start.' : `${room.seatsTotal - room.seats.length} seat${room.seatsTotal - room.seats.length === 1 ? '' : 's'} still open.`}</p>{room.isHost ? <button className="journey-primary" disabled={!full || connectionState !== 'connected'} onClick={onStart}>Start game</button> : <span className="waiting-copy">Waiting for host</span>}</footer>
      </div>
    </section>
  }

  if (!game) return null
  const firstRound = game.setupOrder.slice(0, game.players.length)
  return <section ref={stageRef} className="journey-layer introduction-screen" aria-labelledby="introduction-title" tabIndex={-1}>
    <div className="introduction-card">
      <span className="title-kicker">The room is live</span>
      <h2 id="introduction-title">First to 10 points wins</h2>
      <p>Build two starting settlements and roads. Your second settlement collects one resource from each neighboring productive tile.</p>
      <ol className="turn-order">
        {firstRound.map((playerIndex, order) => { const player = game.players[playerIndex]; return <li key={player.id} className={player.color}><span>{order + 1}</span><strong>{player.name}</strong><small>{player.controller === 'agent' ? 'Local agent' : 'Human'}</small></li> })}
      </ol>
      <div className="setup-rule"><strong>Snake setup</strong><span>The order reverses after everyone places once, so the final player places twice in a row.</span></div>
      <button className="journey-primary" onClick={onEnter}>Enter the island</button>
    </div>
  </section>
}
