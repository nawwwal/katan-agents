import { useEffect, useMemo, useState } from 'react'
import { useGameAudio } from './audio/useGameAudio'
import { applyAction, createGame, currentActorId, getPlayerView } from './game/engine'
import { toDisplayState } from './game/room'
import type { GameAction } from './game/types'
import { useGame } from './game/useGame'
import { GameScene, type PlacementMode } from './scene/GameScene'
import { Dialogs } from './ui/Dialogs'
import { Hud, type DialogName } from './ui/Hud'
import { Journey, type JourneyStage } from './ui/Journey'

const boardActionTypes = new Set<GameAction['type']>(['place-settlement', 'place-road', 'build-road', 'build-settlement', 'build-city', 'move-robber'])
const terrainName = (terrain: string) => terrain === 'lumber' ? 'forest' : terrain === 'wool' ? 'pasture' : terrain
const boardSector = (x: number, z: number) => {
  if (Math.hypot(x, z) < 0.7) return 'center'
  const sectors = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
  return sectors[(Math.round(Math.atan2(z, x) / (Math.PI / 4)) + sectors.length) % sectors.length]
}

/**
 * Dev-only visual harness. `?ui=<stage>` on the Vite dev server drives the
 * interface into a state that normally needs live opponents, so HUD, dialog
 * and summary work can be screenshotted. Stripped from production builds by
 * the `import.meta.env.DEV` guard and never reachable from the shipped app.
 */
type UiPreviewStage = 'match' | 'trade' | 'cards' | 'rules' | 'history' | 'summary' | 'introduction'
const UI_PREVIEW_STAGES: UiPreviewStage[] = ['match', 'trade', 'cards', 'rules', 'history', 'summary', 'introduction']

const uiPreviewStage = (): UiPreviewStage | undefined => {
  if (!import.meta.env.DEV) return undefined
  const value = new URLSearchParams(window.location.search).get('ui')
  return UI_PREVIEW_STAGES.find((stage) => stage === value)
}

const buildUiPreview = (stage: UiPreviewStage) => {
  let state = createGame({ seed: 28, controllers: ['human', 'agent', 'agent'], names: ['You', 'Atlas', 'Ember'] })
  // Deterministic source so the harness renders the same state on every load.
  let tick = 0
  const random = () => { tick += 1; return ((tick * 9301 + 49297) % 233280) / 233280 }
  const advance = (action: GameAction) => {
    const result = applyAction(state, action, random)
    if (result.ok) state = result.state
    return result.ok
  }
  // Walk the snake setup with a spread of legal placements so the board fills out.
  for (let step = 0; step < 40 && state.phase.startsWith('setup'); step += 1) {
    const action = state.legalActions[Math.min(step * 3, state.legalActions.length - 1)]
    if (!action || !advance(action)) break
  }
  // Hand the turn to the viewer so the build and turn rails are exercised.
  for (let guard = 0; guard < 8 && currentActorId(state) !== state.players[0].id; guard += 1) {
    if (state.legalActions.some((action) => action.type === 'roll-dice')) advance({ type: 'roll-dice', dice: [3, 5] })
    const end = state.legalActions.find((action) => action.type === 'end-turn')
    if (!end || !advance(end)) break
  }
  if (state.legalActions.some((action) => action.type === 'roll-dice')) advance({ type: 'roll-dice', dice: [3, 5] })
  // Clear any robber or discard interruption so the preview lands in the build phase.
  for (let guard = 0; guard < 6 && state.phase !== 'action' && state.phase !== 'game-over'; guard += 1) {
    const next = state.legalActions.find((action) => action.type !== 'end-turn')
    if (!next || !advance(next)) break
  }
  state.players[0].resources ={ brick: 4, lumber: 3, ore: 5, grain: 3, wool: 2 }
  state.players[0].development = ['knight', 'knight', 'year-of-plenty', 'victory-point']
  state.players[1].playedKnights = 3
  state.largestArmy = { playerId: state.players[1].id, size: 3 }
  state.longestRoad = { playerId: state.players[0].id, length: 5 }
  if (stage === 'summary') {
    state.phase = 'game-over'
    state.winnerId = state.players[0].id
  }
  const view = getPlayerView(state, state.players[0].id)
  return { game: toDisplayState(view), viewerPlayerId: state.players[0].id }
}

export default function App() {
  const initialRoomCode = useMemo(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) ?? '', [])
  const { room, game, hasCredentials, viewerPlayerId, createRoom, joinRoom, start, reset, submit, error, busy, submitting, connectionState, thinkingPlayerId, agentStatuses, presentation } = useGame()
  const previewGame = useMemo(() => {
    const preview = createGame({ seed: 28, controllers: ['human', 'agent', 'agent'], names: ['You', 'Atlas', 'Ember'] })
    return toDisplayState(getPlayerView(preview, preview.players[0].id))
  }, [])
  const preview = useMemo(uiPreviewStage, [])
  const previewState = useMemo(() => preview ? buildUiPreview(preview) : undefined, [preview])
  const [stage, setStage] = useState<JourneyStage>(preview ? (preview === 'summary' || preview === 'introduction' ? preview : 'match') : initialRoomCode ? 'join' : 'title')
  const [dialog, setDialog] = useState<DialogName>(preview === 'trade' || preview === 'cards' || preview === 'rules' || preview === 'history' ? preview : null)
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null)
  const [pendingAction, setPendingAction] = useState<GameAction>()
  const displayedGame = game ?? previewState?.game ?? previewGame
  const actorId = game ? currentActorId(game) : undefined
  const viewerMustAct = Boolean(game && actorId === viewerPlayerId && game.phase !== 'game-over')
  const interactive = stage === 'match' && room?.status === 'playing' && viewerMustAct && connectionState === 'connected' && !submitting
  const boardActions = interactive && game ? game.legalActions.filter((action) => boardActionTypes.has(action.type)) : []
  // The old call passed `stage === 'summary'` as "victorious", so the fanfare
  // played at everyone who reached the end screen, winner or not. Split the two
  // and tell the hook which part of the app it is scoring so the ambience beds
  // match: the lobby sits at the dock, the match is out on the water.
  const finished = stage === 'summary'
  const winnerId = displayedGame.winnerId
  const audioStage = stage === 'summary' ? 'summary' : stage === 'match' ? 'play' : 'lobby'
  const { muted, setMuted } = useGameAudio(
    presentation,
    finished && Boolean(winnerId) && winnerId === viewerPlayerId,
    audioStage,
    finished && Boolean(winnerId) && winnerId !== viewerPlayerId,
  )

  useEffect(() => {
    if (!room) return
    const url = new URL(window.location.href)
    url.searchParams.set('room', room.code)
    window.history.replaceState(null, '', url)
    if (room.status === 'lobby') setStage('lobby')
    else if (room.status === 'playing') setStage((current) => current === 'lobby' || current === 'introduction' ? 'introduction' : 'match')
    else setStage('summary')
  }, [room?.code, room?.status])

  useEffect(() => {
    if (hasCredentials || !room) return
    setStage('join')
    setDialog(null)
    setPlacementMode(null)
    setPendingAction(undefined)
  }, [hasCredentials, room])

  useEffect(() => {
    if (preview) return
    if (viewerMustAct && game?.phase === 'action') return
    setPlacementMode(null)
    if (!viewerMustAct) setDialog(null)
    if (!viewerMustAct) setPendingAction(undefined)
  }, [game?.phase, viewerMustAct])

  useEffect(() => setPendingAction(undefined), [game?.revision])

  const act = (action: GameAction) => {
    if (!interactive) return false
    if (boardActionTypes.has(action.type)) {
      setPendingAction(action)
      return true
    }
    const sent = submit(action)
    if (sent && ['build-road', 'build-settlement', 'build-city'].includes(action.type)) setPlacementMode(null)
    return sent
  }

  const confirmPendingAction = () => {
    if (!pendingAction || !interactive) return
    if (submit(pendingAction) && ['build-road', 'build-settlement', 'build-city'].includes(pendingAction.type)) setPlacementMode(null)
    setPendingAction(undefined)
  }

  const describeBoardAction = (action: GameAction, option: number, total: number) => {
    if (!game) return action.type.replaceAll('-', ' ')
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

  const returnToTitle = () => {
    reset()
    setStage('title')
    setDialog(null)
    setPlacementMode(null)
    setPendingAction(undefined)
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState(null, '', url)
  }

  const create = async (name: string, seatsTotal: 3 | 4) => {
    const created = await createRoom(name, seatsTotal)
    if (created) setStage('lobby')
    return created
  }

  const join = async (code: string, name: string) => {
    const joined = await joinRoom(code, name)
    if (joined) setStage('lobby')
    return joined
  }

  const startMatch = () => { if (start()) setStage('introduction') }
  const hudError = error ?? (connectionState === 'reconnecting' ? 'Reconnecting to the room…' : connectionState === 'connecting' ? 'Connecting to the room…' : undefined)

  return <main className="game-shell">
    <div className="ocean-layer" />
    <div className="vignette" />
    <GameScene game={displayedGame} placementMode={placementMode} pendingAction={pendingAction} presentation={presentation} cinematic={stage !== 'match'} onAction={act} interactive={interactive} />
    {stage === 'match' && (game ?? previewState?.game) && (viewerPlayerId ?? previewState?.viewerPlayerId) ? <><Hud
      game={(game ?? previewState!.game)}
      humanId={(viewerPlayerId ?? previewState!.viewerPlayerId)}
      thinkingPlayerId={thinkingPlayerId}
      agentStatuses={agentStatuses}
      presentation={presentation}
      muted={muted}
      placementMode={placementMode}
      pendingAction={pendingAction}
      error={hudError}
      onDialog={setDialog}
      onPlacementMode={setPlacementMode}
      onAction={act}
      onConfirmAction={confirmPendingAction}
      onCancelAction={() => setPendingAction(undefined)}
      onMuted={setMuted}
      onExitMatch={returnToTitle}
    />
    <Dialogs game={(game ?? previewState!.game)} humanId={(viewerPlayerId ?? previewState!.viewerPlayerId)} dialog={dialog} agentStatuses={agentStatuses} onClose={() => setDialog(null)} onAction={act} /></> : null}
    {interactive && game ? <div className="sr-only board-targets" role="group" aria-label="Board targets">
      {boardActions.map((action, index) => {
        const target = 'vertexId' in action ? action.vertexId : 'edgeId' in action ? action.edgeId : 'hexId' in action ? action.hexId : index
        return <button key={`${action.type}-${target}`} onClick={() => act(action)}>{describeBoardAction(action, index, boardActions.length)}</button>
      })}
    </div> : null}
    <Journey
      stage={stage}
      room={room}
      game={game ?? previewState?.game}
      viewerPlayerId={viewerPlayerId ?? previewState?.viewerPlayerId}
      busy={busy}
      connectionState={connectionState}
      error={error}
      initialRoomCode={initialRoomCode}
      onChoose={setStage}
      onCreate={create}
      onJoin={join}
      onBack={returnToTitle}
      onStart={startMatch}
      onEnter={() => setStage('match')}
      onRematch={startMatch}
    />
    <div className="copyright-note">Original prototype · base rules 2020</div>
  </main>
}
