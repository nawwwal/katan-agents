/**
 * Tier 2's fixture: a private app instance sitting in a live match, with the
 * human seat to act.
 *
 * Two things this deliberately does not share with `npm run dev`. It runs its
 * own room service on its own port, because the shared one on 8787 is rate
 * limited per client address and another agent's reconnecting browser can
 * exhaust the socket budget for everyone. And it runs its own Vite server with
 * the `/api` proxy pointed at that private port, since `vite.config.ts` hard
 * codes 8787 and is not ours to edit.
 *
 * The match is driven through the room service's own functions rather than by
 * clicking through the lobby, so reaching a state costs no browser time at
 * all: seats are claimed, the host starts, and `simulationPolicy` plays every
 * seat until the state the browser needs to see. The browser is only opened
 * once the room is already parked where a check wants it.
 */
import net from 'node:net'
import { createRealtimeServer } from '../../server/realtime-server'
import { closeRoomStore, createRoom, getRoomView, joinRoom, playRoomAction, startRoom } from '../../server/room-service'
import { chooseSimulationAction } from '../../src/game/simulationPolicy'
import { RESOURCES } from '../../src/game/types'
import type { RoomCredentials, RoomView } from '../../src/game/room'
import type { GameAction, PlayerView, Resource } from '../../src/game/types'

export type Seat = { credentials: RoomCredentials; controller: 'human' | 'agent' }

export type Room = {
  code: string
  seats: Seat[]
  /** The viewer's seat, the one the browser drives. */
  human: Seat
  view: () => Promise<RoomView>
  /** Submit one action for a seat, the way that seat's client would. */
  play: (seat: Seat, action: GameAction) => Promise<void>
  /** Whichever seat can answer the open offer, answers it. */
  acceptPendingTrade: () => Promise<boolean>
  /** An offer the viewer can make that some rival actually holds the cards for. */
  coverableOffer: () => Promise<GameAction | undefined>
  /**
   * Play every seat with the simulation policy until `stop` accepts the human
   * seat's view, or the budget runs out. Returns the number of actions played
   * and whether the stop condition was actually met.
   */
  driveUntil: (stop: (view: PlayerView) => boolean, options?: DriveOptions) => Promise<{ actions: number; reached: boolean }>
}

export type DriveOptions = {
  budget?: number
  /** Replaces the policy for the viewer's seat, for states the policy would spend past. */
  humanPolicy?: (view: PlayerView) => GameAction | undefined
  /** Replaces the policy for every other seat. */
  rivalPolicy?: (view: PlayerView) => GameAction | undefined
}

/** A rival that would rather deal with the viewer than do anything else. */
export const offerToViewer = (viewerId: string) => (view: PlayerView): GameAction | undefined =>
  view.legalActions.find((action) => action.type === 'offer-trade' && action.trade.toPlayerId === viewerId)
  ?? chooseSimulationAction(view)

/**
 * A seat that refuses to spend.
 *
 * The simulation policy buys a city the moment it can afford one, which is
 * exactly the state the browser needs to be handed. So the viewer's seat plays
 * a miser instead: it keeps the turn moving, trades whatever it has spare
 * towards ore and grain, and builds nothing.
 */
export const saveForCity = (view: PlayerView): GameAction | undefined => {
  const actions = view.legalActions
  if (!actions.length) return undefined
  if (view.phase.startsWith('setup')) return chooseSimulationAction(view)
  const roll = actions.find((action) => action.type === 'roll-dice')
  if (roll) return roll
  const forced = actions.find((action) => ['discard', 'move-robber', 'steal-from', 'respond-trade', 'decline-trade', 'accept-trade', 'choose-year-of-plenty', 'choose-monopoly', 'build-road', 'finish-road-building'].includes(action.type))
  if (forced && view.phase !== 'action') return chooseSimulationAction(view)
  const held = view.privateState.resources
  const wanted: Resource[] = [...(held.ore < 3 ? ['ore' as const] : []), ...(held.grain < 2 ? ['grain' as const] : [])]
  const trade = actions
    .filter((action): action is Extract<GameAction, { type: 'maritime-trade' }> => action.type === 'maritime-trade')
    .filter((action) => wanted.includes(action.receive) && action.give !== 'ore' && action.give !== 'grain')
    .toSorted((a, b) => a.ratio - b.ratio)[0]
  if (trade) return trade
  return actions.find((action) => action.type === 'end-turn') ?? chooseSimulationAction(view)
}

export type Fixture = {
  origin: string
  openRoom: (seed?: number) => Promise<Room>
  stop: () => Promise<void>
}

const freePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const probe = net.createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    const port = typeof address === 'object' && address ? address.port : 0
    probe.close(() => resolve(port))
  })
})

const openRoom = async (seed: number): Promise<Room> => {
  const host = await createRoom({ name: 'You', seatsTotal: 3, boardSeed: seed })
  const code = host.credentials.code
  const seats: Seat[] = [{ credentials: host.credentials, controller: 'human' }]
  for (const name of ['Marlow', 'Ansel']) {
    const guest = await joinRoom({ code, name, controller: 'agent' })
    seats.push({ credentials: guest.credentials, controller: 'agent' })
  }
  await startRoom(code, host.credentials.token)
  const human = seats[0]

  const view = () => getRoomView(code, human.credentials.token)

  const play = async (seat: Seat, action: GameAction) => {
    const seatView = await getRoomView(code, seat.credentials.token)
    if (!seatView.game) throw new Error('the room is not playing')
    await playRoomAction(code, seat.credentials.token, seatView.game.revision, action)
  }

  const coverableOffer = async () => {
    const humanView = await getRoomView(code, human.credentials.token)
    const offers = humanView.game?.legalActions.filter((action): action is Extract<GameAction, { type: 'offer-trade' }> => action.type === 'offer-trade') ?? []
    // Only the harness can see both hands, so it picks a deal that can close
    // rather than one the rival would have to refuse.
    for (const seat of seats) {
      if (seat === human) continue
      const seatView = await getRoomView(code, seat.credentials.token)
      const held = seatView.game?.privateState.resources
      if (!held) continue
      const match = offers.find((offer) => offer.trade.toPlayerId === seatView.game!.playerId
        && RESOURCES.every((resource) => held[resource] >= (offer.trade.receive[resource] ?? 0)))
      if (match) return match
    }
    return offers[0]
  }

  const acceptPendingTrade = async () => {
    for (const seat of seats) {
      const seatView = await getRoomView(code, seat.credentials.token)
      const accept = seatView.game?.legalActions.find((action) =>
        action.type === 'accept-trade' || (action.type === 'respond-trade' && action.accept))
      if (!accept) continue
      await playRoomAction(code, seat.credentials.token, seatView.game!.revision, accept)
      return true
    }
    return false
  }

  const driveUntil = async (stop: (view: PlayerView) => boolean, options: DriveOptions = {}) => {
    const budget = options.budget ?? 4_000
    let actions = 0
    for (; actions < budget; actions += 1) {
      const humanView = await getRoomView(code, human.credentials.token)
      if (!humanView.game || humanView.status !== 'playing') return { actions, reached: false }
      if (stop(humanView.game)) return { actions, reached: true }
      // Whoever holds a legal action owns the move. During a discard that is
      // several seats at once, so the first one found simply goes first.
      let played = false
      for (const seat of seats) {
        const seatView = seat === human ? humanView : await getRoomView(code, seat.credentials.token)
        if (!seatView.game?.legalActions.length) continue
        const policy = seat === human
          ? options.humanPolicy ?? chooseSimulationAction
          : options.rivalPolicy ?? chooseSimulationAction
        const action = policy(seatView.game)
        if (!action) continue
        await playRoomAction(code, seat.credentials.token, seatView.game.revision, action)
        played = true
        break
      }
      if (!played) return { actions, reached: false }
    }
    return { actions, reached: false }
  }

  return { code, seats, human, view, play, coverableOffer, acceptPendingTrade, driveUntil }
}

export const startFixture = async (): Promise<Fixture> => {
  const roomPort = await freePort()
  const rooms = createRealtimeServer()
  await new Promise<void>((resolve) => rooms.listen(roomPort, '127.0.0.1', resolve))

  const vitePort = await freePort()
  const { createServer } = await import('vite')
  const vite = await createServer({
    configFile: new URL('../../vite.config.ts', import.meta.url).pathname,
    logLevel: 'error',
    server: {
      port: vitePort,
      strictPort: true,
      host: '127.0.0.1',
      proxy: { '/api': { target: `http://127.0.0.1:${roomPort}`, ws: true } },
    },
  })
  await vite.listen()

  return {
    origin: `http://127.0.0.1:${vitePort}`,
    openRoom: (seed = 28) => openRoom(seed),
    stop: async () => {
      await vite.close()
      await new Promise<void>((resolve) => rooms.close(() => resolve()))
      await closeRoomStore()
    },
  }
}
