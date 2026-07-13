import { useEffect, useMemo, useState } from 'react'
import { useGameAudio } from './audio/useGameAudio'
import { createGame, currentActorId } from './game/engine'
import type { GameAction } from './game/types'
import { useGame } from './game/useGame'
import { GameScene, type PlacementMode } from './scene/GameScene'
import { Dialogs } from './ui/Dialogs'
import { Hud, type DialogName } from './ui/Hud'
import { Journey, type JourneyStage, type SeatConfig } from './ui/Journey'

const playSeats: SeatConfig[] = [
  { name: 'You', controller: 'human' },
  { name: 'Agent Blue', controller: 'bot' },
  { name: 'Agent Amber', controller: 'agent' },
]

const spectatorSeats: SeatConfig[] = [
  { name: 'Coral Guild', controller: 'bot' },
  { name: 'Agent Blue', controller: 'agent' },
  { name: 'Amber Guild', controller: 'bot' },
]

const terrainName = (terrain: string) => terrain === 'lumber' ? 'forest' : terrain === 'wool' ? 'pasture' : terrain
const boardSector = (x: number, z: number) => {
  if (Math.hypot(x, z) < 0.7) return 'center'
  const sectors = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
  return sectors[(Math.round(Math.atan2(z, x) / (Math.PI / 4)) + sectors.length) % sectors.length]
}
const describeBoardAction = (game: NonNullable<ReturnType<typeof useGame>['game']>, action: GameAction, option: number, total: number) => {
  const describeHexes = (hexIds: string[]) => hexIds.map((hexId) => {
    const tile = game.board.hexes.find((candidate) => candidate.id === hexId)
    return tile ? `${terrainName(tile.terrain)}${tile.number ? ` ${tile.number}` : ''}` : undefined
  }).filter(Boolean).join(', ')
  let description = action.type.replaceAll('-', ' ')
  let point: { x: number; z: number } | undefined
  if ('vertexId' in action) {
    const vertex = game.board.vertices[action.vertexId]
    point = vertex
    description = `${description} beside ${describeHexes(vertex?.hexes ?? [])}`
  }
  if ('edgeId' in action) {
    const edge = game.board.edges[action.edgeId]
    if (edge) {
      const [a, b] = edge.vertices.map((id) => game.board.vertices[id])
      point = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
    }
    description = `${description} between ${describeHexes(edge?.hexes ?? [])}`
  }
  if ('hexId' in action) {
    const tile = game.board.hexes.find((candidate) => candidate.id === action.hexId)
    point = tile
    description = `${description} to ${tile ? `${terrainName(tile.terrain)}${tile.number ? ` ${tile.number}` : ''}` : 'another tile'}`
  }
  return `${description} at the ${point ? boardSector(point.x, point.z) : 'board'}, option ${option + 1} of ${total}`
}

export default function App() {
  const { game, start, reset, submit, error, thinkingPlayerId, agentStatuses, presentation, spectating, setSpectating, spectatorPaused, setSpectatorPaused, spectatorPace, setSpectatorPace, setAutomationEnabled } = useGame()
  const previewGame = useMemo(() => createGame({ seed: 28, controllers: ['bot', 'bot', 'agent'] }), [])
  const [stage, setStage] = useState<JourneyStage>('title')
  const [mode, setMode] = useState<'play' | 'spectate'>('play')
  const [seats, setSeats] = useState<SeatConfig[]>(playSeats)
  const [seed, setSeed] = useState(28)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null)
  const [pendingAction, setPendingAction] = useState<GameAction>()
  const displayedGame = game ?? previewGame
  const humanId = displayedGame.players.find((player) => player.controller === 'human')?.id ?? displayedGame.players[0].id
  const actor = game?.players.find((player) => player.id === currentActorId(game))
  const interactive = stage === 'match' && Boolean(game && actor?.controller === 'human' && !spectating && game.phase !== 'game-over')
  const boardActions = interactive && game ? game.legalActions.filter((action) => ['place-settlement', 'place-road', 'build-road', 'build-settlement', 'build-city', 'move-robber'].includes(action.type)) : []
  const { muted, setMuted } = useGameAudio(presentation, stage === 'summary')

  useEffect(() => {
    if (!interactive || game?.phase !== 'action') setPlacementMode(null)
    if (!interactive) setDialog(null)
    if (!interactive) setPendingAction(undefined)
  }, [interactive, game?.phase])

  useEffect(() => setPendingAction(undefined), [game?.revision])

  useEffect(() => {
    if (game?.phase !== 'game-over' || stage !== 'match') return
    setAutomationEnabled(false)
    setStage('summary')
  }, [game?.phase, setAutomationEnabled, stage])

  const act = (action: GameAction) => {
    if (!game) return
    if (['place-settlement', 'place-road', 'build-road', 'build-settlement', 'build-city', 'move-robber'].includes(action.type)) {
      setPendingAction(action)
      return
    }
    submit(action)
    if (['build-road', 'build-settlement', 'build-city'].includes(action.type)) setPlacementMode(null)
  }
  const confirmPendingAction = () => {
    if (!pendingAction) return
    submit(pendingAction)
    if (['build-road', 'build-settlement', 'build-city'].includes(pendingAction.type)) setPlacementMode(null)
    setPendingAction(undefined)
  }

  const chooseMode = (nextMode: 'play' | 'spectate') => {
    setMode(nextMode)
    setSeats(nextMode === 'play' ? playSeats.map((seat) => ({ ...seat })) : spectatorSeats.map((seat) => ({ ...seat })))
    setStage('configure')
  }

  const changeSeat = (index: number, patch: Partial<SeatConfig>) => setSeats((current) => current.map((seat, seatIndex) => seatIndex === index ? { ...seat, ...patch } : seat))
  const changeSeatCount = (count: 3 | 4) => setSeats((current) => count === 3
    ? current.slice(0, 3)
    : [...current, { name: 'Ivory Guild', controller: 'bot' } satisfies SeatConfig].slice(0, 4))
  const createConfiguredGame = (seedOverride = seed) => {
    start({ seed: seedOverride, controllers: seats.map((seat) => seat.controller), names: seats.map((seat) => seat.name.trim() || 'Settler') })
    setSpectating(mode === 'spectate' || !seats.some((seat) => seat.controller === 'human'))
    setAutomationEnabled(false)
    setStage('introduction')
  }
  const enterMatch = () => {
    setStage('match')
    setAutomationEnabled(true)
  }
  const rematch = () => {
    const nextSeed = (game?.seed ?? seed) + 1
    setSeed(nextSeed)
    createConfiguredGame(nextSeed)
  }
  const returnToTitle = () => {
    reset()
    setStage('title')
    setDialog(null)
    setPlacementMode(null)
    setPendingAction(undefined)
  }

  return <main className="game-shell">
    <div className="ocean-layer" />
    <div className="vignette" />
    <GameScene game={displayedGame} placementMode={placementMode} pendingAction={pendingAction} presentation={presentation} cinematic={stage !== 'match'} onAction={act} interactive={interactive} />
    {stage === 'match' && game ? <><Hud
      game={game}
      humanId={humanId}
      thinkingPlayerId={thinkingPlayerId}
      agentStatuses={agentStatuses}
      presentation={presentation}
      spectating={spectating}
      spectatorPaused={spectatorPaused}
      spectatorPace={spectatorPace}
      muted={muted}
      placementMode={placementMode}
      pendingAction={pendingAction}
      error={error}
      onDialog={setDialog}
      onPlacementMode={setPlacementMode}
      onAction={act}
      onConfirmAction={confirmPendingAction}
      onCancelAction={() => setPendingAction(undefined)}
      onSpectating={setSpectating}
      onSpectatorPaused={setSpectatorPaused}
      onSpectatorPace={setSpectatorPace}
      onMuted={setMuted}
      onExitMatch={returnToTitle}
    />
    <Dialogs
      game={game}
      humanId={humanId}
      dialog={dialog}
      spectating={spectating}
      agentStatuses={agentStatuses}
      onClose={() => setDialog(null)}
      onAction={act}
      onPlacementMode={setPlacementMode}
    /></> : null}
    {interactive && game ? <div className="sr-only board-targets" role="group" aria-label="Board targets">
      {boardActions.map((action, index) => {
        const target = 'vertexId' in action ? action.vertexId : 'edgeId' in action ? action.edgeId : 'hexId' in action ? action.hexId : index
        return <button key={`${action.type}-${target}`} onClick={() => act(action)}>{describeBoardAction(game, action, index, boardActions.length)}</button>
      })}
    </div> : null}
    <Journey
      stage={stage}
      mode={mode}
      seats={seats}
      seed={seed}
      game={game}
      onChooseMode={chooseMode}
      onSeatChange={changeSeat}
      onSeatCount={changeSeatCount}
      onSeed={setSeed}
      onBack={returnToTitle}
      onCreate={createConfiguredGame}
      onEnter={enterMatch}
      onRematch={rematch}
    />
    <div className="copyright-note">Original prototype · base rules 2020</div>
  </main>
}
