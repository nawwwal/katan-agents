import { useEffect, useRef, useState } from 'react'
import { visibleScore } from '../game/room'
import type { DomesticTrade, GameAction, GameDisplayState, Resource, Resources } from '../game/types'
import { RESOURCES, emptyResources } from '../game/types'
import { CardsIcon, CheckIcon, CloseIcon, HandIcon, HarborIcon, ResourceGlyph, TradeIcon, VictoryIcon } from './Icons'
import { RESOURCE_IMAGE, RESOURCE_LABEL, buildHand, describeResources, resourceTotal, spreadResources } from './gameVisuals'
import { uiSound, useControlSound } from './uiSound'
import { useOverlay } from './useOverlay'
import { useRovingFocus } from './useRovingFocus'

/*
 * Trading happens on the table, not in a form.
 *
 * The whole design is one asymmetry: your side is real face-up card stock you
 * move out of your own hand, their side is silhouetted slots you are asking to
 * be filled. You can see what you are giving because you hold it. You cannot
 * see what you are asking for, because hands are hidden. The form could not
 * teach that; the table teaches it without a sentence.
 */

type TradeProps = {
  game: GameDisplayState
  humanId: string
  onClose: () => void
  onAction: (action: GameAction) => boolean
}

/** Where the offer is, which is most of the work. */
type TableState = 'composing' | 'sent' | 'declined' | 'accepted' | 'no-takers' | 'empty'

const fill = (values: Partial<Resources>): Resources => {
  const next = emptyResources()
  for (const resource of RESOURCES) next[resource] = values[resource] ?? 0
  return next
}

const anyOverlap = (give: Resources, ask: Resources) => RESOURCES.some((resource) => give[resource] > 0 && ask[resource] > 0)

/** `held` minus what is already on the table, so a staged card leaves the fan. */
const remaining = (held: Resources, staged: Resources) => {
  const next = emptyResources()
  for (const resource of RESOURCES) next[resource] = Math.max(0, held[resource] - staged[resource])
  return next
}

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 520px)')
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/* ------------------------------------------------------------- surfaces -- */

function TableShell({ title, state, locked, onClose, children }: {
  title: string
  state: TableState | 'responding' | 'countering'
  locked: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  useOverlay(rootRef, surfaceRef, { locked, onClose })
  const sound = useControlSound()
  // The veil paints the scrim and nothing else: it takes no pointer events, so
  // the island underneath stays pannable for the whole negotiation.
  return <div ref={rootRef} className="trade-veil" role="presentation">
    <section ref={surfaceRef} tabIndex={-1} className="trade-table" data-state={state} role="dialog" aria-modal="true" aria-label={title} {...sound}>
      {children}
    </section>
  </div>
}

function TableHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return <header className="table-header">
    <TradeIcon aria-hidden="true" />
    <h2>{title}</h2>
    <span className="privacy-mark" title="Only public totals are visible">Hands stay hidden</span>
    {onClose
      ? <button className="icon-button" onClick={onClose} aria-label="Close the trade table"><CloseIcon /></button>
      : <span className="icon-button-spacer" />}
  </header>
}

/* ---------------------------------------------------------------- parts -- */

/** Real, face-up, countable card stock. This is your side of the table. */
function FaceStack({ values, label, onTakeBack, tone }: {
  values: Resources
  label: string
  onTakeBack?: (resource: Resource) => void
  tone: 'give' | 'get'
}) {
  const cards = spreadResources(values)
  return <div className={`offer-zone ${tone}`}>
    <small className="zone-label">{label}</small>
    <div className="offer-stack" role="group" aria-label={`${label}: ${describeResources(values)}`} style={{ '--n': cards.length } as React.CSSProperties}>
      {cards.length ? cards.map((card, index) => {
        const face = <><img src={RESOURCE_IMAGE[card.resource]} alt="" draggable={false} /><span className="card-scrim" aria-hidden="true" /></>
        return onTakeBack
          ? <button
            key={card.key}
            type="button"
            className={`table-card ${card.resource}`}
            style={{ '--i': index } as React.CSSProperties}
            onClick={() => onTakeBack(card.resource)}
            aria-label={`${RESOURCE_LABEL[card.resource]} on the table, take it back`}
          >{face}</button>
          : <span key={card.key} className={`table-card ${card.resource}`} style={{ '--i': index } as React.CSSProperties}>{face}</span>
      }) : [0, 1, 2].map((index) => <span key={index} className="table-card ghost" style={{ '--i': index } as React.CSSProperties} aria-hidden="true" />)}
    </div>
  </div>
}

/**
 * Their side. Silhouettes, not cards: you are asking for something you cannot
 * see, and the outline says so without a caption.
 */
function AskZone({ values, onRemove, onAdd, blocked }: {
  values: Resources
  onRemove: (resource: Resource) => void
  onAdd: (resource: Resource) => void
  blocked: (resource: Resource) => boolean
}) {
  const slots = spreadResources(values)
  return <div className="offer-zone ask">
    <small className="zone-label">You want</small>
    <div className="ask-slots" role="group" aria-label={`You want: ${describeResources(values)}`} style={{ '--n': slots.length } as React.CSSProperties}>
      {slots.length ? slots.map((slot, index) => <button
        key={slot.key}
        type="button"
        className={`ask-slot ${slot.resource}`}
        style={{ '--i': index } as React.CSSProperties}
        onClick={() => onRemove(slot.resource)}
        aria-label={`Asking for ${RESOURCE_LABEL[slot.resource]}, remove it`}
      ><ResourceGlyph resource={slot.resource} /></button>)
        : [0, 1, 2].map((index) => <span key={index} className="ask-slot empty" style={{ '--i': index } as React.CSSProperties} aria-hidden="true" />)}
    </div>
    <div className="ask-picker" role="group" aria-label="Ask for a card">
      {RESOURCES.map((resource) => <button
        key={resource}
        type="button"
        data-weight="soft"
        disabled={blocked(resource)}
        onClick={() => onAdd(resource)}
        aria-label={`Ask for ${RESOURCE_LABEL[resource]}`}
        title={RESOURCE_LABEL[resource]}
      ><ResourceGlyph resource={resource} /></button>)}
    </div>
  </div>
}

/**
 * The same hand as the HUD, drawn with the same geometry so the fan reads as
 * continuous rather than as a second widget. Clicking a card puts it on the
 * table; drag does the same thing for people who reach for it first.
 */
function TableHand({ held, onTake, label }: { held: Resources; onTake?: (resource: Resource) => void; label: string }) {
  const cards = buildHand(held)
  const roving = useRovingFocus(cards.length)
  const empties = RESOURCES.filter((resource) => !held[resource])
  return <div className="table-hand" role="group" aria-label={label}>
    <div className="hand-fan" ref={roving.listRef} onKeyDown={roving.onKeyDown} style={{ '--n': cards.length } as React.CSSProperties}>
      {cards.map((card, index) => <button
        key={card.key}
        data-roving=""
        data-weight="soft"
        type="button"
        draggable={Boolean(onTake)}
        onDragStart={(event) => event.dataTransfer.setData('text/plain', card.resource)}
        tabIndex={index === roving.index ? 0 : -1}
        onFocus={() => roving.setActive(index)}
        disabled={!onTake}
        onClick={() => onTake?.(card.resource)}
        className={`hand-card ${card.resource} ${card.stacked ? 'stacked' : ''}`}
        style={{ '--i': index } as React.CSSProperties}
        aria-label={onTake ? `${RESOURCE_LABEL[card.resource]}, ${held[card.resource]} in hand, put one on the table` : `${RESOURCE_LABEL[card.resource]}, ${held[card.resource]} in hand`}
      >
        <img src={RESOURCE_IMAGE[card.resource]} alt="" draggable={false} />
        <span className="card-scrim" aria-hidden="true" />
        {card.stacked ? <b className="card-count tnum">{card.stacked}</b> : null}
      </button>)}
    </div>
    {empties.length ? <div className="hand-empties" aria-hidden="true">
      {empties.map((resource) => <span key={resource} className="empty-slot"><ResourceGlyph resource={resource} /></span>)}
    </div> : null}
  </div>
}

/** Partners sit around the far edge of the table. Picking one aims the offer. */
function PartnerSeats({ game, humanId, target, refused, declinedBy, onPick, disabled, retarget }: {
  game: GameDisplayState
  humanId: string
  target: string
  refused: string[]
  declinedBy?: string
  onPick: (playerId: string) => void
  disabled: boolean
  retarget: boolean
}) {
  const rivals = game.players.filter((candidate) => candidate.id !== humanId)
  return <div className="partner-seats" role="radiogroup" aria-label="Trade partner">
    {rivals.map((rival) => {
      const struck = refused.includes(rival.id)
      const selected = rival.id === target
      return <button
        key={rival.id}
        role="radio"
        aria-checked={selected}
        disabled={disabled || (retarget && struck)}
        data-weight={retarget ? 'deep' : undefined}
        className={`partner-seat ${rival.color} ${selected ? 'selected' : ''} ${struck ? 'struck' : ''} ${declinedBy === rival.id ? 'declined' : ''}`}
        onClick={() => onPick(rival.id)}
        aria-label={retarget && !struck
          ? `Send the same offer to ${rival.name}`
          : `${rival.name}, ${visibleScore(game, rival.id, humanId)} points, ${rival.resourceCount} cards, ${rival.developmentCount} development cards${struck ? ', declined this offer' : ''}`}
      >
        <span className={`player-crest ${rival.color}`}>{rival.name.slice(0, 1)}</span>
        <strong>{rival.name}</strong>
        <small className="tnum" aria-hidden="true">
          <b><VictoryIcon />{visibleScore(game, rival.id, humanId)}</b>
          <b><HandIcon />{rival.resourceCount}</b>
          <b><CardsIcon />{rival.developmentCount}</b>
        </small>
        <span className="seat-hairline" aria-hidden="true" />
      </button>
    })}
  </div>
}

/**
 * The harbor is not a peer of player trade. It is a rate card pinned to the
 * edge: pick the stack you can spare, pick what you want back, done in two
 * clicks, and it never takes half the screen again.
 */
function HarborRail({ game, humanId, onAction, onClose }: TradeProps) {
  const [give, setGive] = useState<Resource>()
  const maritime = game.legalActions.filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade')
  const held = game.players.find((candidate) => candidate.id === humanId)?.resources ?? emptyResources()
  const rateFor = (resource: Resource) => maritime.filter((action) => action.give === resource).map((action) => action.ratio).sort((left, right) => left - right)[0] ?? 4
  const commit = (receive: Resource) => {
    if (!give) return
    const action = maritime.filter((candidate) => candidate.give === give && candidate.receive === receive).sort((left, right) => left.ratio - right.ratio)[0]
    if (action && onAction(action)) { uiSound('ui-click-deep'); onClose() }
  }
  return <aside className="harbor-rail" aria-label="Harbor">
    <h3><HarborIcon />Harbor</h3>
    <dl className="harbor-rates">
      <dt>Your bank rates</dt>
      {RESOURCES.map((resource) => {
        const ratio = rateFor(resource)
        const ready = maritime.some((action) => action.give === resource)
        return <dd key={resource}>
          <button
            type="button"
            data-weight="soft"
            className={`${ready ? 'ready' : ''} ${give === resource ? 'selected' : ''}`}
            disabled={!ready}
            aria-pressed={give === resource}
            onClick={() => setGive((current) => current === resource ? undefined : resource)}
            aria-label={ready
              ? `Give ${ratio} ${RESOURCE_LABEL[resource].toLowerCase()} at ${ratio} to 1`
              : `${RESOURCE_LABEL[resource]}, ${ratio} to 1, you hold ${held[resource]}`}
          >
            <ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span><b className="tnum">{ratio}:1</b>
          </button>
        </dd>
      })}
    </dl>
    <div className="harbor-return">
      <small className="zone-label">Get</small>
      <div className="harbor-get" role="group" aria-label="Get from the bank">
        {RESOURCES.map((resource) => <button
          key={resource}
          type="button"
          data-weight="deep"
          disabled={!give || !maritime.some((action) => action.give === give && action.receive === resource)}
          onClick={() => commit(resource)}
          aria-label={give ? `Exchange ${rateFor(give)} ${RESOURCE_LABEL[give].toLowerCase()} for 1 ${RESOURCE_LABEL[resource].toLowerCase()}` : `Get ${RESOURCE_LABEL[resource]}, pick what to give first`}
          title={RESOURCE_LABEL[resource]}
        ><ResourceGlyph resource={resource} /></button>)}
      </div>
      <p className="harbor-note">{!maritime.length
        ? resourceTotal(held) ? 'The harbor opens on your turn.' : 'The bank wants a full stack. You hold none.'
        : give ? `Pick what to take for ${rateFor(give)} ${RESOURCE_LABEL[give].toLowerCase()}.` : 'Pick a stack to give first.'}</p>
    </div>
  </aside>
}

/* ----------------------------------------------------------- your offer -- */

export function TradeTable({ game, humanId, onClose, onAction }: TradeProps) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const rivals = game.players.filter((candidate) => candidate.id !== humanId)
  const [give, setGive] = useState<Resources>(emptyResources)
  const [ask, setAsk] = useState<Resources>(emptyResources)
  const [target, setTarget] = useState(rivals[0]?.id ?? '')
  const [refused, setRefused] = useState<string[]>([])
  const [answer, setAnswer] = useState<{ kind: 'declined' | 'accepted'; by: string }>()
  const [tab, setTab] = useState<'players' | 'harbor'>('players')
  const narrow = useNarrow()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // An answer to *your* offer, read off the event at the current revision. The
  // engine has no "trade resolved" signal, so the log is the channel.
  useEffect(() => {
    const answers = game.events.filter((candidate) => candidate.revision === game.revision
      && (candidate.type === 'trade-rejected' || candidate.type === 'trade-accepted')
      && candidate.trade?.fromPlayerId === humanId)
    const taken = answers.find((candidate) => candidate.type === 'trade-accepted')
    if (taken?.trade) { setAnswer({ kind: 'accepted', by: taken.trade.toPlayerId }); return }
    const last = answers.at(-1)
    if (!last?.trade) return
    // Declined offers come back intact so they can be retargeted in one click.
    const said = answers.map((candidate) => candidate.trade!.toPlayerId)
    setGive(fill(last.trade.give))
    setAsk(fill(last.trade.receive))
    setRefused((current) => [...new Set([...current, ...said])])
    setTarget(rivals.find((rival) => !said.includes(rival.id))?.id ?? last.trade.toPlayerId)
    setAnswer({ kind: 'declined', by: last.trade.toPlayerId })
    uiSound('ui-close')
  }, [game.revision])

  const accepted = answer?.kind === 'accepted'
  useEffect(() => {
    if (!accepted) return
    const timeout = window.setTimeout(() => closeRef.current(), 1_300)
    return () => window.clearTimeout(timeout)
  }, [accepted])

  const outgoing = game.pendingTrade?.fromPlayerId === humanId ? game.pendingTrade : undefined
  const handEmpty = resourceTotal(player.resources) === 0
  const state: TableState = outgoing ? 'sent'
    : accepted ? 'accepted'
      : answer?.kind === 'declined' ? (refused.length >= rivals.length ? 'no-takers' : 'declined')
        : handEmpty ? 'empty' : 'composing'
  const composing = state === 'composing' || state === 'empty'
  const retarget = state === 'declined' || state === 'no-takers'

  const shown = outgoing ? fill(outgoing.give) : give
  const wanted = outgoing ? fill(outgoing.receive) : ask
  const giveTotal = resourceTotal(shown)
  const askTotal = resourceTotal(wanted)
  const overlap = anyOverlap(give, ask)
  const partner = game.players.find((candidate) => candidate.id === (outgoing?.toPlayerId ?? answer?.by ?? target))
  const decliner = game.players.find((candidate) => candidate.id === answer?.by)
  const nextSeat = game.players.find((candidate) => candidate.id === target)

  // Editing the offer retires the last answer: a changed offer is a new offer.
  const edit = (next: () => void) => { next(); setAnswer(undefined); setRefused([]) }
  const stage = (resource: Resource) => edit(() => setGive((current) => current[resource] >= player.resources[resource] ? current : { ...current, [resource]: current[resource] + 1 }))
  const unstage = (resource: Resource) => edit(() => setGive((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) })))
  const addAsk = (resource: Resource) => edit(() => setAsk((current) => ({ ...current, [resource]: Math.min(19, current[resource] + 1) })))
  const dropAsk = (resource: Resource) => edit(() => setAsk((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) })))
  const clear = () => edit(() => { setGive(emptyResources()); setAsk(emptyResources()) })

  const legalTo = (playerId: string) => game.legalActions.some((action) => action.type === 'offer-trade' && action.trade.toPlayerId === playerId)
  const sendable = giveTotal > 0 && askTotal > 0 && !overlap && RESOURCES.every((resource) => give[resource] <= player.resources[resource])
  const send = (toPlayerId: string) => {
    if (!sendable || !legalTo(toPlayerId)) return
    const action: GameAction = { type: 'offer-trade', trade: { fromPlayerId: humanId, toPlayerId, give, receive: ask } }
    if (onAction(action)) { setAnswer(undefined); setTarget(toPlayerId) }
  }

  const status = state === 'sent' ? `${partner?.name ?? 'They'} is considering.`
    : state === 'accepted' ? `${partner?.name ?? 'They'} accepted.`
      : state === 'no-takers' ? 'No takers. Change the offer, or trade with the harbor.'
        : state === 'declined' ? `${decliner?.name ?? 'They'} declined. Send the same offer to ${nextSeat?.name ?? 'the other seat'}, or change it.`
          : state === 'empty' ? 'Your hand is empty. There is nothing to offer until you produce.'
            : overlap ? 'You cannot ask for what you are giving.'
              : giveTotal && askTotal ? `You give ${describeResources(shown)} for ${describeResources(wanted)}.`
                : giveTotal || askTotal ? 'Put something on both sides.'
                  : 'Set what you give and what you want.'

  const showHarbor = !narrow || tab === 'harbor'
  const showPlayers = !narrow || tab === 'players'

  return <TableShell title="Trade table" state={state} locked={state === 'sent'} onClose={onClose}>
    <TableHeader title="Trade table" onClose={state === 'sent' ? undefined : onClose} />
    {narrow ? <div className="table-tabs" role="tablist" aria-label="Trade">
      <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>Players</button>
      <button role="tab" aria-selected={tab === 'harbor'} onClick={() => setTab('harbor')}>Harbor</button>
    </div> : null}

    <div className="table-body">
      {showHarbor ? <HarborRail game={game} humanId={humanId} onAction={onAction} onClose={onClose} /> : null}
      {showPlayers ? <div className="table-play">
        <PartnerSeats
          game={game}
          humanId={humanId}
          target={outgoing?.toPlayerId ?? target}
          refused={refused}
          declinedBy={answer?.kind === 'declined' ? answer.by : undefined}
          onPick={(playerId) => retarget ? send(playerId) : setTarget(playerId)}
          disabled={state === 'sent' || state === 'accepted'}
          retarget={retarget}
        />
        {/* Both halves of the offer travel as one element with one transform, so
            the ask and the give never land on top of each other in flight. */}
        <div className="table-offer">
          <AskZone
            values={wanted}
            onRemove={dropAsk}
            onAdd={addAsk}
            blocked={(resource) => !composing && !retarget ? true : give[resource] > 0}
          />
          <div
            className="give-drop"
            onDragOver={(event) => { if (composing || retarget) event.preventDefault() }}
            onDrop={(event) => {
              event.preventDefault()
              const resource = event.dataTransfer.getData('text/plain') as Resource
              if (RESOURCES.includes(resource)) stage(resource)
            }}
          >
            <FaceStack values={shown} label="You give" tone="give" onTakeBack={composing || retarget ? unstage : undefined} />
          </div>
        </div>
        <p className="table-status" role="status">{status}</p>
        <div className="table-actions">
          <button type="button" className="table-reset" disabled={state === 'sent' || accepted || (!giveTotal && !askTotal)} onClick={clear}>Clear offer</button>
          <button
            type="button"
            className="table-send"
            data-weight="deep"
            disabled={state === 'sent' || accepted || state === 'no-takers' || !sendable || !legalTo(outgoing?.toPlayerId ?? target)}
            onClick={() => send(target)}
            aria-label={sendable && partner ? `Send offer to ${partner.name}: give ${describeResources(shown)} for ${describeResources(wanted)}` : 'Send offer'}
          ><CheckIcon />Send offer</button>
        </div>
        <TableHand
          held={remaining(player.resources, give)}
          onTake={composing || retarget ? stage : undefined}
          label="Your hand"
        />
      </div> : null}
    </div>
  </TableShell>
}

/* -------------------------------------------------------- their offer -- */

/**
 * The mirror. What you get and what you give are both known here, so both are
 * real face-up stacks; silhouettes belong only to a request. Counter is a peer
 * of accept and decline, and composing one uses the same hand rather than a
 * second set of ten steppers hidden below the fold.
 */
export function TradeResponse({ game, humanId, onAction }: Omit<TradeProps, 'onClose'>) {
  const trade = game.pendingTrade
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const [countering, setCountering] = useState(false)
  const [give, setGive] = useState<Resources>(emptyResources)
  const [ask, setAsk] = useState<Resources>(emptyResources)
  if (!trade) return null
  const from = game.players.find((candidate) => candidate.id === trade.fromPlayerId)
  const accept = game.legalActions.find((action): action is Extract<GameAction, { type: 'respond-trade' }> => action.type === 'respond-trade' && action.accept)
  const reject = game.legalActions.find((action): action is Extract<GameAction, { type: 'respond-trade' }> => action.type === 'respond-trade' && !action.accept)

  const get = fill(trade.give)
  const owe = fill(trade.receive)
  const overlap = anyOverlap(give, ask)
  const canCounter = game.legalActions.some((action) => action.type === 'counter-trade')
    && resourceTotal(give) > 0 && resourceTotal(ask) > 0 && !overlap
    && RESOURCES.every((resource) => give[resource] <= player.resources[resource])
  const counter: GameAction | undefined = canCounter && from ? { type: 'counter-trade', trade: { fromPlayerId: humanId, toPlayerId: from.id, give, receive: ask } } : undefined

  const title = `${from?.name ?? 'A player'} offers a trade`
  const status = countering
    ? overlap ? 'You cannot ask for what you are giving.'
      : canCounter ? `You give ${describeResources(give)} for ${describeResources(ask)}.`
        : 'Set what you give and what you want.'
    : `${from?.name ?? 'They'} gives ${describeResources(get)} for ${describeResources(owe)}.`

  return <TableShell title={title} state={countering ? 'countering' : 'responding'} locked onClose={() => {}}>
    <TableHeader title={title} />
    <div className="table-body solo">
      <div className="table-play">
        <div className="partner-seats one">
          <span className={`partner-seat ${from?.color ?? 'ivory'} selected`}>
            <span className={`player-crest ${from?.color ?? 'ivory'}`}>{from?.name.slice(0, 1)}</span>
            <strong>{from?.name}</strong>
            <small className="tnum" aria-hidden="true">
              <b><HandIcon />{from?.resourceCount ?? 0}</b>
              <b><CardsIcon />{from?.developmentCount ?? 0}</b>
            </small>
            <span className="seat-hairline waiting" aria-hidden="true" />
          </span>
        </div>
        {countering
          ? <AskZone values={ask} onRemove={(resource) => setAsk((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) }))} onAdd={(resource) => setAsk((current) => ({ ...current, [resource]: Math.min(19, current[resource] + 1) }))} blocked={(resource) => give[resource] > 0} />
          : <FaceStack values={get} label="You get" tone="get" />}
        <FaceStack
          values={countering ? give : owe}
          label="You give"
          tone="give"
          onTakeBack={countering ? (resource) => setGive((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) })) : undefined}
        />
        <p className="table-status" role="status">{status}</p>
        {countering
          ? <div className="table-actions three">
            <button type="button" className="table-reset" onClick={() => { setCountering(false); setGive(emptyResources()); setAsk(emptyResources()) }}>Back</button>
            <button type="button" className="table-send" data-weight="deep" disabled={!counter} onClick={() => counter && onAction(counter)}>Send counteroffer</button>
          </div>
          : <div className="table-actions three">
            <button type="button" className="table-reset" onClick={() => reject && onAction(reject)} aria-label={`Decline ${from?.name ?? 'this'} offer`}>Decline</button>
            <button type="button" className="table-counter" onClick={() => setCountering(true)}>Counter with</button>
            <button type="button" className="table-send" data-weight="deep" disabled={!accept} onClick={() => accept && onAction(accept)} aria-label={`Accept: get ${describeResources(get)} for ${describeResources(owe)}`}>{accept ? <><CheckIcon />Accept</> : 'Accept'}</button>
          </div>}
        <TableHand
          held={countering ? remaining(player.resources, give) : player.resources}
          onTake={countering ? (resource) => setGive((current) => current[resource] >= player.resources[resource] ? current : { ...current, [resource]: current[resource] + 1 }) : undefined}
          label="Your hand"
        />
      </div>
    </div>
  </TableShell>
}

/* --------------------------------------------------------- spectating -- */

/**
 * Two thirds of a match is watching. A trade you are not part of used to be
 * invisible; now it reads at a glance, in both players' colors, with the
 * waiting hairline under the seat that owes an answer.
 */
export function TradeWatch({ game, humanId }: { game: GameDisplayState; humanId: string }) {
  const trade: DomesticTrade | undefined = game.pendingTrade
  if (!trade || game.phase !== 'trade-response') return null
  if (trade.fromPlayerId === humanId || trade.toPlayerId === humanId) return null
  const from = game.players.find((candidate) => candidate.id === trade.fromPlayerId)
  const to = game.players.find((candidate) => candidate.id === trade.toPlayerId)
  const line = `${from?.name ?? 'A player'} offers ${describeResources(trade.give)} to ${to?.name ?? 'a player'} for ${describeResources(trade.receive)}.`
  return <div className="trade-watch" role="status" aria-label={line}>
    <span className={`player-crest ${from?.color ?? 'ivory'}`} aria-hidden="true">{from?.name.slice(0, 1)}</span>
    <div aria-hidden="true">
      <span className="watch-side">{RESOURCES.filter((resource) => trade.give[resource]).map((resource) =>
        <b key={resource} className="tnum"><ResourceGlyph resource={resource} />{trade.give[resource]}</b>)}</span>
      <TradeIcon className="watch-swap" />
      <span className="watch-side">{RESOURCES.filter((resource) => trade.receive[resource]).map((resource) =>
        <b key={resource} className="tnum"><ResourceGlyph resource={resource} />{trade.receive[resource]}</b>)}</span>
    </div>
    <span className={`player-crest ${to?.color ?? 'ivory'}`} aria-hidden="true">{to?.name.slice(0, 1)}</span>
    <span className="hairline-run" aria-hidden="true" />
  </div>
}
