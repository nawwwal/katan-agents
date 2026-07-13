import { useEffect, useMemo, useRef, useState } from 'react'
import { currentActorId, publicScorePlayer, scorePlayer } from '../game/engine'
import type { AgentStatus, GameAction, GameState, Resource, Resources } from '../game/types'
import { RESOURCES, emptyResources } from '../game/types'
import type { PlacementMode } from '../scene/GameScene'
import type { DialogName } from './Hud'
import { CardsIcon, CloseIcon, HammerIcon, TradeIcon } from './Icons'

type DialogProps = {
  game: GameState
  humanId: string
  dialog: DialogName
  spectating: boolean
  agentStatuses?: Record<string, AgentStatus>
  onClose: () => void
  onAction: (action: GameAction) => void
  onPlacementMode: (mode: PlacementMode) => void
}

const resourceLabel = (resource: Resource) => resource[0].toUpperCase() + resource.slice(1)

function Modal({ title, icon, children, onClose, locked = false, wide = false }: { title: string; icon?: React.ReactNode; children: React.ReactNode; onClose: () => void; locked?: boolean; wide?: boolean }) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = dialogRef.current
    const backdrop = backdropRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const siblings = backdrop?.parentElement ? [...backdrop.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop) : []
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
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

function BuildDialog({ game, onClose, onAction, onPlacementMode }: Omit<DialogProps, 'dialog' | 'humanId' | 'spectating'>) {
  const count = (type: GameAction['type']) => game.legalActions.filter((action) => action.type === type).length
  const development = game.legalActions.find((action) => action.type === 'buy-development')
  const choose = (mode: PlacementMode) => { onPlacementMode(mode); onClose() }
  return <Modal title="Build on the island" icon={<HammerIcon />} onClose={onClose}>
    <div className="build-grid">
      <button disabled={!count('build-road')} onClick={() => choose('road')}><span className="piece road-piece" /><strong>Road</strong><small>1 brick + 1 lumber</small><em>{count('build-road')} paths</em></button>
      <button disabled={!count('build-settlement')} onClick={() => choose('settlement')}><span className="piece settlement-piece" /><strong>Settlement</strong><small>brick + lumber + wool + grain</small><em>{count('build-settlement')} corners</em></button>
      <button disabled={!count('build-city')} onClick={() => choose('city')}><span className="piece city-piece" /><strong>City</strong><small>3 ore + 2 grain</small><em>{count('build-city')} upgrades</em></button>
      <button disabled={!development} onClick={() => { if (development) onAction(development); onClose() }}><img src="/assets/resource-development.webp" alt="" /><strong>Development</strong><small>ore + wool + grain</small><em>{game.developmentDeck.length} left</em></button>
    </div>
  </Modal>
}

function TradeDialog({ game, humanId, onClose, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onClose' | 'onAction'>) {
  const maritime = game.legalActions.filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade')
  const [give, setGive] = useState<Resource>('brick')
  const [receive, setReceive] = useState<Resource>('grain')
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

  return <Modal title="Trade resources" icon={<TradeIcon />} onClose={onClose} wide>
    <div className="trade-columns">
      <section><h3>Maritime trade</h3><p>Use your best harbor rate or choose the always-available 4:1 exchange.</p><div className="trade-row"><label>You give<select value={give} onChange={(event) => setGive(event.target.value as Resource)}>{RESOURCES.map((resource) => <option key={resource} value={resource}>{resourceLabel(resource)}</option>)}</select></label><span className="trade-arrow">→</span><label>You receive<select value={receive} onChange={(event) => setReceive(event.target.value as Resource)}>{RESOURCES.map((resource) => <option key={resource} value={resource}>{resourceLabel(resource)}</option>)}</select></label></div>
        {matchingMaritime.length > 1 ? <label>Exchange rate<select aria-label="Maritime exchange rate" value={selectedMaritime?.ratio ?? 4} onChange={(event) => setMaritimeRatio(Number(event.target.value) as 2 | 3 | 4)}>{matchingMaritime.map((action) => <option key={action.ratio} value={action.ratio}>{action.ratio}:1</option>)}</select></label> : null}
        <button className="modal-primary" disabled={!selectedMaritime} onClick={() => { if (selectedMaritime) onAction(selectedMaritime); onClose() }}>{selectedMaritime ? `Trade ${selectedMaritime.ratio}:1` : 'Trade unavailable'}</button>
      </section>
      <section><h3>Domestic trade</h3><p>Combine any number of cards. The other player decides without revealing their hand.</p><label>Partner<select value={otherId} onChange={(event) => setOtherId(event.target.value)}>{game.players.filter((candidate) => candidate.id !== humanId).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
        <TradeBundle title="You give" values={domesticGive} limits={player.resources} onChange={setDomesticGive} />
        <TradeBundle title="You receive" values={domesticReceive} onChange={setDomesticReceive} />
        {overlap ? <p className="trade-warning">A resource cannot appear on both sides.</p> : null}
        <button className="modal-primary" disabled={!domesticAction} onClick={() => { if (domesticAction) onAction(domesticAction); onClose() }}>Send {giveTotal} for {receiveTotal}</button>
      </section>
    </div>
  </Modal>
}

const describeTradeResources = (resources: Partial<Resources>) => RESOURCES
  .filter((resource) => resources[resource])
  .map((resource) => `${resources[resource]} ${resourceLabel(resource)}`)
  .join(', ')

function TradeBundle({ title, values, limits, onChange }: { title: string; values: Resources; limits?: Resources; onChange: React.Dispatch<React.SetStateAction<Resources>> }) {
  const change = (resource: Resource, value: number) => onChange((current) => ({
    ...current,
    [resource]: Math.max(0, Math.min(limits?.[resource] ?? 19, Number.isFinite(value) ? Math.floor(value) : 0)),
  }))
  return <fieldset className="trade-bundle"><legend>{title}</legend><div>{RESOURCES.map((resource) => <label key={resource}><img src={`/assets/resource-${resource}.webp`} alt="" /><span>{resourceLabel(resource)}</span><input type="number" inputMode="numeric" min="0" max={limits?.[resource] ?? 19} value={values[resource]} onChange={(event) => change(resource, event.currentTarget.valueAsNumber)} aria-label={`${title} ${resource}`} /></label>)}</div></fieldset>
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
      <div><small>You receive</small><strong>{describeTradeResources(trade.give)}</strong></div>
      <span>↔</span>
      <div><small>You give</small><strong>{describeTradeResources(trade.receive)}</strong></div>
    </div>
    <p className="modal-note">Your private hand stays hidden. If you cannot supply the requested card, only decline is available.</p>
    <div className="counter-offer"><strong>Counteroffer</strong><TradeBundle title="You give" values={counterGive} limits={actor.resources} onChange={setCounterGive} /><TradeBundle title="You receive" values={counterReceive} onChange={setCounterReceive} />{counterOverlap ? <p className="trade-warning">A resource cannot appear on both sides.</p> : null}<button disabled={!counter} onClick={() => counter && onAction(counter)}>Send {counterGiveTotal} for {counterReceiveTotal}</button></div>
    <div className="trade-response-actions"><button onClick={() => reject && onAction(reject)}>Decline</button><button className="modal-primary" disabled={!accept} onClick={() => accept && onAction(accept)}>Accept trade</button></div>
  </Modal>
}

const CARD_COPY: Record<string, string> = {
  knight: 'Move the robber and steal a card',
  'road-building': 'Place two roads without paying',
  'year-of-plenty': 'Take any two bank resources',
  monopoly: 'Claim one resource type from every rival',
  'victory-point': 'Hidden until it gives you the win',
}

function CardsDialog({ game, humanId, onClose, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onClose' | 'onAction'>) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const counts = useMemo(() => player.development.reduce<Record<string, number>>((result, card) => ({ ...result, [card]: (result[card] ?? 0) + 1 }), {}), [player.development])
  const playable = game.legalActions.filter((action): action is Extract<GameAction, { type: 'play-development' }> => action.type === 'play-development')
  return <Modal title="Development cards" icon={<CardsIcon />} onClose={onClose}>
    <div className="card-list">{Object.keys(CARD_COPY).map((card) => {
      const action = playable.find((candidate) => candidate.card === card)
      return <article key={card}><img src="/assets/resource-development.webp" alt="" /><div><strong>{card.replaceAll('-', ' ')}</strong><p>{CARD_COPY[card]}</p></div><span>{counts[card] ?? 0}</span>{card !== 'victory-point' ? <button disabled={!action} onClick={() => { if (action) onAction(action); onClose() }}>Play</button> : null}</article>
    })}</div>
    {game.playedDevelopmentThisTurn ? <p className="modal-note">You have already played a development card this turn.</p> : null}
  </Modal>
}

function DiscardDialog({ game, humanId, onAction }: Pick<DialogProps, 'game' | 'humanId' | 'onAction'>) {
  const player = game.players.find((candidate) => candidate.id === humanId)!
  const required = game.discardRemaining[humanId] ?? 0
  const [chosen, setChosen] = useState<Resources>(() => emptyResources())
  useEffect(() => setChosen(emptyResources()), [game.revision])
  const total = RESOURCES.reduce((sum, resource) => sum + chosen[resource], 0)
  const adjust = (resource: Resource, direction: 1 | -1) => setChosen((current) => ({ ...current, [resource]: Math.max(0, Math.min(player.resources[resource], current[resource] + direction)) }))
  return <Modal title={`Discard ${required} cards`} locked onClose={() => {}}><p className="modal-intro">A seven was rolled. Choose exactly half of your hand, rounded down.</p><div className="discard-grid">{RESOURCES.map((resource) => <div key={resource}><strong>{resourceLabel(resource)}</strong><small>{player.resources[resource]} owned</small><div><button onClick={() => adjust(resource, -1)} aria-label={`Remove ${resource}`}>−</button><span>{chosen[resource]}</span><button onClick={() => adjust(resource, 1)} aria-label={`Add ${resource}`}>+</button></div></div>)}</div><button className="modal-primary" disabled={total !== required} onClick={() => onAction({ type: 'discard', resources: chosen })}>Discard {total} / {required}</button></Modal>
}

function ChoiceDialog({ game, onAction }: Pick<DialogProps, 'game' | 'onAction'>) {
  if (game.phase === 'choose-victim') {
    const actions = game.legalActions.filter((action): action is Extract<GameAction, { type: 'steal-from' }> => action.type === 'steal-from')
    return <Modal title="Choose a rival" locked onClose={() => {}}><div className="choice-list">{actions.map((action) => { const player = game.players.find((candidate) => candidate.id === action.playerId)!; return <button key={action.playerId} onClick={() => onAction(action)}><span className={`player-crest ${player.color}`}>{player.name[0]}</span><strong>{player.name}</strong><small>{RESOURCES.reduce((sum, resource) => sum + player.resources[resource], 0)} cards</small></button> })}</div></Modal>
  }
  if (game.phase === 'year-of-plenty') {
    const actions = game.legalActions.filter((action): action is Extract<GameAction, { type: 'choose-year-of-plenty' }> => action.type === 'choose-year-of-plenty')
    return <Modal title="Year of Plenty" locked onClose={() => {}}><p className="modal-intro">Choose a pair the bank can supply.</p><div className="choice-list compact">{actions.map((action, index) => <button key={`${action.resources.join('-')}-${index}`} onClick={() => onAction(action)}><strong>{resourceLabel(action.resources[0])} + {resourceLabel(action.resources[1])}</strong></button>)}</div></Modal>
  }
  if (game.phase === 'monopoly') {
    return <Modal title="Monopoly" locked onClose={() => {}}><p className="modal-intro">Every rival will surrender the resource you name.</p><div className="choice-list compact">{RESOURCES.map((resource) => <button key={resource} onClick={() => onAction({ type: 'choose-monopoly', resource })}><strong>{resourceLabel(resource)}</strong></button>)}</div></Modal>
  }
  if (game.phase === 'game-over') {
    const winner = game.players.find((player) => player.id === game.winnerId)
    return <Modal title={`${winner?.name ?? 'A player'} wins`} locked onClose={() => {}}><div className="victory-copy"><div className={`victory-crest ${winner?.color ?? 'amber'}`}>★</div><p>The island recognizes a new steward with <strong>{winner ? scorePlayer(game, winner.id) : 10} victory points</strong>.</p><button className="modal-primary" onClick={() => onAction({ type: 'restart', seed: game.seed + 1 })}>Settle a new island</button></div></Modal>
  }
  return null
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="Base rules" onClose={onClose} wide><div className="rules-columns"><section><h3>Your turn</h3><ol><li>Roll both dice.</li><li>Trade with rivals or the bank.</li><li>Build roads, settlements, cities, or development cards.</li><li>End your turn.</li></ol><h3>Build costs</h3><p><strong>Road:</strong> brick + lumber<br /><strong>Settlement:</strong> brick + lumber + wool + grain<br /><strong>City:</strong> 3 ore + 2 grain<br /><strong>Development:</strong> ore + wool + grain</p></section><section><h3>Seven and the robber</h3><p>Players holding more than seven resource cards discard half, rounded down. Move the robber, block that hex, and steal one random card from an adjacent rival.</p><h3>Victory</h3><p>Settlements are 1 point, cities are 2, and Largest Army and Longest Road are 2 each. Reach 10 points on your own turn to win.</p><p className="modal-note">Rules follow the attached 2020 fifth-edition base-game rulebook. The advanced combined trade/build phase is enabled.</p></section></div></Modal>
}

function HistoryDialog({ game, agentStatuses, onClose }: Pick<DialogProps, 'game' | 'agentStatuses' | 'onClose'>) {
  return <Modal title="Match history" onClose={onClose} wide>
    <div className="history-layout">
      <section><h3>Controllers</h3><div className="history-players">{game.players.map((player) => {
        const status = agentStatuses?.[player.id]
        const cards = RESOURCES.reduce((total, resource) => total + player.resources[resource], 0)
        return <article key={player.id} className={player.color}><span className={`player-crest ${player.color}`}>{player.name[0]}</span><div><strong>{player.name}</strong><small>{player.controller === 'agent' ? `Local agent · ${status?.state.replaceAll('-', ' ') ?? 'waiting'}${status?.detail ? ` · ${status.detail}` : ''}` : player.controller === 'human' ? 'Human on this device' : 'Built-in bot'}</small></div><p>★ {publicScorePlayer(game, player.id)} · ▰ {cards} · ◈ {player.development.length}</p></article>
      })}<article className="history-spectator"><span className="player-crest spectator">◉</span><div><strong>Spectator</strong><small>Public state only · pause and pace remain available in the match controls</small></div></article></div></section>
      <section><h3>Public timeline</h3><ol className="history-events">{game.events.slice(-24).toReversed().map((event) => <li key={event.id}><span>{event.revision}</span><p>{event.message}</p></li>)}</ol></section>
    </div>
  </Modal>
}

export function Dialogs(props: DialogProps) {
  const humanMustAct = currentActorId(props.game) === props.humanId && !props.spectating
  if (humanMustAct && props.game.phase === 'discard') return <DiscardDialog game={props.game} humanId={props.humanId} onAction={props.onAction} />
  if (humanMustAct && props.game.phase === 'trade-response') return <TradeResponseDialog game={props.game} onAction={props.onAction} />
  if (humanMustAct && ['choose-victim', 'year-of-plenty', 'monopoly'].includes(props.game.phase)) return <ChoiceDialog game={props.game} onAction={props.onAction} />
  if (props.game.phase === 'game-over') return <ChoiceDialog game={props.game} onAction={props.onAction} />
  if (props.dialog === 'build') return <BuildDialog game={props.game} onClose={props.onClose} onAction={props.onAction} onPlacementMode={props.onPlacementMode} />
  if (props.dialog === 'trade') return <TradeDialog game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'cards') return <CardsDialog game={props.game} humanId={props.humanId} onClose={props.onClose} onAction={props.onAction} />
  if (props.dialog === 'rules') return <RulesDialog onClose={props.onClose} />
  if (props.dialog === 'history') return <HistoryDialog game={props.game} agentStatuses={props.agentStatuses} onClose={props.onClose} />
  return null
}
