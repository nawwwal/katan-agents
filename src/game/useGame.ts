import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { currentActorId } from './engine'
import { RESOURCES } from './types'
import { toDisplayState } from './room'
import type { AgentStatus, BoardOptions, GameAction, GameDisplayState, GameEvent, Resources } from './types'
import type { RoomCredentials, RoomView, ServerRoomMessage } from './room'

export type GamePresentation = {
  revision: number
  actionType: GameAction['type']
  events: GameEvent[]
  resourceDeltas: Record<string, Partial<Resources>>
  awardChanges: string[]
}

export type RoomConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting'

const SESSION_PREFIX = 'katan:room-seat'

/**
 * How often the seat asks the room whether it is still there. The room answers
 * for the seat rather than for the socket, so an unanswered beat means the room
 * is gone or the connection died without saying so.
 */
const HEARTBEAT_MS = 15_000

/**
 * The longest wait between reconnects. The old ceiling was five seconds and the
 * backoff reset the moment a socket opened, so a seat that was being opened and
 * immediately closed, which is exactly what a throttled seat gets, reconnected
 * about four times a second and held the throttle open for the whole table.
 */
const MAX_RECONNECT_MS = 10_000

/** Consecutive attempts that never reached a snapshot before we say so out loud. */
const UNREACHABLE_AFTER = 3
const normalizeRoomCode = (value: string | null | undefined) => value?.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) ?? ''
const sessionKey = (code: string) => `${SESSION_PREFIX}:${normalizeRoomCode(code)}`

const storedCredentials = () => {
  try {
    const code = normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
    if (!code) return undefined
    const value = sessionStorage.getItem(sessionKey(code))
    if (!value) return undefined
    const parsed = JSON.parse(value) as RoomCredentials
    return parsed.code === code && typeof parsed.token === 'string' && typeof parsed.playerId === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

const requestRoom = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { data?: T; error?: { message?: string } }
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The room did not answer. Try again.')
  return payload.data
}

const eventActionType = (event: GameEvent | undefined, previous?: GameDisplayState): GameAction['type'] | undefined => {
  if (!event) return undefined
  if (event.type === 'settlement-built') return previous?.phase === 'setup-settlement' ? 'place-settlement' : 'build-settlement'
  if (event.type === 'road-built') return previous?.phase === 'setup-road' ? 'place-road' : 'build-road'
  return ({
    dice: 'roll-dice',
    discard: 'discard',
    'robber-moved': 'move-robber',
    robbery: 'steal-from',
    'city-built': 'build-city',
    'development-bought': 'buy-development',
    'development-played': 'play-development',
    'year-of-plenty': 'choose-year-of-plenty',
    monopoly: 'choose-monopoly',
    'maritime-trade': 'maritime-trade',
    'road-building-finished': 'finish-road-building',
    'trade-offered': 'offer-trade',
    'trade-countered': 'counter-trade',
    'trade-accepted': 'respond-trade',
    'trade-rejected': 'respond-trade',
    'turn-ended': 'end-turn',
  } as Record<string, GameAction['type']>)[event.type]
}

export const useGame = () => {
  const [credentials, setCredentials] = useState<RoomCredentials | undefined>(storedCredentials)
  const [room, setRoom] = useState<RoomView>()
  const [game, setGame] = useState<GameDisplayState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [connectionState, setConnectionState] = useState<RoomConnectionState>(credentials ? 'connecting' : 'idle')
  const [presentation, setPresentation] = useState<GamePresentation>()
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const roomRef = useRef<RoomView | undefined>(undefined)
  const gameRef = useRef<GameDisplayState | undefined>(undefined)
  const pendingRevisionRef = useRef<number | undefined>(undefined)

  const applySnapshot = useCallback((nextRoom: RoomView) => {
    const currentRoom = roomRef.current
    if (currentRoom?.code === nextRoom.code && (
      nextRoom.updatedAt < currentRoom.updatedAt
      || (currentRoom.game && nextRoom.game && nextRoom.game.revision < currentRoom.game.revision)
    )) return
    roomRef.current = nextRoom
    setRoom(nextRoom)
    setError(undefined)
    if (!nextRoom.game) {
      gameRef.current = undefined
      setGame(undefined)
      setPresentation(undefined)
      return
    }
    const next = toDisplayState(nextRoom.game)
    const previous = gameRef.current
    if (pendingRevisionRef.current !== undefined && next.revision >= pendingRevisionRef.current) {
      pendingRevisionRef.current = undefined
      setSubmitting(false)
    }
    if (previous && next.revision > previous.revision) {
      const events = next.events.filter((event) => event.revision > previous.revision)
      const ownBefore = previous.players.find((player) => player.id === nextRoom.viewerPlayerId)
      const ownAfter = next.players.find((player) => player.id === nextRoom.viewerPlayerId)
      const ownDeltas = Object.fromEntries(RESOURCES.flatMap((resource) => {
        const delta = (ownAfter?.resources[resource] ?? 0) - (ownBefore?.resources[resource] ?? 0)
        return delta ? [[resource, delta]] : []
      }))
      const actionType = events.toReversed().map((event) => eventActionType(event, previous)).find((type) => type !== undefined)
      const awardChange = (award: 'Longest Road' | 'Largest Army', holder: string | undefined) =>
        holder ? `${award} passes to ${holder}` : `${award} is unclaimed`
      const awardChanges = [
        previous.longestRoad?.playerId !== next.longestRoad?.playerId
          ? awardChange('Longest Road', next.players.find((player) => player.id === next.longestRoad?.playerId)?.name)
          : undefined,
        previous.largestArmy?.playerId !== next.largestArmy?.playerId
          ? awardChange('Largest Army', next.players.find((player) => player.id === next.largestArmy?.playerId)?.name)
          : undefined,
      ].filter((change): change is string => Boolean(change))
      if (actionType) setPresentation({
        revision: next.revision,
        actionType,
        events,
        resourceDeltas: { [nextRoom.viewerPlayerId]: ownDeltas },
        awardChanges,
      })
    }
    gameRef.current = next
    setGame(next)
  }, [])

  useEffect(() => {
    if (!credentials) return
    let stopped = false
    let reconnectTimer = 0
    let heartbeat = 0
    let reconnectDelay = 250
    let failures = 0

    const connect = () => {
      if (stopped) return
      setConnectionState((state) => state === 'connected' ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/api/ws`)
      socketRef.current = socket
      // Per attempt: whether this socket ever became a live seat, whether the room
      // gave a reason for refusing it, and whether a heartbeat is outstanding.
      let seated = false
      let told = false
      let awaitingBeat = false
      socket.addEventListener('open', () => {
        // The backoff deliberately does not reset here. Opening is not the same as
        // being let in, and resetting on open is what turned a brief throttle into
        // a reconnect storm that kept the throttle alive.
        setConnectionState((state) => state === 'reconnecting' ? 'reconnecting' : 'connecting')
        socket.send(JSON.stringify({ type: 'hello', code: credentials.code, token: credentials.token }))
        heartbeat = window.setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return
          // Nothing came back from the last beat, so this connection is not live
          // however open it looks. Drop it and let the reconnect find out why.
          if (awaitingBeat) {
            socket.close()
            return
          }
          awaitingBeat = true
          socket.send(JSON.stringify({ type: 'ping' }))
        }, HEARTBEAT_MS)
      })
      socket.addEventListener('message', (event) => {
        awaitingBeat = false
        let message: ServerRoomMessage
        try {
          message = JSON.parse(String(event.data)) as ServerRoomMessage
        } catch {
          setError('Lost the thread of the room. Reconnecting.')
          socket.close()
          return
        }
        if (message.type === 'snapshot') {
          seated = true
          failures = 0
          reconnectDelay = 250
          setConnectionState('connected')
          applySnapshot(message.room)
        } else if (message.type === 'error') {
          told = true
          setError(message.error.message)
          if (message.requestId) {
            pendingRevisionRef.current = undefined
            setSubmitting(false)
          }
          if (['invalid_seat_token', 'room_not_found'].includes(message.error.code)) {
            stopped = true
            window.clearTimeout(reconnectTimer)
            window.clearInterval(heartbeat)
            sessionStorage.removeItem(sessionKey(credentials.code))
            setCredentials(undefined)
            gameRef.current = undefined
            setGame(undefined)
            setPresentation(undefined)
            pendingRevisionRef.current = undefined
            setSubmitting(false)
            setConnectionState('idle')
            socket.close()
          }
        }
        else if (message.type === 'ack') setError(undefined)
      })
      socket.addEventListener('close', () => {
        window.clearInterval(heartbeat)
        if (stopped) return
        // A move that was in flight did not land. Releasing it is what keeps the
        // next tap from being swallowed by a submit that can never resolve.
        const lostMove = pendingRevisionRef.current !== undefined
        if (lostMove) {
          pendingRevisionRef.current = undefined
          setSubmitting(false)
        }
        if (!seated) failures += 1
        setConnectionState('reconnecting')
        if (failures >= UNREACHABLE_AFTER && !told) setError('Cannot reach the room. Still trying, and your seat is held.')
        else if (lostMove && !told) setError('That move did not reach the room. Try it again in a second.')
        reconnectTimer = window.setTimeout(connect, reconnectDelay + Math.random() * reconnectDelay * 0.3)
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS)
      })
      socket.addEventListener('error', () => socket.close())
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(heartbeat)
      socketRef.current?.close()
      socketRef.current = undefined
    }
  }, [applySnapshot, credentials])

  const remember = useCallback((next: { credentials: RoomCredentials; room: RoomView }) => {
    sessionStorage.setItem(sessionKey(next.credentials.code), JSON.stringify(next.credentials))
    setCredentials(next.credentials)
    applySnapshot(next.room)
  }, [applySnapshot])

  const createRoom = useCallback(async (name: string, seatsTotal: 3 | 4, boardSeed?: number, boardOptions?: BoardOptions) => {
    setBusy(true)
    setError(undefined)
    try {
      remember(await requestRoom('/api/rooms', { name, seatsTotal, boardSeed, boardOptions }))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the room.')
      return false
    } finally {
      setBusy(false)
    }
  }, [remember])

  const joinRoom = useCallback(async (code: string, name: string) => {
    setBusy(true)
    setError(undefined)
    try {
      remember(await requestRoom(`/api/rooms/${code.trim().toUpperCase()}/seats`, { name, controller: 'human' }))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join the room.')
      return false
    } finally {
      setBusy(false)
    }
  }, [remember])

  const send = useCallback((message: object) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('Still reconnecting. That move did not go through, so try it again in a second.')
      return false
    }
    socketRef.current.send(JSON.stringify(message))
    return true
  }, [])

  const submit = useCallback((action: GameAction) => {
    const current = gameRef.current
    if (!current || pendingRevisionRef.current !== undefined) return false
    const sent = send({ type: 'action', requestId: crypto.randomUUID(), expectedRevision: current.revision, action })
    if (sent) {
      pendingRevisionRef.current = current.revision
      setSubmitting(true)
    }
    return sent
  }, [send])

  const start = useCallback(() => send({ type: 'start', requestId: crypto.randomUUID() }), [send])

  const reset = useCallback(() => {
    if (credentials) sessionStorage.removeItem(sessionKey(credentials.code))
    socketRef.current?.close()
    socketRef.current = undefined
    roomRef.current = undefined
    gameRef.current = undefined
    setCredentials(undefined)
    setRoom(undefined)
    setGame(undefined)
    setError(undefined)
    setSubmitting(false)
    pendingRevisionRef.current = undefined
    setConnectionState('idle')
    setPresentation(undefined)
  }, [credentials])

  const thinkingPlayerId = useMemo(() => {
    if (!game || room?.status !== 'playing') return undefined
    const actor = game.players.find((player) => player.id === currentActorId(game))
    return actor?.controller === 'agent' ? actor.id : undefined
  }, [game, room?.status])

  const agentStatuses = useMemo(() => Object.fromEntries((game?.players ?? [])
    .filter((player) => player.controller === 'agent')
    .map((player) => [player.id, {
      state: thinkingPlayerId === player.id ? 'thinking' : 'idle',
      detail: thinkingPlayerId === player.id ? 'Deciding' : 'Local agent',
      revision: game?.revision,
    } satisfies AgentStatus])), [game, thinkingPlayerId])

  return {
    room,
    game,
    hasCredentials: Boolean(credentials),
    viewerPlayerId: room?.viewerPlayerId,
    createRoom,
    joinRoom,
    start,
    reset,
    submit,
    error,
    busy,
    submitting,
    connectionState,
    thinkingPlayerId,
    agentStatuses,
    presentation,
  }
}
