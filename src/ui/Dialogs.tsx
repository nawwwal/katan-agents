import { useEffect, useMemo, useRef, useState } from 'react'
import { currentActorId } from '../game/engine'
import { visibleScore } from '../game/room'
import type { AgentStatus, DevelopmentCard, GameAction, GameDisplayState, Resource, Resources } from '../game/types'
import { RESOURCES, emptyResources } from '../game/types'
import type { DialogName } from './Hud'
import { TradeResponse, TradeTable } from './Trade'
import { BookIcon, CardsIcon, CloseIcon, HandIcon, ResourceGlyph, ScrollIcon, VictoryIcon } from './Icons'
import { DEVELOPMENT_ART, DEVELOPMENT_CARDS, DEVELOPMENT_NAME, DEVELOPMENT_SHORT, RESOURCE_LABEL } from './gameVisuals'
import { uiSound } from './uiSound'
import { useOverlay } from './useOverlay'

type DialogProps = {
  game: GameDisplayState
  humanId: string
  dialog: DialogName
  agentStatuses?: Record<string, AgentStatus>
  onClose: () => void
  onAction: (action: GameAction) => boolean
}

/**
 * `overBoard` is for a modal whose subject is on the island: it drops the scrim
 * and steps down out of the middle so the markers the player is choosing between
 * stay visible. `useOverlay` already exempts the world layers from inerting, so
 * they were live the whole time; they were simply underneath a full-bleed scrim
 * and a centred card.
 */
function Modal({ title, icon, children, onClose, locked = false, wide = false, overBoard = false }: { title: string; icon?: React.ReactNode; children: React.ReactNode; onClose: () => void; locked?: boolean; wide?: boolean; overBoard?: boolean }) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useOverlay(backdropRef, dialogRef, { locked, onClose })

  return <div ref={backdropRef} className={`modal-backdrop ${overBoard ? 'over-board' : ''}`} role="presentation" onMouseDown={(event) => { if (!locked && event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} tabIndex={-1} className={`game-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header>{icon ?? <span className="modal-icon-spacer" />}<h2>{title}</h2>{!locked ? <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button> : <span />}</header>
      <div className="modal-body">{children}</div>
    </section>
  </div>
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

/**
 * The stepper grid. Trade no longer uses one: composing an offer is moving
 * cards. Discard still does, and discard is owned by another pass, so the grid
 * stays here rather than being redesigned sideways.
 */
function ResourceStepperGrid({ title, values, limits, onChange }: { title: string; values: Resources; limits?: Resources; onChange: React.Dispatch<React.SetStateAction<Resources>> }) {
  const change = (resource: Resource, value: number) => onChange((current) => ({
    ...current,
    [resource]: Math.max(0, Math.min(limits?.[resource] ?? 19, Number.isFinite(value) ? Math.floor(value) : 0)),
  }))
  return <fieldset className="trade-bundle"><legend>{title}</legend><div>{RESOURCES.map((resource) => <div className={`resource-stepper ${values[resource] ? 'staged' : ''}`} key={resource} title={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><strong>{values[resource]}</strong><span><button disabled={values[resource] === 0} onClick={() => change(resource, values[resource] - 1)} aria-label={`Remove ${RESOURCE_LABEL[resource]} from ${title}`}>−</button><button disabled={values[resource] >= (limits?.[resource] ?? 19)} onClick={() => change(resource, values[resource] + 1)} aria-label={`Add ${RESOURCE_LABEL[resource]} to ${title}`}>+</button></span>{limits ? <small>{limits[resource]} owned</small> : <small>{RESOURCE_LABEL[resource]}</small>}</div>)}</div></fieldset>
}

function DiscardDialog({ game, humanId, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onAction'>) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const required = game.discardRemaining[humanId] ?? 0
  const [chosen, setChosen] = useState<Resources>(() => emptyResources())
  // Reset when *your* discard obligation changes, not on every revision. Another
  // player discarding used to bump the revision and wipe a selection mid-choice.
  useEffect(() => setChosen(emptyResources()), [required])
  const total = RESOURCES.reduce((sum, resource) => sum + chosen[resource], 0)
  // The button says what to do next, not what the score is. A disabled control
  // reading "Discard 2 / 4" leaves the player to work out the subtraction.
  const label = total === required
    ? `Discard ${required}`
    : total < required ? `Choose ${required - total} more` : `Put ${total - required} back`
  // The rule itself is in the log once per roll, so this does not restate it. It
  // says what *this* player owes, who else owes one, and that the robber is a
  // separate step: the two arrive together and were being read as one punishment,
  // and a player who knows Catan read a bare "Discard 4" as a broken game.
  const others = game.discardQueue.filter((id) => id !== humanId).map((id) => game.players.find((candidate) => candidate.id === id)?.name).filter(Boolean)
  return <Modal title={`Over the hand limit: discard ${required}`} locked onClose={() => {}}>
    <p className="modal-note">You hold {player.resourceCount} cards and the limit is seven, so {required} go back to the bank.</p>
    <p className="modal-note">{others.length
      ? `${others.join(' and ')} ${others.length > 1 ? 'are' : 'is'} over seven too and ${others.length > 1 ? 'are' : 'is'} discarding as well.`
      : 'Nobody else is over seven, so nobody else is discarding.'} The robber moves after this, and it does not take these cards.</p>
    <ResourceStepperGrid title="Choose what goes" values={chosen} limits={player.resources} onChange={setChosen} />
    <button className="modal-primary" disabled={total !== required} onClick={() => onAction({ type: 'discard', resources: chosen })}>{label}</button>
  </Modal>
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
    return <Modal title="Choose a rival" locked overBoard onClose={() => {}}><div className="choice-list">{actions.map((action) => { const player = game.players.find((candidate) => candidate.id === action.playerId)!; return <button key={action.playerId} onClick={() => onAction(action)}><span className={`player-crest ${player.color}`}>{player.name[0]}</span><strong>{player.name}</strong><small><span><HandIcon />{player.resourceCount}</span><span><CardsIcon />{player.developmentCount}</span></small></button> })}</div></Modal>
  }
  if (game.phase === 'year-of-plenty') {
    return <Modal title="Year of Plenty" locked onClose={() => {}}><div className="choice-slots" aria-label="Chosen resources">{[0, 1].map((index) => <button key={index} disabled={!plenty[index]} onClick={() => setPlenty((current) => current.slice(0, index))}>{plenty[index] ? <ResourceGlyph resource={plenty[index]} aria-label={RESOURCE_LABEL[plenty[index]]} /> : <CloseIcon className="slot-plus" style={{ transform: 'rotate(45deg)' }} />}</button>)}</div><div className="resource-choice-grid">{RESOURCES.map((resource) => <button key={resource} disabled={!canAddPlenty(resource)} onClick={() => addPlenty(resource)} aria-label={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span></button>)}</div><button className="modal-primary" disabled={!plentyAction} onClick={() => plentyAction && onAction(plentyAction)}>Take selected pair</button></Modal>
  }
  if (game.phase === 'monopoly') {
    return <Modal title="Monopoly" locked onClose={() => {}}><p className="modal-note">Name a resource. Every other player hands you all of theirs.</p><div className="resource-choice-grid">{RESOURCES.map((resource) => <button key={resource} onClick={() => onAction({ type: 'choose-monopoly', resource })} aria-label={RESOURCE_LABEL[resource]}><ResourceGlyph resource={resource} /><span>{RESOURCE_LABEL[resource]}</span></button>)}</div></Modal>
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
  if (humanMustAct && props.game.phase === 'trade-response') return <TradeResponse game={props.game} humanId={props.humanId} onAction={props.onAction} />
  if (humanMustAct && ['choose-victim', 'year-of-plenty', 'monopoly'].includes(props.game.phase)) return <ChoiceDialog game={props.game} onAction={props.onAction} />
  if (props.game.phase === 'game-over') return <VictoryDialog game={props.game} />
  if (props.dialog === 'trade') return <TradeTable game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'cards') return <CardsDialog game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'rules') return <RulesDialog onClose={props.onClose} />
  if (props.dialog === 'history') return <HistoryDialog game={props.game} onClose={props.onClose} />
  return null
}
