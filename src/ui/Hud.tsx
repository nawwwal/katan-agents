import { useEffect, useRef, useState } from 'react'
import { currentActorId } from '../game/engine'
import { visibleScore } from '../game/room'
import type { AgentStatus, GameAction, GameDisplayState, Resource } from '../game/types'
import type { GamePresentation } from '../game/useGame'
import { RESOURCES, emptyResources } from '../game/types'
import type { PlacementMode } from '../scene/GameScene'
import { diceThrowPlan } from '../scene/motion/diceThrow'
import { useReducedMotion } from '../scene/useReducedMotion'
import {
  BUILD_ICON, BookIcon, CardsIcon, DiceIcon, DiePips, FlagIcon, HandIcon, HomeIcon, KnightIcon,
  LargestArmyIcon, LongestRoadIcon, ResourceGlyph, RobberIcon, ScrollIcon, SoundOffIcon, SoundOnIcon, TradeIcon,
} from './Icons'
import { TradeWatch } from './Trade'
import { BUILD_COSTS, RESOURCE_IMAGE, RESOURCE_LABEL, buildHand } from './gameVisuals'
import { uiSound, useControlSound } from './uiSound'
import { useRovingFocus } from './useRovingFocus'

export type DialogName = 'trade' | 'cards' | 'rules' | 'history' | null

type HudProps = {
  game: GameDisplayState
  humanId: string
  thinkingPlayerId?: string
  agentStatuses: Record<string, AgentStatus>
  presentation?: GamePresentation
  muted: boolean
  placementMode: PlacementMode
  dialog: DialogName
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

/** Build kinds whose cost can be previewed against the hand. */
type CostPreview = keyof typeof BUILD_COSTS | null

const phaseCopy: Record<GameDisplayState['phase'], string> = {
  'setup-settlement': 'Place settlement',
  'setup-road': 'Place adjacent road',
  'pre-roll': 'Roll dice',
  action: 'Build and trade',
  discard: 'Discard half',
  'move-robber': 'Move robber',
  'choose-victim': 'Choose rival',
  'road-building': 'Place free roads',
  'year-of-plenty': 'Choose two resources',
  monopoly: 'Choose one resource',
  'trade-response': 'Answer pending',
  'game-over': 'Match complete',
}

/**
 * The coaching line the old `ContextCoach` panel carried. It now lives inside the
 * turn panel's fixed footprint, which is what deletes the five `:has()` collision
 * rules that only existed to keep two stacked panels apart.
 */
const coachCopy: Partial<Record<GameDisplayState['phase'], string>> = {
  'setup-settlement': 'Pick a corner touching productive numbers and a mix of resources.',
  'setup-road': 'Your road must touch the settlement you just placed.',
  discard: 'Hands above seven discard half before the robber moves.',
  'move-robber': 'The robber stops production and may let you steal from a neighbor.',
  'choose-victim': 'You steal one random resource without seeing their hand.',
  'road-building': 'Place up to two free roads, or finish early.',
  'year-of-plenty': 'Take any two cards the bank can still supply.',
  monopoly: 'Name one resource; every rival gives you all of that type.',
  'trade-response': 'Accept, decline, or counter. Nothing about your hand is revealed either way.',
}

const countResources = (game: GameDisplayState, playerId: string) => {
  const player = game.players.find((candidate) => candidate.id === playerId)
  return player?.resourceCount ?? 0
}

const agentStatusCopy: Record<AgentStatus['state'], string> = {
  idle: 'Waiting',
  thinking: 'Turn pending',
}

/* ------------------------------------------------------------ turn panel -- */

type TurnPanelProps = Pick<HudProps, 'game' | 'humanId' | 'thinkingPlayerId' | 'agentStatuses' | 'onAction' | 'placementMode' | 'onDialog' | 'onExitMatch'>

function TurnPanel({ game, humanId, thinkingPlayerId, agentStatuses, onAction, placementMode, onDialog, onExitMatch }: TurnPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => { panelRef.current?.focus() }, [])
  const actorId = currentActorId(game)
  const actor = game.players.find((player) => player.id === actorId)
  const yours = actorId === humanId
  const waiting = !yours
  const agentStage = actorId ? agentStatuses[actorId]?.state : undefined
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
  // One fixed footprint: the phase line and the detail line are always both present,
  // so nothing below the panel ever moves as the turn changes.
  const yourOfferOut = game.phase === 'trade-response' && game.pendingTrade?.fromPlayerId === humanId
  const detail = yourOfferOut
    ? `Offer sent. Waiting on ${actor?.name ?? 'them'}.`
    : waiting
      ? thinkingPlayerId === actorId && agentStage === 'thinking' ? 'Choosing a move' : `${actor?.name ?? 'A player'} is acting`
      : coachCopy[game.phase] ?? 'Your move.'
  return <section ref={panelRef} className={`turn-panel ${waiting ? 'waiting' : ''}`} aria-live="polite" tabIndex={-1}>
    <div className="turn-owner">
      <span className={`player-crest ${actor?.color ?? 'ivory'}`}>{actor?.name.slice(0, 1)}</span>
      <div>
        <small>{waiting ? 'Their turn' : 'Your turn'}</small>
        <strong>{actor?.name}</strong>
        <span className="turn-phase">{phaseCopy[game.phase]}</span>
      </div>
      <div className="turn-dice" aria-label={game.lastRoll ? `Last roll ${game.lastRoll[0] + game.lastRoll[1]}` : 'No roll yet'}>
        {game.lastRoll
          ? game.lastRoll.map((face, index) => <span className="die" key={index}><DiePips value={face} /></span>)
          : <><span className="die empty" aria-hidden="true" /><span className="die empty" aria-hidden="true" /></>}
      </div>
    </div>
    <p className="turn-detail">{detail}</p>
    <div className="turn-marks">
      <button onClick={() => onDialog('history')} aria-label="Open match history"><ScrollIcon /><span>Log</span></button>
      <button onClick={() => onDialog('rules')} aria-label="Open the rules"><BookIcon /><span>Rules</span></button>
      <button onClick={onExitMatch} aria-label="Leave this match and return to the menu"><HomeIcon /><span>Leave</span></button>
    </div>
    {/* Transient, and last, so the marks row above it never moves. */}
    <div className="turn-suggest">
      {suggested ? <button className="setup-suggest" data-weight="deep" onClick={() => onAction(suggested)}>{suggestedLabel}</button> : null}
    </div>
    <span className="hairline-run" aria-hidden="true" />
  </section>
}

/* ------------------------------------------------------------ player rail -- */

function PlayerRail({ game, humanId, agentStatuses, muted, onMuted }: Pick<HudProps, 'game' | 'humanId' | 'agentStatuses' | 'muted' | 'onMuted'>) {
  const activeId = currentActorId(game)
  return <aside className="player-rail" aria-label="Players">
    <div className="rail-marks">
      <button className={muted ? '' : 'active'} onClick={() => onMuted(!muted)} aria-label={muted ? 'Turn sound on' : 'Mute sound'} aria-pressed={!muted}>{muted ? <SoundOffIcon /> : <SoundOnIcon />}</button>
    </div>
    {game.players.map((player, index) => {
      const road = game.longestRoad?.playerId === player.id
      const army = game.largestArmy?.playerId === player.id
      const status = player.controller === 'agent'
        ? `${agentStatusCopy[agentStatuses[player.id]?.state ?? 'idle']}${agentStatuses[player.id]?.detail ? ` · ${agentStatuses[player.id]?.detail}` : ''}`
        : 'Human'
      return <article key={player.id} className={`player-row ${player.color} ${activeId === player.id ? 'active' : ''}`} style={{ '--row': index } as React.CSSProperties}>
        <span className="player-bar" aria-hidden="true" />
        <span className={`player-crest ${player.color}`}>{player.name.slice(0, 1)}</span>
        <div className="player-identity"><strong>{player.name}</strong><small title={player.controller === 'agent' ? agentStatuses[player.id]?.detail : undefined}>{status}</small></div>
        {/* A reserved slot, always present and empty when unearned, so winning an award never reflows a row. */}
        <div className="player-awards" aria-hidden="true">
          <span className={road ? 'earned' : ''}>{road ? <LongestRoadIcon /> : null}</span>
          <span className={army ? 'earned' : ''}>{army ? <LargestArmyIcon /> : null}</span>
        </div>
        <div className="player-counts tnum" aria-hidden="true">
          <span title="Resource cards"><HandIcon />{countResources(game, player.id)}</span>
          <span title="Development cards"><CardsIcon />{player.developmentCount}</span>
          <span title="Knights played"><KnightIcon />{player.playedKnights}</span>
        </div>
        <strong className="player-vp tnum" aria-label={`${player.name}: ${visibleScore(game, player.id, humanId)} victory points, ${countResources(game, player.id)} resource cards, ${player.developmentCount} development cards, ${player.playedKnights} knights played${road ? ', longest road' : ''}${army ? ', largest army' : ''}`}>{visibleScore(game, player.id, humanId)}</strong>
      </article>
    })}
  </aside>
}

/* ----------------------------------------------------------------- hand -- */

/** Flags a card for one beat when its count moves, so gains and spends register peripherally. */
const useCountPulse = (counts: Record<string, number>) => {
  const previous = useRef(counts)
  const [pulses, setPulses] = useState<Record<string, 'gained' | 'spent'>>({})
  const signature = Object.values(counts).join(',')
  useEffect(() => {
    const next: Record<string, 'gained' | 'spent'> = {}
    for (const [key, value] of Object.entries(counts)) {
      const before = previous.current[key]
      if (before === undefined || before === value) continue
      next[key] = value > before ? 'gained' : 'spent'
    }
    previous.current = counts
    if (!Object.keys(next).length) return
    setPulses(next)
    const timeout = window.setTimeout(() => setPulses({}), 560)
    return () => window.clearTimeout(timeout)
  }, [signature])
  return pulses
}

type HandProps = Pick<HudProps, 'game' | 'humanId'> & { costPreview: CostPreview; yourTurn: boolean }

function ResourceHand({ game, humanId, costPreview, yourTurn }: HandProps) {
  const player = game.players.find((candidate) => candidate.id === humanId)
  const held = player?.resources ?? emptyResources()
  const counts = Object.fromEntries(RESOURCES.map((resource) => [resource, held[resource]]))
  const pulses = useCountPulse(counts)
  const cards = buildHand(held)
  const roving = useRovingFocus(cards.length)
  if (!player) return null
  const cost = costPreview ? BUILD_COSTS[costPreview] : undefined
  // How many cards of each resource the previewed build would spend, so the hand
  // itself answers "can I afford this" and the cost pip row can be deleted.
  const spendBudget: Partial<Record<Resource, number>> = cost ? { ...cost } : {}
  const spent = new Set<string>()
  if (cost) for (const card of cards) {
    const remaining = spendBudget[card.resource] ?? 0
    if (remaining <= 0) continue
    spendBudget[card.resource] = remaining - 1
    spent.add(card.key)
  }
  const empties = RESOURCES.filter((resource) => !held[resource])
  return <div className={`resource-hand ${yourTurn ? '' : 'recessed'} ${cost ? 'previewing' : ''}`} role="group" aria-label="Your resource cards">
    <div className="hand-fan" ref={roving.listRef} onKeyDown={roving.onKeyDown} style={{ '--n': cards.length } as React.CSSProperties}>
      {cards.map((card, index) => <button
        key={card.key}
        data-roving=""
        type="button"
        tabIndex={index === roving.index ? 0 : -1}
        onFocus={() => roving.setActive(index)}
        className={`hand-card ${card.resource} ${pulses[card.resource] ?? ''} ${spent.has(card.key) ? 'spending' : cost ? 'receding' : ''} ${card.stacked ? 'stacked' : ''}`}
        style={{ '--i': index } as React.CSSProperties}
        aria-label={`${RESOURCE_LABEL[card.resource]}, ${held[card.resource]} held`}
      >
        <img src={RESOURCE_IMAGE[card.resource]} alt="" draggable={false} />
        <span className="card-scrim" aria-hidden="true" />
        {card.stacked ? <b className="card-count tnum">{card.stacked}</b> : null}
      </button>)}
    </div>
    {/* Zero of a resource is no card, only a thin slot. An empty hand should look empty. */}
    {empties.length ? <div className="hand-empties" aria-hidden="true">
      {empties.map((resource) => <span key={resource} className={`empty-slot ${cost?.[resource] ? 'wanted' : ''}`}><ResourceGlyph resource={resource} /></span>)}
    </div> : null}
  </div>
}

/* ------------------------------------------------------------- commands -- */

const BUILD_COMMANDS = [
  { kind: 'road', label: 'Road', mode: 'road', actionType: 'build-road' },
  { kind: 'settlement', label: 'Settle', mode: 'settlement', actionType: 'build-settlement' },
  { kind: 'city', label: 'City', mode: 'city', actionType: 'build-city' },
] as const

/** Cost reads as a tint dot plus a tabular count, never as a row of 10px glyphs. */
function CostRow({ kind }: { kind: keyof typeof BUILD_COSTS }) {
  return <span className="cost-row tnum" aria-hidden="true">{RESOURCES.filter((resource) => BUILD_COSTS[kind][resource]).map((resource) =>
    <span key={resource}>{BUILD_COSTS[kind][resource]}<i className={`cost-dot ${resource}`} /></span>)}</span>
}

type CommandProps = HudProps & { onCostPreview: (kind: CostPreview) => void }

function Commands(props: CommandProps) {
  const { game, humanId, placementMode, onPlacementMode, onAction, onCostPreview } = props
  const humanTurn = currentActorId(game) === humanId
  const roll = game.legalActions.find((action) => action.type === 'roll-dice')
  const end = game.legalActions.find((action) => action.type === 'end-turn' || action.type === 'finish-road-building')
  const buyDevelopment = game.legalActions.find((action) => action.type === 'buy-development')
  const inAction = game.phase === 'action' && humanTurn
  const held = game.players.find((candidate) => candidate.id === humanId)?.resources ?? emptyResources()
  const affords = (kind: keyof typeof BUILD_COSTS) => RESOURCES.every((resource) => held[resource] >= (BUILD_COSTS[kind][resource] ?? 0))
  const buildable = [...BUILD_COMMANDS.map((command) => inAction ? game.legalActions.filter((action) => action.type === command.actionType).length : 0), inAction && buyDevelopment ? 1 : 0]
  const anyBuild = buildable.some(Boolean)
  const reason = humanTurn
    ? inAction ? 'No build is legal with this hand.' : `Not the build phase · ${phaseCopy[game.phase].toLowerCase()}`
    : 'Another player is acting.'
  // Exactly one primary at a time: Roll before the roll, End Turn after it.
  const rollPhase = game.phase === 'pre-roll' && humanTurn
  return <div className="commands" aria-label="Turn actions">
    <div className="build-group" role="toolbar" aria-label="Build">
      <div className="build-plinth">
        {BUILD_COMMANDS.map((command, index) => {
          const choices = buildable[index]
          const selected = placementMode === command.mode
          const Mark = BUILD_ICON[command.kind]
          return <button
            key={command.kind}
            className={`build-command ${command.kind} ${selected ? 'selected' : ''}`}
            data-weight="soft"
            disabled={!choices}
            tabIndex={index === 0 ? 0 : -1}
            onClick={() => onPlacementMode(selected ? null : command.mode)}
            onMouseEnter={() => onCostPreview(command.kind)}
            onMouseLeave={() => onCostPreview(null)}
            onFocus={() => onCostPreview(command.kind)}
            onBlur={() => onCostPreview(null)}
            aria-pressed={selected}
            aria-label={`${command.label}, ${!affords(command.kind) ? 'not affordable' : `${choices} legal locations`}`}
          ><Mark className="command-mark" /><span>{command.label}</span><CostRow kind={command.kind} /><em className="tnum">{choices}</em></button>
        })}
        <button
          className="build-command development"
          data-weight="deep"
          disabled={!buildable[3]}
          tabIndex={-1}
          onClick={() => buyDevelopment && onAction(buyDevelopment)}
          onMouseEnter={() => onCostPreview('development')}
          onMouseLeave={() => onCostPreview(null)}
          onFocus={() => onCostPreview('development')}
          onBlur={() => onCostPreview(null)}
          aria-label={`Buy development card, ${!affords('development') ? 'not affordable' : `${game.developmentDeckCount} remain`}`}
        ><CardsIcon className="command-mark" /><span>Develop</span><CostRow kind="development" /><em className="tnum">{game.developmentDeckCount}</em></button>
      </div>
      {/* The group never unmounts. It disables and says why, so nothing in the band shifts. */}
      <small className="build-reason">{anyBuild ? 'Choose what to build' : reason}</small>
    </div>
    <div className="turn-commands">
      {rollPhase
        ? <button className="turn-command primary" data-weight="deep" disabled={!roll} onClick={() => roll && onAction(roll)} aria-label="Roll the dice"><DiceIcon className="command-mark" /><span>Roll</span></button>
        : <button className={`turn-command finish ${end ? 'primary' : ''}`} data-weight="deep" disabled={!end} onClick={() => end && onAction(end)} aria-label={end?.type === 'finish-road-building' ? 'Finish placing roads' : 'End your turn'}><FlagIcon className="command-mark" /><span>{end?.type === 'finish-road-building' ? 'Finish' : 'End turn'}</span></button>}
    </div>
  </div>
}

/* -------------------------------------------------------------- moments -- */

/** One roll, held whole, so the reveal is never assembled from two moments. */
type DiceThrow = { roll: [number, number]; revision: number; deltas: GamePresentation['resourceDeltas'] }

function DiceMoment({ game, presentation }: { game: GameDisplayState; presentation?: GamePresentation }) {
  const reducedMotion = useReducedMotion()
  const [dice, setDice] = useState<DiceThrow>()
  // The throw is latched apart from the reveal so a later action landing while
  // the dice are still in the air cannot cancel a reveal that has not happened.
  // The deltas are latched with it: the panel now appears a second later than it
  // used to, and by then `presentation` can already be describing someone else's
  // move, which would print the wrong production under the right total.
  const [thrown, setThrown] = useState<DiceThrow>()
  useEffect(() => {
    if (!game.lastRoll || presentation?.actionType !== 'roll-dice') return
    setThrown({ roll: game.lastRoll, revision: presentation.revision, deltas: presentation.resourceDeltas })
  }, [game.lastRoll?.[0], game.lastRoll?.[1], presentation?.revision])
  useEffect(() => {
    if (!thrown) return
    // The physical dice tumble for about 1.28s. Printing the total while they
    // are still deciding is what makes a fair roll feel fixed, so the panel
    // waits out the same memoised plan the renderer and the audio scheduler
    // play back rather than a constant that could drift from either. Under
    // reduced motion the die shows its number from the first frame, so there
    // is nothing left to spoil.
    const land = reducedMotion ? 0 : diceThrowPlan(thrown.roll, thrown.revision, 0).duration * 1_000
    setDice(land ? undefined : thrown)
    const reveal = land ? window.setTimeout(() => setDice(thrown), land) : undefined
    const clear = window.setTimeout(() => setDice(undefined), land + 1_450)
    return () => {
      if (reveal !== undefined) window.clearTimeout(reveal)
      window.clearTimeout(clear)
    }
  }, [thrown, reducedMotion])
  if (!dice) return null
  const allocations = game.players.map((player) => ({
    player,
    resources: RESOURCES.filter((resource) => (dice.deltas[player.id]?.[resource] ?? 0) > 0).map((resource) => ({ resource, amount: dice.deltas[player.id]?.[resource] ?? 0 })),
  })).filter(({ resources }) => resources.length)
  return <div className="dice-moment" role="status" aria-label={`Rolled ${dice.roll[0] + dice.roll[1]}`}>
    <div>{dice.roll.map((face, index) => <span key={index}><DiePips value={face} /></span>)}</div><strong className="tnum">{dice.roll[0] + dice.roll[1]}</strong>
    {allocations.length ? <ul className="production-summary">{allocations.map(({ player, resources }) => <li key={player.id} className={player.color}><b>{player.name}</b><div>{resources.map(({ resource, amount }) => <span key={resource} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} />+{amount}</span>)}</div></li>)}</ul> : <small className="production-none">No settlement produced</small>}
  </div>
}

const actionLabel: Partial<Record<GameAction['type'], string>> = {
  'place-settlement': 'Settlement founded',
  'place-road': 'Road laid',
  'build-settlement': 'Settlement built',
  'build-road': 'Road built',
  'build-city': 'City raised',
  'buy-development': 'Development card bought',
  'maritime-trade': 'Traded at the harbor',
  'offer-trade': 'Offer sent',
  'counter-trade': 'Counteroffer sent',
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
    {robber ? <div className="robber-reveal" aria-hidden="true"><RobberIcon /><span /></div> : null}
    <div><strong>{actionLabel[presentation.actionType] ?? presentation.actionType.replaceAll('-', ' ')}</strong>{message ? <span>{message}</span> : null}{presentation.awardChanges.map((change) => <em key={change}>{change}</em>)}</div>
    {changes.length ? <ul className="resource-deltas">{changes.map(({ resource, delta }, index) => <li key={resource} className={delta > 0 ? '' : 'loss'} style={{ '--row': index } as React.CSSProperties} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><b className="tnum">{delta > 0 ? `+${delta}` : delta}</b></li>)}</ul> : null}
  </div>
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
  return <section className="action-preview" aria-live="polite"><div><strong>{title}</strong><span>{detail}</span></div><button onClick={onCancel}>Cancel</button><button className="confirm" data-weight="deep" autoFocus onClick={onConfirm}>Confirm</button></section>
}

/* ------------------------------------------------------------------ hud -- */

export function Hud(props: HudProps) {
  const { game, muted, onMuted, onExitMatch, onDialog, error } = props
  const [costPreview, setCostPreview] = useState<CostPreview>(null)
  const humanTurn = currentActorId(game) === props.humanId
  const inAction = game.phase === 'action' && humanTurn
  const sound = useControlSound()
  useEffect(() => { if (error) uiSound('ui-error') }, [error])
  return <div className="hud-layer" {...sound}>
    <TurnPanel
      game={game}
      humanId={props.humanId}
      thinkingPlayerId={props.thinkingPlayerId}
      agentStatuses={props.agentStatuses}
      onAction={props.onAction}
      placementMode={props.placementMode}
      onDialog={onDialog}
      onExitMatch={onExitMatch}
    />
    <PlayerRail game={game} humanId={props.humanId} agentStatuses={props.agentStatuses} muted={muted} onMuted={onMuted} />
    {/* One continuous band along the bottom edge: your hand flowing into your commands.
        No tray, no utility cluster, no rounded box floating above the edge. */}
    {/* The trade table draws the same hand at the same edge, so the band steps
        aside rather than stacking a second fan under it. Hidden, never unmounted:
        nothing in the bottom band is allowed to reflow. */}
    <div className={`table-band ${props.dialog === 'trade' ? 'handed-off' : ''}`}>
      <div className="band-hand">
        <ResourceHand game={game} humanId={props.humanId} costPreview={costPreview} yourTurn={humanTurn} />
        <div className="hand-marks">
          <button disabled={!inAction} onClick={() => onDialog('trade')} aria-label="Open the trade table"><TradeIcon /><span>Trade</span></button>
          <button disabled={!['pre-roll', 'action'].includes(game.phase) || !humanTurn} onClick={() => onDialog('cards')} aria-label={`Development cards, ${game.players.find((candidate) => candidate.id === props.humanId)?.development.length ?? 0} held`}><CardsIcon /><span>Cards</span></button>
        </div>
      </div>
      <Commands {...props} onCostPreview={setCostPreview} />
    </div>
    <TradeWatch game={game} humanId={props.humanId} />
    <DiceMoment game={game} presentation={props.presentation} />
    {props.presentation ? <TransitionMoment key={props.presentation.revision} presentation={props.presentation} humanId={props.humanId} /> : null}
    {props.pendingAction ? <ActionPreview action={props.pendingAction} onConfirm={props.onConfirmAction} onCancel={props.onCancelAction} /> : null}
    {error ? <div className="toast" role="alert">{error}</div> : null}
  </div>
}
