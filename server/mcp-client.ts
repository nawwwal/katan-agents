import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { RoomCredentials, RoomView, ServerRoomMessage } from '../src/game/room'
import type { PublicGameState } from '../src/game/types'

type JoinResponse = { data?: { credentials: RoomCredentials; room: RoomView }; error?: { message?: string } }
type PendingAction = { expectedRevision: number; resolve: (room: RoomView) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }

const normalizeServerUrl = (value: string) => value.trim().replace(/\/$/, '')

export class AgentRoomClient {
  private serverUrl: string
  private credentials?: RoomCredentials
  private room?: RoomView
  private socket?: WebSocket
  private reconnectTimer?: NodeJS.Timeout
  private idleTimer?: NodeJS.Timeout
  private reconnectDelay = 250
  private stopped = false
  private authenticated = false
  private connectPromise?: Promise<void>
  private readonly listeners = new Set<(room: RoomView) => void>()
  private readonly pendingActions = new Map<string, PendingAction>()

  constructor(serverUrl = process.env.KATAN_SERVER_URL ?? 'http://127.0.0.1:8787', private readonly idleMs = 60_000) {
    this.serverUrl = normalizeServerUrl(serverUrl)
  }

  get view() { return this.room }
  get connected() { return this.authenticated && this.socket?.readyState === WebSocket.OPEN }

  async join(code: string, name: string, serverUrl?: string) {
    if (serverUrl) this.serverUrl = normalizeServerUrl(serverUrl)
    this.stopSocket()
    this.resume()
    const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, '')
    const joinId = randomUUID()
    const playerKey = randomBytes(32).toString('base64url')
    let payload: JoinResponse | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${this.serverUrl}/api/rooms/${normalizedCode}/seats`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, controller: 'agent', joinId, playerKey }),
          signal: AbortSignal.timeout(10_000),
        })
        payload = await response.json() as JoinResponse
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Could not join that Katan room.')
        break
      } catch (error) {
        if (attempt === 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
      }
    }
    if (!payload?.data) throw new Error('Could not join that Katan room.')
    this.credentials = payload.data.credentials
    this.setRoom(payload.data.room)
    await this.connect()
    this.armIdle()
    return this.room!
  }

  async read() {
    if (!this.credentials) throw new Error('Join a room before reading it.')
    this.resume()
    try {
      await this.connect()
      if (!this.room) throw new Error('The room is no longer available.')
      return this.room
    } finally {
      this.armIdle()
    }
  }

  async play(expectedRevision: number, action: unknown) {
    if (!this.credentials) throw new Error('Join a room before playing.')
    this.resume()
    try {
      await this.connect()
      if (!this.room?.game) throw new Error('Join a room before playing.')
      if (this.room.game.revision !== expectedRevision) throw new Error(`The room is now at revision ${this.room.game.revision}. Read the current view before playing.`)
      const socket = this.socket
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('The room is reconnecting. Wait for the connection, then try again.')
      const requestId = randomUUID()
      const result = new Promise<RoomView>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingActions.delete(requestId)
          reject(new Error('The action was not confirmed within 12 seconds. Read the room again before retrying.'))
        }, 12_000)
        this.pendingActions.set(requestId, { expectedRevision, resolve, reject, timeout })
      })
      socket.send(JSON.stringify({ type: 'action', requestId, expectedRevision, action }))
      return await result
    } finally {
      this.armIdle()
    }
  }

  async waitForTurn(timeoutMs: number) {
    if (!this.credentials) throw new Error('Join a room before waiting for a turn.')
    this.resume()
    try {
      await this.connect()
      const deadline = Date.now() + timeoutMs
      while (true) {
        const current: RoomView | undefined = this.room
        if (!current) throw new Error('The room is no longer available.')
        if (current.status === 'finished') return { room: current, timedOut: false }
        if (current.status === 'playing' && current.game) {
          const publicState: PublicGameState = current.game.publicState
          const actorIndex = publicState.actingPlayerId
            ? publicState.players.findIndex((player) => player.id === publicState.actingPlayerId)
            : publicState.phase === 'discard'
              ? publicState.players.findIndex((player) => player.id === publicState.discardQueue[0])
              : publicState.activePlayerIndex
          const actorId = publicState.players[actorIndex]?.id
          if (actorId === current.viewerPlayerId && current.game.legalActions.length) return { room: current, timedOut: false }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { room: current, timedOut: true }
        await this.waitForChange(current.updatedAt, Math.min(remaining, 5_000))
      }
    } finally {
      this.armIdle()
    }
  }

  close() {
    this.stopped = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.stopSocket()
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('The Katan MCP server closed.'))
    }
    this.pendingActions.clear()
  }

  private setRoom(room: RoomView) {
    this.room = room
    for (const [requestId, pending] of this.pendingActions) {
      if ((room.game?.revision ?? -1) <= pending.expectedRevision) continue
      clearTimeout(pending.timeout)
      this.pendingActions.delete(requestId)
      pending.resolve(room)
    }
    for (const listener of this.listeners) listener(room)
  }

  private waitForChange(updatedAt: number, timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timeout); this.listeners.delete(onRoom); resolve() }
      const onRoom = (room: RoomView) => { if (room.updatedAt !== updatedAt) finish() }
      const timeout = setTimeout(finish, timeoutMs)
      this.listeners.add(onRoom)
    })
  }

  private async connect() {
    if (this.connected) return
    if (!this.credentials) throw new Error('Join a room before connecting.')
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const wsUrl = `${this.serverUrl.replace(/^http/, 'ws')}/api/ws`
      const socket = new WebSocket(wsUrl)
      this.socket = socket
      this.authenticated = false
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
      const timeout = setTimeout(() => {
        socket.close()
        fail(new Error('Timed out authenticating the Katan room.'))
      }, 8_000)
      socket.once('open', () => {
        this.reconnectDelay = 250
        socket.send(JSON.stringify({ type: 'hello', code: this.credentials!.code, token: this.credentials!.token }))
      })
      socket.on('message', (data) => {
        const message = this.handleMessage(data.toString())
        if (message?.type === 'snapshot' && !settled) {
          settled = true
          this.authenticated = true
          clearTimeout(timeout)
          resolve()
        }
      })
      socket.once('error', (error) => {
        if (!this.authenticated) fail(error)
      })
      socket.once('close', () => {
        clearTimeout(timeout)
        if (this.socket === socket) {
          this.socket = undefined
          this.authenticated = false
        }
        if (!settled) fail(new Error('The Katan room closed before authentication completed.'))
        if (!this.stopped && this.credentials) this.scheduleReconnect()
      })
    }).finally(() => { this.connectPromise = undefined })
    return this.connectPromise
  }

  private handleMessage(raw: string) {
    let message: ServerRoomMessage
    try {
      message = JSON.parse(raw) as ServerRoomMessage
    } catch {
      return undefined
    }
    if (message.type === 'snapshot') this.setRoom(message.room)
    if (message.type === 'error' && message.requestId) {
      const pending = this.pendingActions.get(message.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingActions.delete(message.requestId)
      pending.reject(new Error(message.error.message))
    }
    return message
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect().catch(() => this.scheduleReconnect())
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5_000)
  }

  private resume() {
    this.stopped = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private armIdle() {
    if (this.stopped || !this.credentials) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      this.stopped = true
      this.stopSocket()
    }, this.idleMs)
    this.idleTimer.unref?.()
  }

  private stopSocket() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close()
    this.socket = undefined
    this.authenticated = false
    this.connectPromise = undefined
  }
}
