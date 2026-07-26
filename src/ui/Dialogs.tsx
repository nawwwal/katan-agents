import { useEffect, useMemo, useRef, useState } from 'react'
import { currentActorId } from '../game/engine'
import { visibleScore } from '../game/room'
import type { AgentStatus, DevelopmentCard, GameAction, GameDisplayState, Resource, Resources } from '../game/types'
import { RESOURCES, emptyResources } from '../game/types'
import type { DialogName } from './Hud'
import { BookIcon, CardsIcon, CheckIcon, CloseIcon, HandIcon, HarborIcon, ResourceGlyph, ScrollIcon, TradeIcon, VictoryIcon } from './Icons'
import { DEVELOPMENT_ART, DEVELOPMENT_CARDS, DEVELOPMENT_NAME, DEVELOPMENT_SHORT, RESOURCE_LABEL } from './gameVisuals'
import { uiSound } from './uiSound'

type DialogProps = {
  game: GameDisplayState
  humanId: string
  dialog: DialogName
  agentStatuses?: Record<string, AgentStatus>
  onClose: () => void
  onAction: (action: GameAction) => boolean
}

function Modal({ title, icon, children, onClose, locked = false, wide = false }: { title: string; icon?: React.ReactNode; children: React.ReactNode; onClose: () => void; locked?: boolean; wide?: boolean }) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = dialogRef.current
    const backdrop = backdropRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    // Discard, choose-victim, year-of-plenty, monopoly and trade-response are all
    // decisions *about the board*, so the world layers stay live and pannable while
    // a modal is open. They hold nothing focusable, so the focus trap is unaffected.
    const worldLayers = '.game-canvas, .ocean-layer, .vignette, .copyright-note'
    const siblings = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop && !element.matches(worldLayers))
      : []
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    uiSound('ui-open')
    const focusable = dialog?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')
    ;(focusable ?? dialog)?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      uiSound('ui-close')
      siblings.forEach((element, index) => { element.inert = previousInert[index] })
      if (previousFocus?.isConnected) previousFocus.focus()
      else document.querySelector<HTMLElement>('.board-targets button, .turn-panel, .utility-controls button:not(:disabled)')?.focus()
    }
  }, [locked])

  return <div ref={backdropRef} className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!locked && event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} tabIndex={-1} className={`game-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header>{icon ?? <span className="modal-icon-spacer" />}<h2>{title}</h2>{!locked ? <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button> : <span />}</header>
      <div className="modal-body">{children}</div>
    </section>
  </div>
}

function TradeDialog({ game, humanId, onClose, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onClose' | 'onAction'>) {
  const maritime = game.legalActions.filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade')
  const [give, setGive] = useState<Resource>(maritime[0]?.give ?? 'brick')
  const [receive, setReceive] = useState<Resource>(maritime[0]?.receive ?? 'grain')
  const [maritimeRatio, setMaritimeRatio] = useState<2 | 3 | 4>()
  const [otherId, setOtherId] = useState(game.players.find((candidate) => candidate.id !== humanId)?.id ?? '')
  const [domesticGive, setDomesticGive] = useState<Resources>(() => emptyResources())
  const [domesticReceive, setDomesticReceive] = useState<Resources>(() => emptyResources())
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const matchingMaritime = maritime.filter((action) => action.give === give && action.receive === receive)
  const selectedMaritime = matchingMaritime.find((action) => action.ratio === maritimeRatio) ?? matchingMaritime[0]
  const giveTotal = RESOURCES.reduce((total, resource) => total + domesticGive[resource], 0)
  const receiveTotal = RESOURCES.reduce((total, resource) => total + domesticReceive[resource], 0)
  const overlap = RESOURCES.some((resource) => domesticGive[resource] > 0 && domesticReceive[resource] > 0)
  const canOffer = game.legalActions.some((action) => action.type === 'offer-trade' && action.trade.toPlayerId === otherId)
    && giveTotal > 0
    && receiveTotal > 0
    && !overlap
    && RESOURCES.every((resource) => domesticGive[resource] <= player.resources[resource])
  const domesticAction: Extract<GameAction, { type: 'offer-trade' }> | undefined = canOffer ? {
    type: 'offer-trade',
    trade: { fromPlayerId: humanId, toPlayerId: otherId, give: domesticGive, receive: domesticReceive },
  } : undefined
  useEffect(() => setMaritimeRatio(undefined), [give, receive])

  const chooseGive = (resource: Resource) => {
    setGive(resource)
    if (!maritime.some((action) => action.give === resource && action.receive === receive)) setReceive(maritime.find((action) => action.give === resource)?.receive ?? receive)
  }
  return <Modal title="Trade table" icon={<TradeIcon />} onClose={onClose} wide>
    <div className="trade-columns">
      <section className="maritime-table"><header><h3><HarborIcon />Harbor</h3><span className="public-stack" title="Best available exchange rate">{selectedMaritime?.ratio ?? '–'}<small>:1</small></span></header><div className="trade-exchange-picker"><ResourcePicker label="Give" value={give} onChange={chooseGive} disabled={(resource) => !maritime.some((action) => action.give === resource)} /><span className="trade-arrow" aria-hidden="true"><TradeIcon /></span><ResourcePicker label="Receive" value={receive} onChange={setReceive} disabled={(resource) => resource === give || !maritime.some((action) => action.give === give && action.receive === resource)} /></div>
        {matchingMaritime.length > 1 ? <div className="ratio-picker" aria-label="Exchange rate">{matchingMaritime.map((action) => <button className={selectedMaritime?.ratio === action.ratio ? 'selected' : ''} key={action.ratio} onClick={() => setMaritimeRatio(action.ratio)}>{action.ratio}:1</button>)}</div> : null}
        <button className="modal-primary" disabled={!selectedMaritime} onClick={() => { if (selectedMaritime && onAction(selectedMaritime)) onClose() }}>{selectedMaritime ? <><CheckIcon />Exchange {selectedMaritime.ratio} for 1</> : 'Unavailable'}</button>
        <HarborRates maritime={maritime} held={player.resources} />
      </section>
      <section className="domestic-table"><header><h3>Player trade</h3><span className="privacy-mark" title="Only public card totals are visible">Hidden hands</span></header><div className="trade-partners" role="radiogroup" aria-label="Trade partner">{game.players.filter((candidate) => candidate.id !== humanId).map((candidate) => <button role="radio" aria-checked={candidate.id === otherId} className={`${candidate.color} ${candidate.id === otherId ? 'selected' : ''}`} value={candidate.id} key={candidate.id} onClick={() => setOtherId(candidate.id)}><span className={`player-crest ${candidate.color}`}>{candidate.name[0]}</span><strong>{candidate.name}</strong><small title="Public totals"><b><VictoryIcon />{visibleScore(game, candidate.id, humanId)}</b><b><HandIcon />{candidate.resourceCount}</b><b><CardsIcon />{candidate.developmentCount}</b></small></button>)}</div>
        <TradeBundle title="You give" values={domesticGive} limits={player.resources} onChange={setDomesticGive} />
        <TradeBundle title="You ask" values={domesticReceive} onChange={setDomesticReceive} />
        {overlap ? <p className="trade-warning">A resource cannot appear on both sides.</p> : null}
        <TradeSummary give={domesticGive} receive={domesticReceive} />
        <button type="button" className="trade-reset" disabled={!giveTotal && !receiveTotal} onClick={() => { setDomesticGive(emptyResources()); setDomesticReceive(emptyResources()) }}>Clear offer</button>
        <button className="modal-primary" disabled={!domesticAction} onClick={() => { if (domesticAction && onAction(domesticAction)) onClose() }}>{domesticAction ? <><CheckIcon />Send offer</> : 'Choose what to trade'}</button>
      </section>
    </div>
  </Modal>
}

/** Your standing bank rate per resource, so the harbour column answers "what can I actually do?". */
function HarborRates({ maritime, held }: { maritime: Extract<GameAction, { type: 'maritime-trade' }>[]; held: Resources }) {
  const rates = RESOURCES.map((resource) => {
    const best = maritime.filter((action) => action.give === resource).map((action) => action.ratio).sort((left, right) => left - right)[0]
    return { resource, ratio: best ?? 4, ready: best !== undefined && held[resource] >= best }
  })
  return <dl className="harbor-rates">
    <dt>Your bank rates</dt>
    {rates.map(({ resource, ratio, ready }) => <dd key={resource} className={ready ? 'ready' : ''}>
      <ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span><b>{ratio}:1</b>
    </dd>)}
  </dl>
}

/** Restates the staged offer in one line so the player can check it before sending. */
function TradeSummary({ give, receive }: { give: Resources; receive: Resources }) {
  const staged = (values: Resources) => RESOURCES.filter((resource) => values[resource])
  const givens = staged(give)
  const asks = staged(receive)
  if (!givens.length && !asks.length) return <div className="trade-summary">Stage what you give and what you ask.</div>
  const row = (resources: Resource[]) => <div>{resources.length ? resources.map((resource) => <ResourceGlyph key={resource} resource={resource} aria-label={RESOURCE_LABEL[resource]} />) : <em>nothing</em>}</div>
  return <div className="trade-summary" role="status" aria-label={`You give ${givens.map((resource) => `${give[resource]} ${RESOURCE_LABEL[resource]}`).join(', ') || 'nothing'}; you ask ${asks.map((resource) => `${receive[resource]} ${RESOURCE_LABEL[resource]}`).join(', ') || 'nothing'}`}>
    {row(givens)}<TradeIcon className="swap" aria-hidden="true" />{row(asks)}
  </div>
}

function ResourcePicker({ label, value, onChange, disabled }: { label: string; value: Resource; onChange: (resource: Resource) => void; disabled?: (resource: Resource) => boolean }) {
  return <fieldset className="resource-picker"><legend>{label}</legend><div>{RESOURCES.map((resource) => <button key={resource} className={value === resource ? 'selected' : ''} disabled={disabled?.(resource)} onClick={() => onChange(resource)} aria-pressed={value === resource} aria-label={RESOURCE_LABEL[resource]} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /></button>)}</div></fieldset>
}

function TradeBundle({ title, values, limits, onChange }: { title: string; values: Resources; limits?: Resources; onChange: React.Dispatch<React.SetStateAction<Resources>> }) {
  const change = (resource: Resource, value: number) => onChange((current) => ({
    ...current,
    [resource]: Math.max(0, Math.min(limits?.[resource] ?? 19, Number.isFinite(value) ? Math.floor(value) : 0)),
  }))
  return <fieldset className="trade-bundle"><legend>{title}</legend><div>{RESOURCES.map((resource) => <div className={`resource-stepper ${values[resource] ? 'staged' : ''}`} key={resource} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><strong>{values[resource]}</strong><span><button disabled={values[resource] === 0} onClick={() => change(resource, values[resource] - 1)} aria-label={`Remove ${RESOURCE_LABEL[resource]} from ${title}`}>−</button><button disabled={values[resource] >= (limits?.[resource] ?? 19)} onClick={() => change(resource, values[resource] + 1)} aria-label={`Add ${RESOURCE_LABEL[resource]} to ${title}`}>+</button></span>{limits ? <small>{limits[resource]} owned</small> : <small>{RESOURCE_LABEL[resource]}</small>}</div>)}</div></fieldset>
}

function VisualTradeBundle({ title, values }: { title: string; values: Partial<Resources> }) {
  return <div className="trade-contents"><small>{title}</small><div>{RESOURCES.filter((resource) => values[resource]).map((resource) => <span key={resource} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><b>{values[resource]}</b></span>)}</div></div>
}

function TradeResponseDialog({ game, onAction }: Pick<DialogProps, 'game' | 'onAction'>) {
  const trade = game.pendingTrade
  const [counterGive, setCounterGive] = useState<Resources>(() => emptyResources())
  const [counterReceive, setCounterReceive] = useState<Resources>(() => emptyResources())
  if (!trade) return null
  const from = game.players.find((player) => player.id === trade.fromPlayerId)
  const actor = game.players.find((player) => player.id === currentActorId(game))!
  const accept = game.legalActions.find((action): action is Extract<GameAction, { type: 'respond-trade' }> => action.type === 'respond-trade' && action.accept)
  const reject = game.legalActions.find((action): action is Extract<GameAction, { type: 'respond-trade' }> => action.type === 'respond-trade' && !action.accept)
  const counterGiveTotal = RESOURCES.reduce((total, resource) => total + counterGive[resource], 0)
  const counterReceiveTotal = RESOURCES.reduce((total, resource) => total + counterReceive[resource], 0)
  const counterOverlap = RESOURCES.some((resource) => counterGive[resource] > 0 && counterReceive[resource] > 0)
  const canCounter = game.legalActions.some((action) => action.type === 'counter-trade')
    && counterGiveTotal > 0
    && counterReceiveTotal > 0
    && !counterOverlap
    && RESOURCES.every((resource) => counterGive[resource] <= actor.resources[resource])
  const counter: Extract<GameAction, { type: 'counter-trade' }> | undefined = canCounter && from ? {
    type: 'counter-trade',
    trade: { fromPlayerId: actor.id, toPlayerId: from.id, give: counterGive, receive: counterReceive },
  } : undefined
  return <Modal title={`${from?.name ?? 'A player'} offers a trade`} locked onClose={() => {}}>
    <div className="trade-response">
      <VisualTradeBundle title="You receive" values={trade.give} />
      <span aria-hidden="true"><TradeIcon /></span>
      <VisualTradeBundle title="You give" values={trade.receive} />
    </div>
    <div className="trade-response-actions"><button onClick={() => reject && onAction(reject)}>Decline</button><button className="modal-primary" disabled={!accept} onClick={() => accept && onAction(accept)}>Accept trade</button></div>
    <div className="counter-offer"><strong>Counter</strong><TradeBundle title="You give" values={counterGive} limits={actor.resources} onChange={setCounterGive} /><TradeBundle title="You ask" values={counterReceive} onChange={setCounterReceive} />{counterOverlap ? <p className="trade-warning">A resource cannot appear on both sides.</p> : null}<button disabled={!counter} onClick={() => counter && onAction(counter)}>Offer {counterGiveTotal} ↔ {counterReceiveTotal}</button></div>
  </Modal>
}

/**
 * Only the cards you hold, fanned with the same physics as the resource hand.
 * Victory points sit face down at the end of the fan; the play control lives under
 * the fan rather than stamped across the artwork.
 */
function CardsDialog({ game, humanId, onClose, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onClose' | 'onAction'>) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const playable = game.legalActions.filter((action): action is Extract<GameAction, { type: 'play-development' }> => action.type === 'play-development')
  // Victory points sit face down at the end of the fan.
  const held = useMemo(() => {
    const rank = (card: DevelopmentCard) => card === 'victory-point' ? DEVELOPMENT_CARDS.length : DEVELOPMENT_CARDS.indexOf(card)
    return [...player.development].sort((left, right) => rank(left) - rank(right))
  }, [player.development])
  const [active, setActive] = useState(0)
  const index = held.length ? Math.min(active, held.length - 1) : 0
  const current = held[index] as DevelopmentCard | undefined
  const action = current ? playable.find((candidate) => candidate.card === current) : undefined
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step || !held.length) return
    event.preventDefault()
    const next = Math.max(0, Math.min(held.length - 1, index + step))
    setActive(next)
    ;(event.currentTarget.querySelectorAll<HTMLElement>('[data-roving]')[next])?.focus()
  }
  return <Modal title="Development hand" icon={<CardsIcon />} onClose={onClose}>
    {held.length ? <>
      <div className="dev-fan" role="group" aria-label="Development cards you hold" style={{ '--n': held.length } as React.CSSProperties} onKeyDown={onKeyDown}>
        {held.map((card, position) => {
          const hidden = card === 'victory-point'
          return <button
            key={`${card}-${position}`}
            data-roving=""
            type="button"
            tabIndex={position === index ? 0 : -1}
            className={`dev-card ${hidden ? 'facedown' : ''} ${position === index ? 'raised' : ''}`}
            style={{ '--i': position } as React.CSSProperties}
            onFocus={() => setActive(position)}
            onMouseEnter={() => setActive(position)}
            aria-label={hidden ? 'Victory point, held face down' : DEVELOPMENT_NAME[card]}
          >
            {hidden ? <span className="dev-back" aria-hidden="true"><VictoryIcon /></span> : <img src={DEVELOPMENT_ART[card]} alt="" draggable={false} />}
          </button>
        })}
      </div>
      <div className="dev-control" aria-live="polite">
        <div><strong>{current === 'victory-point' ? 'Victory Point' : current ? DEVELOPMENT_NAME[current] : ''}</strong><span>{current === 'victory-point' ? 'Kept hidden until the final count' : current ? DEVELOPMENT_SHORT[current] : ''}</span></div>
        <button className="modal-primary" disabled={!action} onClick={() => { if (action && onAction(action)) { uiSound('ui-click-deep'); onClose() } }}>{current === 'victory-point' ? 'Keep hidden' : 'Play card'}</button>
      </div>
    </> : <p className="modal-empty">You hold no development cards.</p>}
    {game.playedDevelopmentThisTurn ? <p className="modal-note">You have already played a development card this turn.</p> : null}
  </Modal>
}

function DiscardDialog({ game, humanId, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onAction'>) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const required = game.discardRemaining[humanId] ?? 0
  const [chosen, setChosen] = useState<Resources>(() => emptyResources())
  // Reset when *your* discard obligation changes, not on every revision. Another
  // player discarding used to bump the revision and wipe a selection mid-choice.
  useEffect(() => setChosen(emptyResources()), [required])
  const total = RESOURCES.reduce((sum, resource) => sum + chosen[resource], 0)
  return <Modal title={`Discard ${required}`} locked onClose={() => {}}><TradeBundle title="Choose cards" values={chosen} limits={player.resources} onChange={setChosen} /><button className="modal-primary" disabled={total !== required} onClick={() => onAction({ type: 'discard', resources: chosen })}>Discard {total} / {required}</button></Modal>
}

function ChoiceDialog({ game, onAction }: Pick<DialogProps, 'game' | 'onAction'>) {
  const [plenty, setPlenty] = useState<Resource[]>([])
  useEffect(() => setPlenty([]), [game.revision])
  const plentyActions = game.legalActions.filter((action): action is Extract<GameAction, { type: 'choose-year-of-plenty' }> => action.type === 'choose-year-of-plenty')
  const signature = (resources: readonly Resource[]) => [...resources].sort().join('|')
  const plentyAction = plenty.length === 2 ? plentyActions.find((action) => signature(action.resources) === signature(plenty)) : undefined
  const canAddPlenty = (resource: Resource) => {
    const candidate = plenty.length >= 2 ? [resource] : [...plenty, resource]
    return plentyActions.some((action) => candidate.length === 1 ? action.resources.includes(candidate[0]) : signature(action.resources) === signature(candidate))
  }
  const addPlenty = (resource: Resource) => setPlenty((current) => current.length >= 2 ? [resource] : [...current, resource])
  if (game.phase === 'choose-victim') {
    const actions = game.legalActions.filter((action): action is Extract<GameAction, { type: 'steal-from' }> => action.type === 'steal-from')
    return <Modal title="Choose a rival" locked onClose={() => {}}><div className="choice-list">{actions.map((action) => { const player = game.players.find((candidate) => candidate.id === action.playerId)!; return <button key={action.playerId} onClick={() => onAction(action)}><span className={`player-crest ${player.color}`}>{player.name[0]}</span><strong>{player.name}</strong><small><span><HandIcon />{player.resourceCount}</span><span><CardsIcon />{player.developmentCount}</span></small></button> })}</div></Modal>
  }
  if (game.phase === 'year-of-plenty') {
    return <Modal title="Year of Plenty" locked onClose={() => {}}><div className="choice-slots" aria-label="Chosen resources">{[0, 1].map((index) => <button key={index} disabled={!plenty[index]} onClick={() => setPlenty((current) => current.slice(0, index))}>{plenty[index] ? <ResourceGlyph resource={plenty[index]} aria-label={RESOURCE_LABEL[plenty[index]]} /> : <CloseIcon className="slot-plus" style={{ transform: 'rotate(45deg)' }} />}</button>)}</div><div className="resource-choice-grid">{RESOURCES.map((resource) => <button key={resource} disabled={!canAddPlenty(resource)} onClick={() => addPlenty(resource)} aria-label={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span></button>)}</div><button className="modal-primary" disabled={!plentyAction} onClick={() => plentyAction && onAction(plentyAction)}>Take selected pair</button></Modal>
  }
  if (game.phase === 'monopoly') {
    return <Modal title="Monopoly" locked onClose={() => {}}><div className="resource-choice-grid">{RESOURCES.map((resource) => <button key={resource} onClick={() => onAction({ type: 'choose-monopoly', resource })} aria-label={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span></button>)}</div></Modal>
  }
  return null
}

/**
 * The victory announcement, which is not a decision. It renders in the window
 * between the winning move and the server flipping room status, so it must always
 * have a way out: a close mark, Escape, and a button. `locked` is reserved for
 * modals the player genuinely has to answer.
 */
function VictoryDialog({ game }: Pick<DialogProps, 'game'>) {
  const [dismissed, setDismissed] = useState(false)
  const winner = game.players.find((player) => player.id === game.winnerId)
  if (dismissed) return null
  return <Modal title={`${winner?.name ?? 'A player'} wins`} onClose={() => setDismissed(true)}>
    <div className="victory-copy">
      <div className={`victory-crest ${winner?.color ?? 'amber'}`}><VictoryIcon /></div>
      <p>The island recognizes a new steward with <strong>{winner ? visibleScore(game, winner.id) : 10} victory points</strong>.</p>
      <button className="modal-primary" onClick={() => setDismissed(true)}>View the board</button>
    </div>
  </Modal>
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="Base rules" icon={<BookIcon />} onClose={onClose} wide><div className="rules-columns"><section><h3>Your turn</h3><ol><li>Roll both dice.</li><li>Trade with rivals or the bank.</li><li>Build roads, settlements, cities, or development cards.</li><li>End your turn.</li></ol><h3>Build costs</h3><p><strong>Road:</strong> brick + lumber<br /><strong>Settlement:</strong> brick + lumber + wool + grain<br /><strong>City:</strong> 3 ore + 2 grain<br /><strong>Development:</strong> ore + wool + grain</p></section><section><h3>Seven and the robber</h3><p>Players holding more than seven resource cards discard half, rounded down. Move the robber, block that hex, and steal one random card from an adjacent rival.</p><h3>Victory</h3><p>Settlements are 1 point, cities are 2, and Largest Army and Longest Road are 2 each. Reach 10 points on your own turn to win.</p><p className="modal-note">Rules follow the attached 2020 fifth-edition base-game rulebook. The advanced combined trade/build phase is enabled.</p></section></div></Modal>
}

/**
 * One chronological column. The Controllers grid is gone: it duplicated the player
 * rail, which is on screen four inches away for the whole match.
 */
function HistoryDialog({ game, onClose }: Pick<DialogProps, 'game' | 'onClose'>) {
  const colorOf = (playerId?: string) => game.players.find((player) => player.id === playerId)?.color
  const events = game.events.slice(-40).toReversed()
  return <Modal title="Match history" icon={<ScrollIcon />} onClose={onClose}>
    {events.length ? <ol className="history-events">{events.map((event, position) => {
      const color = colorOf(event.playerId)
      const boundary = position > 0 && events[position - 1].revision !== event.revision
      return <li key={event.id} className={`${color ?? ''} ${boundary ? 'turn-boundary' : ''}`}>
        <span className="tnum">{event.revision}</span><p>{event.message}</p>
      </li>
    })}</ol> : <p className="modal-empty">Nothing has happened yet.</p>}
  </Modal>
}

export function Dialogs(props: DialogProps) {
  const humanMustAct = currentActorId(props.game) === props.humanId
  if (humanMustAct && props.game.phase === 'discard') return <DiscardDialog game={props.game} humanId={props.humanId} onAction={props.onAction} />
  if (humanMustAct && props.game.phase === 'trade-response') return <TradeResponseDialog game={props.game} onAction={props.onAction} />
  if (humanMustAct && ['choose-victim', 'year-of-plenty', 'monopoly'].includes(props.game.phase)) return <ChoiceDialog game={props.game} onAction={props.onAction} />
  if (props.game.phase === 'game-over') return <VictoryDialog game={props.game} />
  if (props.dialog === 'trade') return <TradeDialog game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'cards') return <CardsDialog game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'rules') return <RulesDialog onClose={props.onClose} />
  if (props.dialog === 'history') return <HistoryDialog game={props.game} onClose={props.onClose} />
  return null
}
