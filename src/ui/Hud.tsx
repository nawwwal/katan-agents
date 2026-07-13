import { useEffect, useRef, useState } from 'react'
import { currentActorId } from '../game/engine'
import { visibleScore } from '../game/room'
import type { AgentStatus, GameAction, GameDisplayState } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { RESOURCES } from '../game/types'
import type { PlacementMode } from '../scene/GameScene'
import { BookIcon, CardsIcon, DiceIcon, FlagIcon, TradeIcon } from './Icons'
import { BUILD_COSTS, RESOURCE_IMAGE } from './gameVisuals'

export type DialogName = 'trade' | 'cards' | 'rules' | 'history' | null

type HudProps = {
  game: GameDisplayState
  humanId: string
  thinkingPlayerId?: string
  agentStatuses: Record<string, AgentStatus>
  presentation?: GamePresentation
  muted: boolean
  placementMode: PlacementMode
  pendingAction?: GameAction
  error?: string
  onDialog: (dialog: DialogName) => void
  onPlacementMode: (mode: PlacementMode) => void
  onAction: (action: GameAction) => void
  onConfirmAction: () => void
  onCancelAction: () => void
  onMuted: (value: boolean) => void
  onExitMatch: () => void
}

const phaseCopy: Record<GameDisplayState['phase'], string> = {
  'setup-settlement': 'Place settlement',
  'setup-road': 'Place adjacent road',
  'pre-roll': 'Roll dice',
  action: 'Build · trade · cards',
  discard: 'Discard half',
  'move-robber': 'Move robber',
  'choose-victim': 'Choose rival',
  'road-building': 'Place free roads',
  'year-of-plenty': 'Choose two resources',
  monopoly: 'Choose one resource',
  'trade-response': 'Trade waiting',
  'game-over': 'Match complete',
}

const countResources = (game: GameDisplayState, playerId: string) => {
  const player = game.players.find((candidate) => candidate.id === playerId)
  return player?.resourceCount ?? 0
}

function TurnPanel({ game, thinkingPlayerId, onAction, placementMode }: Pick<HudProps, 'game' | 'thinkingPlayerId' | 'onAction' | 'placementMode'>) {
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => { panelRef.current?.focus() }, [])
  const actorId = currentActorId(game)
  const actor = game.players.find((player) => player.id === actorId)
  const actorThinking = thinkingPlayerId === actorId
  const total = game.lastRoll ? game.lastRoll[0] + game.lastRoll[1] : undefined
  const placementType = placementMode === 'road' ? 'build-road' : placementMode === 'settlement' ? 'build-settlement' : placementMode === 'city' ? 'build-city' : undefined
  const suggested = game.legalActions.find((action) => ['place-settlement', 'place-road', 'move-robber'].includes(action.type) || (game.phase === 'road-building' && action.type === 'build-road') || action.type === placementType)
  const suggestedLabel = suggested?.type === 'place-settlement'
    ? 'Place suggested settlement'
    : suggested?.type === 'place-road' || suggested?.type === 'build-road'
      ? 'Place suggested road'
      : suggested?.type === 'build-settlement'
        ? 'Place suggested settlement'
        : suggested?.type === 'build-city'
          ? 'Upgrade suggested city'
          : 'Move robber to suggested hex'
  return <section ref={panelRef} className="turn-panel wood-panel" aria-live="polite" tabIndex={-1}>
    <div className="turn-owner">
      <span className={`player-crest ${actor?.color ?? 'ivory'}`}>{actor?.name.slice(0, 1)}</span>
      <div><small>{actorThinking ? 'Agent turn' : 'Current turn'}</small><strong>{actor?.name}</strong><span>{phaseCopy[game.phase]}</span></div>
    </div>
    {game.lastRoll ? <div className="dice-result" aria-label={`Last roll ${total}`}><span>{game.lastRoll[0]}</span><span>{game.lastRoll[1]}</span><strong>{total}</strong></div> : null}
    {suggested ? <button className="setup-suggest" onClick={() => onAction(suggested)}>{suggestedLabel}</button> : null}
  </section>
}

const agentStatusCopy: Record<AgentStatus['state'], string> = {
  idle: 'Waiting',
  thinking: 'Turn pending',
}

function PlayerRail({ game, humanId, agentStatuses }: Pick<HudProps, 'game' | 'humanId' | 'agentStatuses'>) {
  const activeId = currentActorId(game)
  return <aside className="player-rail" aria-label="Players">
    {game.players.map((player, index) => <article key={player.id} className={`player-row ${player.color} ${activeId === player.id ? 'active' : ''}`}>
      <span className="rank">{index + 1}</span>
      <span className={`player-crest ${player.color}`}>{player.name.slice(0, 1)}</span>
      <div className="player-identity"><strong>{player.name}</strong><small title={player.controller === 'agent' ? agentStatuses[player.id]?.detail : undefined}>{player.controller === 'agent' ? `${agentStatusCopy[agentStatuses[player.id]?.state ?? 'idle']}${agentStatuses[player.id]?.detail ? ` · ${agentStatuses[player.id]?.detail}` : ''}` : 'Human player'}</small></div>
      <div className="player-stats" aria-label={`${visibleScore(game, player.id, humanId)} victory points, ${countResources(game, player.id)} resource cards, ${player.developmentCount} development cards`}>
        <span title="Victory points"><b aria-hidden="true">★</b>{visibleScore(game, player.id, humanId)}</span>
        <span title="Resource cards"><b aria-hidden="true">▰</b>{countResources(game, player.id)}</span>
        <span title="Development cards"><b aria-hidden="true">◈</b>{player.developmentCount}</span>
        <span className="knight-stat" title="Played knights"><b aria-hidden="true">♞</b>{player.playedKnights}</span>
      </div>
      {game.longestRoad?.playerId === player.id ? <span className="award" title="Longest road">LR</span> : null}
      {game.largestArmy?.playerId === player.id ? <span className="award" title="Largest army">LA</span> : null}
    </article>)}
  </aside>
}

function DiceMoment({ game, presentation }: { game: GameDisplayState; presentation?: GamePresentation }) {
  const [dice, setDice] = useState<[number, number]>()
  useEffect(() => {
    if (!game.lastRoll || presentation?.actionType !== 'roll-dice') return
    setDice(game.lastRoll)
    const timeout = window.setTimeout(() => setDice(undefined), 1_450)
    return () => window.clearTimeout(timeout)
  }, [game.lastRoll?.[0], game.lastRoll?.[1], presentation?.revision])
  if (!dice) return null
  const allocations = game.players.map((player) => ({
    player,
    resources: RESOURCES.filter((resource) => (presentation?.resourceDeltas[player.id]?.[resource] ?? 0) > 0).map((resource) => ({ resource, amount: presentation?.resourceDeltas[player.id]?.[resource] ?? 0 })),
  })).filter(({ resources }) => resources.length)
  return <div className="dice-moment" role="status" aria-label={`Rolled ${dice[0] + dice[1]}`}>
    <div><span>{dice[0]}</span><span>{dice[1]}</span></div><strong>{dice[0] + dice[1]}</strong>
    {allocations.length ? <ul className="production-summary">{allocations.map(({ player, resources }) => <li key={player.id} className={player.color}><b>{player.name}</b><div>{resources.map(({ resource, amount }) => <span key={resource}><img src={RESOURCE_IMAGE[resource]} alt="" />+{amount}</span>)}</div></li>)}</ul> : <small className="production-none">No settlement produced</small>}
  </div>
}

const actionLabel: Partial<Record<GameAction['type'], string>> = {
  'place-settlement': 'Settlement founded',
  'place-road': 'Road laid',
  'build-settlement': 'Settlement built',
  'build-road': 'Road built',
  'build-city': 'City raised',
  'buy-development': 'Development card bought',
  'maritime-trade': 'Harbor trade complete',
  'offer-trade': 'Trade offered',
  'counter-trade': 'Counteroffer made',
  'respond-trade': 'Trade answered',
  'move-robber': 'Robber moved',
  'end-turn': 'Turn passed',
}

function TransitionMoment({ presentation, humanId }: { presentation: GamePresentation; humanId: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const timeout = window.setTimeout(() => setVisible(false), 1_800)
    return () => window.clearTimeout(timeout)
  }, [presentation.revision])
  if (!visible || presentation.actionType === 'roll-dice') return null
  const deltas = presentation.resourceDeltas[humanId] ?? {}
  const changes = RESOURCES.filter((resource) => deltas[resource]).map((resource) => ({ resource, delta: deltas[resource]! }))
  const message = presentation.events.at(-1)?.message
  const development = presentation.actionType === 'buy-development' || presentation.actionType === 'play-development'
  const robber = presentation.actionType === 'move-robber' || presentation.actionType === 'steal-from'
  return <div className={`transition-moment ${development ? 'development-moment' : robber ? 'robber-moment' : ''}`} role="status">
    {development ? <div className="card-reveal"><img src="/assets/resource-development.webp" alt="" /><b>{presentation.actionType === 'play-development' ? 'Development played' : 'Mystery card'}</b></div> : null}
    {robber ? <div className="robber-reveal" aria-hidden="true"><i>♟</i><span /></div> : null}
    <div><strong>{actionLabel[presentation.actionType] ?? presentation.actionType.replaceAll('-', ' ')}</strong>{message ? <span>{message}</span> : null}{presentation.awardChanges.map((change) => <em key={change}>★ {change}</em>)}</div>
    {changes.length ? <ul className="resource-deltas">{changes.map(({ resource, delta }) => <li key={resource} className={resource}><img src={RESOURCE_IMAGE[resource]} alt="" /><b>{delta > 0 ? `+${delta}` : delta}</b></li>)}</ul> : null}
  </div>
}

function AgentDecisionPreview({ game, thinkingPlayerId, agentStatuses }: Pick<HudProps, 'game' | 'thinkingPlayerId' | 'agentStatuses'>) {
  const actor = game.players.find((player) => player.id === thinkingPlayerId && player.controller === 'agent')
  if (!actor) return null
  const status = agentStatuses[actor.id]
  const stage = status?.state ?? 'idle'
  return <aside className={`agent-decision-preview ${stage}`} aria-live="polite">
    <span className={`player-crest ${actor.color}`}>{actor.name[0]}</span><div><strong>{actor.name}</strong><small>Local agent · revision {status?.revision ?? game.revision}</small></div><i aria-hidden="true" /><p>{stage === 'thinking' ? 'Choosing a move' : 'Waiting for agent'}</p>
  </aside>
}

const actionPreviewCopy = (action: GameAction) => {
  if (action.type === 'place-settlement' || action.type === 'build-settlement') return ['Found this settlement?', 'Confirm the glowing corner or choose another.']
  if (action.type === 'build-city') return ['Raise this city?', 'The selected settlement will become a two-point city.']
  if (action.type === 'place-road' || action.type === 'build-road') return ['Lay this road?', 'Confirm the highlighted route or choose another.']
  return ['Move the robber here?', 'This tile will stop producing until the robber moves again.']
}

function ActionPreview({ action, onConfirm, onCancel }: { action: GameAction; onConfirm: () => void; onCancel: () => void }) {
  const [title, detail] = actionPreviewCopy(action)
  const returnFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => () => {
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : document.querySelector<HTMLElement>('.board-targets button, .turn-panel')
      target?.focus()
    })
  }, [])
  return <section className="action-preview" aria-live="polite"><div><strong>{title}</strong><span>{detail}</span></div><button onClick={onCancel}>Cancel</button><button className="confirm" autoFocus onClick={onConfirm}>Confirm</button></section>
}

function ResourceWallet({ game, humanId, onCards }: Pick<HudProps, 'game' | 'humanId'> & { onCards: () => void }) {
  const player = game.players.find((candidate) => candidate.id === humanId)
  if (!player) return null
  return <section className="resource-wallet" aria-label="Your resources">
    {RESOURCES.map((resource) => <article className={`resource-card ${resource}`} key={resource} title={resource}>
      <img src={RESOURCE_IMAGE[resource]} alt="" /><span>{player.resources[resource]}</span><small>{resource}</small>
    </article>)}
    <button className="resource-card development" title="Open development cards" onClick={onCards}><img src="/assets/resource-development.webp" alt="" /><span>{player.development.length}</span><small>cards</small></button>
  </section>
}

const BUILD_COMMANDS = [
  { kind: 'road', label: 'Road', mode: 'road', actionType: 'build-road' },
  { kind: 'settlement', label: 'Settle', mode: 'settlement', actionType: 'build-settlement' },
  { kind: 'city', label: 'City', mode: 'city', actionType: 'build-city' },
] as const

function CostPips({ kind }: { kind: keyof typeof BUILD_COSTS }) {
  return <span className="cost-pips" aria-hidden="true">{RESOURCES.flatMap((resource) => Array.from({ length: BUILD_COSTS[kind][resource] ?? 0 }, (_, index) => <img key={`${resource}-${index}`} src={RESOURCE_IMAGE[resource]} alt="" />))}</span>
}

function ActionTray(props: HudProps) {
  const { game, humanId, placementMode, onDialog, onPlacementMode, onAction } = props
  const humanTurn = currentActorId(game) === humanId
  const roll = game.legalActions.find((action) => action.type === 'roll-dice')
  const end = game.legalActions.find((action) => action.type === 'end-turn' || action.type === 'finish-road-building')
  const buyDevelopment = game.legalActions.find((action) => action.type === 'buy-development')
  const inAction = game.phase === 'action' && humanTurn
  if (!humanTurn || ['setup-settlement', 'setup-road', 'discard', 'move-robber', 'choose-victim', 'year-of-plenty', 'monopoly', 'trade-response'].includes(game.phase)) return null
  return <nav className="action-tray wood-panel" aria-label="Turn actions">
    {inAction ? <div className="build-rail" aria-label="Build">
      {BUILD_COMMANDS.map((command) => {
        const choices = game.legalActions.filter((action) => action.type === command.actionType).length
        const selected = placementMode === command.mode
        return <button key={command.kind} className={`build-command ${command.kind} ${selected ? 'selected' : ''}`} disabled={!choices} onClick={() => onPlacementMode(selected ? null : command.mode)} aria-pressed={selected} aria-label={`${command.label}, ${choices} legal locations`}><i aria-hidden="true" /><span>{command.label}</span><CostPips kind={command.kind} /><em>{choices}</em></button>
      })}
      <button className="build-command development" disabled={!buyDevelopment} onClick={() => buyDevelopment && onAction(buyDevelopment)} aria-label={`Buy development card, ${game.developmentDeckCount} remain`}><CardsIcon /><span>Develop</span><CostPips kind="development" /><em>{game.developmentDeckCount}</em></button>
    </div> : null}
    <div className="turn-rail">
      {game.phase === 'pre-roll' ? <button className="primary" disabled={!roll} onClick={() => roll && onAction(roll)}><DiceIcon /><span>Roll</span></button> : null}
      {inAction ? <button onClick={() => onDialog('trade')}><TradeIcon /><span>Trade</span></button> : null}
      {['pre-roll', 'action'].includes(game.phase) ? <button onClick={() => onDialog('cards')}><CardsIcon /><span>Cards</span></button> : null}
      {end ? <button className="finish" onClick={() => onAction(end)}><FlagIcon /><span>{end.type === 'finish-road-building' ? 'Finish' : 'End'}</span></button> : null}
    </div>
  </nav>
}

const coachCopy: Partial<Record<GameDisplayState['phase'], { title: string; detail: string }>> = {
  'setup-settlement': { title: 'Found your first outpost', detail: 'Pick a corner touching productive numbers and a mix of resources.' },
  'setup-road': { title: 'Point toward your expansion', detail: 'Your road must touch the settlement you just placed.' },
  discard: { title: 'A seven was rolled', detail: 'Hands above seven discard half before the robber moves.' },
  'move-robber': { title: 'Block a rival tile', detail: 'The robber stops production there and may let you steal from an adjacent rival.' },
  'choose-victim': { title: 'Choose one adjacent rival', detail: 'You steal one random resource without seeing their hand.' },
  'road-building': { title: 'Road Building is active', detail: 'Place up to two free roads, or finish early.' },
  'year-of-plenty': { title: 'Year of Plenty is active', detail: 'Take any two cards the bank can still supply.' },
  monopoly: { title: 'Monopoly is active', detail: 'Name one resource; every rival gives you all of that type.' },
  'trade-response': { title: 'A trade is waiting', detail: 'Accept, decline, or send a counteroffer without revealing your hand.' },
}

function ContextCoach({ game, humanId }: Pick<HudProps, 'game' | 'humanId'>) {
  const actorId = currentActorId(game)
  if (actorId !== humanId) return null
  const copy = coachCopy[game.phase]
  if (!copy) return null
  return <aside className="context-coach" aria-live="polite"><strong>{copy.title}</strong><span>{copy.detail}</span></aside>
}

export function Hud(props: HudProps) {
  const { game, muted, onMuted, onExitMatch, onDialog, error } = props
  return <div className="hud-layer">
    <TurnPanel game={game} thinkingPlayerId={props.thinkingPlayerId} onAction={props.onAction} placementMode={props.placementMode} />
    <ContextCoach game={game} humanId={props.humanId} />
    <PlayerRail game={game} humanId={props.humanId} agentStatuses={props.agentStatuses} />
    <ResourceWallet game={game} humanId={props.humanId} onCards={() => onDialog('cards')} />
    <ActionTray {...props} />
    <div className="utility-controls">
      <button className="history-button" onClick={() => onDialog('history')} title="Open match history and controller status"><b aria-hidden="true">☷</b><span>History</span></button>
      <button className={muted ? '' : 'active'} onClick={() => onMuted(!muted)} title={muted ? 'Turn sound on' : 'Mute sound'}><b aria-hidden="true">♫</b><span>{muted ? 'Sound off' : 'Sound on'}</span></button>
      <button onClick={() => onDialog('rules')} title="Rules"><BookIcon /><span>Rules</span></button>
      <button onClick={onExitMatch} title="Leave this match"><b aria-hidden="true">⌂</b><span>Menu</span></button>
    </div>
    <DiceMoment game={game} presentation={props.presentation} />
    <AgentDecisionPreview game={game} thinkingPlayerId={props.thinkingPlayerId} agentStatuses={props.agentStatuses} />
    {props.presentation ? <TransitionMoment key={props.presentation.revision} presentation={props.presentation} humanId={props.humanId} /> : null}
    {props.pendingAction ? <ActionPreview action={props.pendingAction} onConfirm={props.onConfirmAction} onCancel={props.onCancelAction} /> : null}
    {error ? <div className="toast" role="alert">{error}</div> : null}
  </div>
}
