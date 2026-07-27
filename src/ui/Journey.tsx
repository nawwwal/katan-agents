import { useEffect, useRef, useState } from 'react'
import { buildAgentUniversalInvite, resolveRoomServerOrigin } from '../agent/invite'
import { visibleScore } from '../game/room'
import type { BoardConstraint, BoardOptions, DesertPlacement, GameDisplayState, HarborLayout, PlayerColor } from '../game/types'
import type { RoomView } from '../game/room'
import type { RoomConnectionState } from '../game/useGame'
import { ChevronLeftIcon, LargestArmyIcon, LongestRoadIcon, VictoryIcon } from './Icons'

/**
 * `reconnecting` is a real stage, not a flag on the join screen. A reload that
 * still holds a seat token is not a player who wants to join a room; they are
 * already in one. Showing them the join form while their seat is live was the
 * surface that made a held seat look like a lost one.
 */
export type JourneyStage = 'title' | 'create' | 'join' | 'reconnecting' | 'lobby' | 'introduction' | 'match' | 'summary'

const connectionLabel: Record<RoomConnectionState, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Live',
  // Third state on purpose. Collapsing this into "Connecting" hid the difference
  // between a first attempt and a socket that keeps failing while a seat is held.
  reconnecting: 'Reconnecting',
}

const ConnectionPill = ({ state }: { state: RoomConnectionState }) =>
  <span className={`connection-pill ${state}`}><i />{connectionLabel[state]}</span>

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
  boardSeed: number
  boardOptions: BoardOptions
  boardRelaxed: BoardConstraint[]
  onShuffleBoard: () => void
  onBoardSeed: (seed: number) => void
  onBoardOptions: (options: BoardOptions) => void
  onChoose: (stage: 'create' | 'join') => void
  onCreate: (name: string, seatsTotal: 3 | 4) => Promise<boolean>
  onJoin: (code: string, name: string) => Promise<boolean>
  onBack: () => void
  onStart: () => void
  onEnter: () => void
  onRematch: () => void
}

const copyText = async (value: string) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the selection-based clipboard path.
  }
  const input = document.createElement('textarea')
  try {
    input.value = value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    input.remove()
  }
}

const desertChoices: Array<[DesertPlacement, string]> = [['random', 'Anywhere'], ['center', 'Center'], ['edge', 'Coast']]
const harborChoices: Array<[HarborLayout, string]> = [['shuffled', 'Shuffled'], ['fixed', 'Classic']]

export function Journey({ stage, room, game, viewerPlayerId, busy, connectionState, error, initialRoomCode = '', boardSeed, boardOptions, boardRelaxed, onShuffleBoard, onBoardSeed, onBoardOptions, onChoose, onCreate, onJoin, onBack, onStart, onEnter, onRematch }: JourneyProps) {
  const stageRef = useRef<HTMLElement>(null)
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [seatsTotal, setSeatsTotal] = useState<3 | 4>(3)
  const [copied, setCopied] = useState<'code' | 'link' | 'universal'>()
  const [boardOptionsOpen, setBoardOptionsOpen] = useState(false)
  const [seedDraft, setSeedDraft] = useState<string>()

  useEffect(() => { if (stage !== 'match') stageRef.current?.focus() }, [stage])
  useEffect(() => { if (initialRoomCode) setRoomCode(initialRoomCode) }, [initialRoomCode])
  useEffect(() => { if (!copied) return; const timeout = window.setTimeout(() => setCopied(undefined), 1_800); return () => window.clearTimeout(timeout) }, [copied])
  if (stage === 'match') return null

  if (stage === 'summary' && game) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    const standings = [...game.players].sort((left, right) => visibleScore(game, right.id, viewerPlayerId) - visibleScore(game, left.id, viewerPlayerId))
    return <section ref={stageRef} className="journey-layer summary-screen" aria-labelledby="summary-title" tabIndex={-1}>
      <div className="summary-glow" />
      <div className="summary-card">
        <span className="title-kicker">The final bell has rung</span>
        <div className={`summary-crest ${winner?.color ?? 'amber'}`}><VictoryIcon /></div>
        <h2 id="summary-title">{winner && winner.id === viewerPlayerId ? 'You win the island' : `${winner?.name ?? 'A settler'} wins the island`}</h2>
        <p>{winner ? visibleScore(game, winner.id, viewerPlayerId) : 10} victory points secured the crown.</p>
        <ol className="standings-list">
          {standings.map((player, index) => {
            const road = game.longestRoad?.playerId === player.id
            const army = game.largestArmy?.playerId === player.id
            return <li key={player.id} className={player.color} style={{ '--row': index } as React.CSSProperties}>
              <span>{index + 1}</span><strong>{player.name}</strong><small>{player.controller === 'agent' ? 'Local agent' : 'Human'}</small>
              <b>{visibleScore(game, player.id, viewerPlayerId)} VP</b>
              {road || army ? <em>{road ? <><LongestRoadIcon />Longest road</> : null}{army ? <><LargestArmyIcon />Largest army</> : null}</em> : null}
            </li>
          })}
        </ol>
        <div className="summary-events"><strong>Closing moments</strong>{game.events.slice(-3).map((event) => <span key={event.id}>{event.message}</span>)}</div>
        <div className="summary-actions"><button className="journey-secondary" onClick={onBack}>Leave table</button>{room?.isHost ? <button className="journey-primary" onClick={onRematch}>Start rematch</button> : <span className="waiting-copy">Waiting for the host</span>}</div>
      </div>
    </section>
  }

  if (stage === 'reconnecting') {
    const code = room?.code ?? initialRoomCode
    return <section ref={stageRef} className="journey-layer configure-screen" aria-labelledby="reconnecting-title" tabIndex={-1}>
      <div className="configuration-card reconnect-card">
        <header>
          <button type="button" className="journey-back" onClick={onBack} aria-label="Leave the room"><ChevronLeftIcon /></button>
          <div><span>{code ? `Room ${code}` : 'Private room'}</span><h2 id="reconnecting-title">Getting you back to the table</h2></div>
          <ConnectionPill state={connectionState} />
        </header>
        <div className="reconnect-body">
          <p>Your seat is still held. The island lives on the server, so nothing has been lost, and play resumes where you left it the moment the room answers.</p>
          {error ? <p className="journey-error" role="alert">{error}</p> : null}
        </div>
        <footer><p>Leaving gives the seat up.</p><button type="button" className="journey-secondary" onClick={onBack}>Leave the room</button></footer>
      </div>
    </section>
  }

  if (stage === 'title') {
    return <section ref={stageRef} className="journey-layer title-screen" aria-labelledby="game-title" tabIndex={-1}>
      <div className="title-stack">
        <span className="title-kicker">One island · humans and local agents</span>
        <h1 id="game-title"><span className="wordmark">Katan</span></h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="title-lede">Create a private table, share its six-character code, and settle the same live island from any browser, Codex session, or Claude session.</p>
        <div className="title-actions">
          <button className="journey-primary" onClick={() => onChoose('create')}>Create room</button>
          <button className="journey-secondary" onClick={() => onChoose('join')}>Join with code</button>
        </div>
        <small className="title-foot">No built-in bots. Every seat belongs to a real human or a local agent you invited.</small>
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
    const commitSeed = (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, 10)
      setSeedDraft(digits)
      const parsed = Number(digits)
      if (digits && Number.isSafeInteger(parsed) && parsed <= 0xff_ff_ff_ff) onBoardSeed(parsed)
    }
    const setOption = <K extends keyof BoardOptions>(key: K, value: BoardOptions[K]) => onBoardOptions({ ...boardOptions, [key]: value })
    return <section ref={stageRef} className={`journey-layer configure-screen${creating ? ' board-stage' : ''}`} aria-labelledby="configure-title" tabIndex={-1}>
      <form className="configuration-card room-form" onSubmit={submit}>
        <header>
          <button type="button" className="journey-back" onClick={onBack} aria-label="Back to title"><ChevronLeftIcon /></button>
          <div><span>{creating ? 'New expedition' : 'Invitation in hand'}</span><h2 id="configure-title">{creating ? 'Create a room' : 'Join a room'}</h2></div>
          {creating ? <div className="seat-count" role="group" aria-label="Player count"><button type="button" aria-label="3 players" aria-pressed={seatsTotal === 3} className={seatsTotal === 3 ? 'active' : ''} onClick={() => setSeatsTotal(3)}>3</button><button type="button" aria-label="4 players" aria-pressed={seatsTotal === 4} className={seatsTotal === 4 ? 'active' : ''} onClick={() => setSeatsTotal(4)}>4</button></div> : <span />}
        </header>
        <div className="room-form-body">
          <label>Player name<input autoFocus value={name} maxLength={22} autoComplete="nickname" placeholder="How the table will know you" onChange={(event) => setName(event.target.value)} /></label>
          {!creating ? <label>Room code<input className="room-code-input" value={roomCode} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABC234" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} /></label> : null}
          {/* The island fills the frame behind this card and changes when you press
              Shuffle, so it does not need a caption explaining that it is the board. */}
          {creating ? <section className="board-panel" aria-labelledby="board-panel-title">
            <header>
              <span id="board-panel-title">Your island</span>
              <div className="board-panel-actions">
                <button type="button" className="board-shuffle" onClick={onShuffleBoard}>Shuffle</button>
                <button type="button" aria-expanded={boardOptionsOpen} onClick={() => setBoardOptionsOpen((open) => !open)}>{boardOptionsOpen ? 'Hide options' : 'Options'}</button>
              </div>
            </header>
            <label className="board-seed"><span>Seed</span><input inputMode="numeric" autoComplete="off" spellCheck={false} value={seedDraft ?? String(boardSeed)} onChange={(event) => commitSeed(event.target.value)} onBlur={() => setSeedDraft(undefined)} /></label>
            {boardOptionsOpen ? <div className="board-options">
              <div className="board-option"><span id="desert-label">Desert</span><div className="seat-count" role="group" aria-labelledby="desert-label">
                {desertChoices.map(([value, label]) => <button key={value} type="button" aria-pressed={boardOptions.desert === value} className={boardOptions.desert === value ? 'active' : ''} onClick={() => setOption('desert', value)}>{label}</button>)}
              </div></div>
              <div className="board-option"><span id="harbor-label">Harbors</span><div className="seat-count" role="group" aria-labelledby="harbor-label">
                {harborChoices.map(([value, label]) => <button key={value} type="button" aria-pressed={boardOptions.harbors === value} className={boardOptions.harbors === value ? 'active' : ''} onClick={() => setOption('harbors', value)}>{label}</button>)}
              </div></div>
              <label className="board-toggle"><input type="checkbox" checked={boardOptions.balancedPips} onChange={(event) => setOption('balancedPips', event.target.checked)} />Balance the pips, so no corner of the island is starved or overloaded</label>
              {/* Reassurance for a Catan obsessive, so it lives behind Options. */}
              <p className="board-rules">Always enforced: no two identical terrains touch, no two identical numbers touch, 6 and 8 never touch, and 2 and 12 never touch.</p>
            </div> : null}
            {boardRelaxed.includes('balancedPips') ? <p className="board-warning" role="status">This island could not be pip-balanced, so that setting was dropped for it. Shuffle for another.</p> : null}
          </section> : null}
          {!creating ? <div className="room-form-note"><strong>One shared island</strong><span>Your cards stay private to this seat. The server sends every player only the state they are allowed to see.</span></div> : null}
          {error ? <p className="journey-error" role="alert">{error}</p> : null}
        </div>
        <footer>{creating ? <span /> : <p>Codes are case-insensitive and never contain confusing characters like O, I, 0, or 1.</p>}<button className="journey-primary" disabled={!valid || busy}>{busy ? 'Opening the table…' : creating ? 'Create room' : 'Join room'}</button></footer>
      </form>
    </section>
  }

  if (stage === 'lobby' && room) {
    const emptySeats = Array.from({ length: room.seatsTotal - room.seats.length })
    const full = room.seats.length === room.seatsTotal
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`
    const serverUrl = resolveRoomServerOrigin(window.location.origin)
    const universalInvite = buildAgentUniversalInvite(room.code, serverUrl)
    const doCopy = async (kind: 'code' | 'link' | 'universal', value: string) => {
      if (await copyText(value)) setCopied(kind)
    }
    return <section ref={stageRef} className="journey-layer configure-screen" aria-labelledby="lobby-title" tabIndex={-1}>
      <div className="configuration-card lobby-card">
        <header>
          <button className="journey-back" onClick={onBack} aria-label="Leave room"><ChevronLeftIcon /></button>
          <div><span>Private room</span><h2 id="lobby-title">Gather the table</h2></div>
          <ConnectionPill state={connectionState} />
        </header>
        {/* The lobby used to swallow every error the hook raised, so a refused
            start or an unreachable room looked like a button that did nothing. */}
        {error ? <p className="journey-error lobby-error" role="alert">{error}</p> : null}
        <div className="room-invite">
          <div><span>Room code</span><strong data-testid="room-code">{room.code}</strong>{room.boardSeed === undefined ? null : <em className="island-seed">Island {room.boardSeed}</em>}</div>
          <div className="invite-actions"><button onClick={() => doCopy('code', room.code)}>{copied === 'code' ? 'Copied' : 'Copy code'}</button><button onClick={() => doCopy('link', shareUrl)}>{copied === 'link' ? 'Copied' : 'Copy invite link'}</button><button className="agent-invite-trigger" onClick={() => doCopy('universal', universalInvite)} title="Paste into Claude, Codex, Grok, Cursor, or any MCP agent">{copied === 'universal' ? 'Copied' : 'Copy agent invite'}</button></div>
        </div>
        <div className="seat-grid lobby-seats">
          {room.seats.map((seat, index) => <article className={`seat-card seat-${index}`} key={seat.id}>
            <span className="seat-number">{index + 1}</span>
            <div className="seat-heading"><strong>{seat.name}</strong><small>{seat.controller === 'agent' ? 'Live local agent' : seat.id === room.viewerPlayerId ? 'You · browser player' : 'Remote human'}</small></div>
            <div className="seat-meta"><span>{colorNames[colors[index]]}</span>{seat.isHost ? <b>Host</b> : <b>Ready</b>}</div>
          </article>)}
          {emptySeats.map((_, emptyIndex) => { const index = room.seats.length + emptyIndex; return <article className={`seat-card seat-${index} empty-seat`} key={`empty-${index}`}><span className="seat-number">{index + 1}</span><div className="seat-heading"><strong>Open seat</strong><small>Nobody yet. Send the link, or the agent invite.</small></div><div className="seat-meta"><span>{colorNames[colors[index]]}</span><b>Open</b></div></article> })}
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
        {firstRound.map((playerIndex, order) => { const player = game.players[playerIndex]; return <li key={player.id} className={player.color} style={{ '--row': order } as React.CSSProperties}><span>{order + 1}</span><strong>{player.name}</strong><small>{player.controller === 'agent' ? 'Local agent' : 'Human'}</small></li> })}
      </ol>
      <div className="setup-rule"><strong>Snake setup</strong><span>The order reverses after everyone places once, so the final player places twice in a row.</span></div>
      <button className="journey-primary" onClick={onEnter}>Enter the island</button>
    </div>
  </section>
}
