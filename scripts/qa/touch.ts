/**
 * Real touch, held open for as long as the mobile checks run.
 *
 * `agent-browser set device` changes the viewport and the user agent and
 * nothing else: `ontouchstart` stays undefined, `maxTouchPoints` stays zero,
 * `(pointer: coarse)` stays false and `(hover: hover)` stays true. Every mobile
 * observation made that way is a desktop-input page at phone width, hover
 * affordances and all. This attaches to the browser's own CDP endpoint and
 * turns touch on properly.
 *
 * Three things cost a previous QA pass an hour, and all three are handled here:
 * the overrides are dropped the moment the CDP session detaches, so the socket
 * stays open until `release()`; `ontouchstart` does not appear until the page
 * reloads, so the caller must reload after `apply()`; and
 * `Emulation.setEmitTouchEventsForMouse` wedges agent-browser's own clicks, so
 * it is never enabled.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type TouchSession = { release: () => Promise<void> }

export type Device = { width: number; height: number; scale: number }


export const startTouch = async (session: string, device: Device): Promise<TouchSession> => {
  const { stdout } = await run('agent-browser', ['--session', session, 'get', 'cdp-url'], {
    env: { ...process.env, AGENT_BROWSER_SESSION: session },
  })
  const endpoint = stdout.trim().split('\n').pop() ?? ''
  if (!endpoint.startsWith('ws')) throw new Error(`no cdp endpoint: ${endpoint.slice(0, 80)}`)

  const { WebSocket } = await import('ws')
  const socket = new WebSocket(endpoint, { maxPayload: 16 * 1024 * 1024 })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  let nextId = 1
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } }
    if (message.id === undefined) return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result ?? {})
  })

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)) }, 15_000)
  })

  const { targetInfos } = await send('Target.getTargets') as { targetInfos: { targetId: string; type: string; url: string }[] }
  const page = targetInfos.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'))
  if (!page) throw new Error('no page target to emulate touch on')
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true }) as { sessionId: string }

  // Deliberately no `setDeviceMetricsOverride`: agent-browser owns the viewport
  // through its own CDP session and re-applies it on every navigation, and two
  // sessions fighting over device metrics is what makes its clicks hang. Touch
  // and the input media features are all this needs to own.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }],
  }, sessionId)

  return {
    release: async () => {
      try {
        await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId)
        await send('Emulation.setEmulatedMedia', { features: [] }, sessionId)
      } catch {
        // The socket closing is what actually drops the overrides; a failure
        // here only means the page went away first.
      }
      socket.close()
    },
  }
}
