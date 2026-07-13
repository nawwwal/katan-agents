import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const root = fileURLToPath(new URL('..', import.meta.url))
const runner = join(root, 'agent-runner', 'bin', 'katan-agent.mjs')
const runnerPackage = JSON.parse(await readFile(join(root, 'agent-runner', 'package.json'), 'utf8'))
const inviteSource = await readFile(join(root, 'src', 'agent', 'invite.ts'), 'utf8')
const artifact = join(root, 'public', `nawwwal-katan-live-agent-${runnerPackage.version}.tgz`)
assert.match(inviteSource, new RegExp(`KATAN_AGENT_VERSION = '${runnerPackage.version.replaceAll('.', '\\.')}'`), 'the browser invite and runner package versions must match')
assert.ok((await stat(artifact)).size > 0, 'the versioned runner artifact must be committed')
const temporary = await mkdtemp(join(tmpdir(), 'katan-agent-check-'))
const home = join(temporary, 'home')
const fakeBin = join(temporary, 'bin')
const stateDir = join(temporary, 'state')
const logPath = join(home, 'fake-clients.jsonl')
const modePath = join(home, 'fake-mode')

await Promise.all([
  import('node:fs/promises').then(({ mkdir }) => mkdir(home, { recursive: true })),
  import('node:fs/promises').then(({ mkdir }) => mkdir(fakeBin, { recursive: true })),
])

const fakeClient = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
const client = basename(process.argv[1])
const args = process.argv.slice(2)
const home = process.env.HOME
if (args.includes('--version')) {
  console.log(client === 'codex' ? 'codex-cli 0.144.3' : '2.1.207')
  process.exit(0)
}
if (client === 'codex' && args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT')
  process.exit(0)
}
if (client === 'claude' && args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true }))
  process.exit(0)
}
let mcpUrl
if (client === 'codex') {
  const setting = args.find((value) => value.startsWith('mcp_servers.katan.url='))
  mcpUrl = JSON.parse(setting.slice(setting.indexOf('=') + 1))
} else {
  const index = args.indexOf('--mcp-config')
  mcpUrl = JSON.parse(args[index + 1]).mcpServers.katan.url
}
appendFileSync(join(home, 'fake-clients.jsonl'), JSON.stringify({
  client,
  args,
  envKeys: Object.keys(process.env).sort(),
  pid: process.pid,
  cwd: process.cwd(),
  mcpUrl,
}) + '\\n')
const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake', version: '1' } } }
const response = await fetch(mcpUrl, {
  method: 'POST',
  headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
  body: JSON.stringify(request),
})
if (!response.ok) throw new Error('proxy returned ' + response.status)
await response.text()
if (client === 'claude') {
  const sessionFlag = args.includes('--resume') ? '--resume' : '--session-id'
  const sessionId = args[args.indexOf(sessionFlag) + 1]
  console.log(JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: ['mcp__katan__get_playbook', 'mcp__katan__read_rules', 'mcp__katan__get_view', 'mcp__katan__play_action'],
    mcp_servers: [{ name: 'katan', status: 'connected' }],
  }))
}
const mode = readFileSync(join(home, 'fake-mode'), 'utf8').trim()
if (mode === 'hang') await new Promise(() => {})
await new Promise((resolve) => setTimeout(resolve, 250))
if (client === 'codex') console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-katan-check' }))
else console.log(JSON.stringify({ result: 'ok' }))
`

for (const client of ['codex', 'claude']) {
  const path = join(fakeBin, client)
  await writeFile(path, fakeClient, { mode: 0o755 })
  await chmod(path, 0o755)
}
await writeFile(modePath, 'success\n')

const room = {
  v: 1,
  code: 'ABC234',
  status: 'playing',
  seatsTotal: 4,
  seats: [{ id: 'p0', name: 'Host', controller: 'human', isHost: true }, { id: 'p1', name: 'Agent', controller: 'agent', isHost: false }],
  viewerPlayerId: 'p1',
  isHost: false,
  updatedAt: 1,
  game: {
    playerId: 'p1',
    revision: 7,
    phase: 'action',
    privateState: { resources: {}, development: [], boughtDevelopment: [] },
    publicState: {
      phase: 'action',
      actingPlayerId: 'p1',
      activePlayerIndex: 1,
      discardQueue: [],
      players: [{ id: 'p0', name: 'Host' }, { id: 'p1', name: 'Agent' }],
      events: [{ id: 'ev-7-0', revision: 7, type: 'turn', message: 'Agent must decide.' }],
    },
    legalActions: [{ type: 'end-turn' }],
  },
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
  })
  request.on('error', reject)
})

const joins = []
const seats = new Map()
const upstreamAuthorizations = []
let loseNextJoinResponse = true
let withholdNextSnapshot = true
let replyAllPongs = false
let remainingPongs = 1
const socketClosures = []

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://local')
  if (request.method === 'GET' && url.pathname === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ ok: true, storage: 'memory' }))
  }
  if (request.method === 'POST' && url.pathname === '/api/rooms/ABC234/seats') {
    const body = await readBody(request)
    joins.push(body)
    const existing = seats.get(body.joinId)
    if (existing && existing.playerKey !== body.playerKey) {
      response.writeHead(409, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ error: { code: 'join_id_conflict', message: 'conflict' } }))
    }
    const seat = existing ?? { playerKey: body.playerKey, playerId: 'p1', name: body.name }
    seats.set(body.joinId, seat)
    if (loseNextJoinResponse) {
      loseNextJoinResponse = false
      return request.socket.destroy()
    }
    response.writeHead(201, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({
      data: {
        credentials: { code: 'ABC234', token: seat.playerKey, playerId: seat.playerId },
        room: { ...room, viewerPlayerId: seat.playerId },
        reused: Boolean(existing),
      },
    }))
  }
  if (request.method === 'GET' && url.pathname === '/api/rooms/ABC234') {
    const token = request.headers.authorization?.replace(/^Bearer /, '')
    const seat = [...seats.values()].find((candidate) => candidate.playerKey === token)
    if (!seat) {
      response.writeHead(403, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ error: { code: 'invalid_seat_token', message: 'invalid' } }))
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ data: { ...room, viewerPlayerId: seat.playerId } }))
  }
  if (request.method === 'POST' && url.pathname === '/api/mcp') {
    upstreamAuthorizations.push(request.headers.authorization)
    const body = await readBody(request)
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'check', version: '1' } },
    }))
  }
  response.writeHead(404)
  response.end()
})

const webSockets = new WebSocketServer({ server })
webSockets.on('connection', (socket) => {
  let authenticated = false
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString())
    if (message.type === 'hello') {
      authenticated = true
      if (withholdNextSnapshot) {
        withholdNextSnapshot = false
        return
      }
      socket.send(JSON.stringify({ type: 'snapshot', room }))
    } else if (message.type === 'ping' && authenticated && (replyAllPongs || remainingPongs > 0)) {
      remainingPongs -= 1
      socket.send(JSON.stringify({ type: 'pong' }))
    }
  })
  socket.on('close', (code, reason) => socketClosures.push({ code, reason: reason.toString() }))
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

const runnerEnvironment = (overrides = {}) => ({
  ...process.env,
  HOME: home,
  PATH: `${fakeBin}:${process.env.PATH}`,
  KATAN_AGENT_STATE_DIR: stateDir,
  KATAN_AGENT_WAKE_TIMEOUT_MS: '2000',
  KATAN_AGENT_AUTH_TIMEOUT_MS: '150',
  KATAN_AGENT_PING_INTERVAL_MS: '100',
  KATAN_AGENT_PONG_STALE_MS: '200',
  ...overrides,
})

const launch = (args, env = runnerEnvironment()) => {
  const child = spawn(process.execPath, [runner, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return { child, output: () => ({ stdout, stderr }) }
}

const waitForExit = async (process, timeoutMs = 12_000) => Promise.race([
  once(process, 'close').then(([code, signal]) => ({ code, signal })),
  new Promise((_, reject) => setTimeout(() => reject(new Error('runner did not exit')), timeoutMs)),
])
const waitFor = async (test, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await test()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('condition timed out')
}
const clientLog = async () => {
  try {
    return (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
const processExists = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const running = []
try {
  const first = launch(['play', 'ABC234', '--codex', '--name', 'Atlas', '--server', baseUrl])
  running.push(first.child)
  const firstExit = await waitForExit(first.child)
  assert.equal(firstExit.code, 1)
  const firstOutput = first.output()
  assert.match(firstOutput.stdout, /Recovery command:/)
  assert.match(firstOutput.stderr, /without advancing the table \(3\/3\)/)
  assert.equal(seats.size, 1, 'a lost join response must not consume two seats')
  assert.ok(joins.length >= 2)
  assert.equal(joins[0].joinId, joins[1].joinId)
  assert.equal(joins[0].playerKey, joins[1].playerKey)
  assert.match(joins[0].playerKey, /^[A-Za-z0-9_-]{43}$/)

  const stateFiles = (await import('node:fs/promises')).readdir(stateDir)
  const [stateFile] = await stateFiles
  assert.ok(stateFile)
  const savedPath = join(stateDir, stateFile)
  const saved = JSON.parse(await readFile(savedPath, 'utf8'))
  assert.equal((await stat(savedPath)).mode & 0o777, 0o600)
  assert.equal(saved.sessionId, 'thread-katan-check')
  const firstLogs = await clientLog()
  const codexRuns = firstLogs.filter((entry) => entry.client === 'codex')
  assert.equal(codexRuns.length, 3)
  assert.ok(codexRuns.every((entry) => !JSON.stringify(entry.args).includes(saved.playerKey)))
  assert.ok(codexRuns.every((entry) => !entry.envKeys.includes('KATAN_PLAYER_KEY')))
  assert.ok(codexRuns.every((entry) => entry.mcpUrl.startsWith('http://127.0.0.1:')))
  assert.ok(codexRuns.every((entry) => entry.args.includes('mcp_servers.katan.default_tools_approval_mode="approve"')))
  assert.ok(codexRuns.every((entry) => entry.args.includes('mcp_servers.katan.enabled_tools=["get_playbook","read_rules","get_view","play_action"]')))
  assert.ok(upstreamAuthorizations.every((value) => value?.startsWith('Bearer ')))
  assert.ok(upstreamAuthorizations.includes(`Bearer ${saved.playerKey}`))
  await waitFor(() => socketClosures.some((entry) => entry.reason === 'Authenticated snapshot timeout'))
  await waitFor(() => socketClosures.some((entry) => entry.reason === 'Pong timeout')).catch(() => {
    throw new Error(`expected pong-timeout reconnect; closures were ${JSON.stringify(socketClosures)}`)
  })

  const joinsBeforeResume = joins.length
  replyAllPongs = true
  const beforeResumeRuns = firstLogs.length
  const resumed = launch(['play', 'ABC234', '--codex', '--resume', saved.runnerId, '--server', baseUrl])
  running.push(resumed.child)
  await waitFor(async () => (await clientLog()).length > beforeResumeRuns)
  resumed.child.kill('SIGTERM')
  const resumedExit = await waitForExit(resumed.child)
  assert.equal(resumedExit.code, 130)
  assert.equal(joins.length, joinsBeforeResume, 'resume must not claim another seat')
  const resumeLog = (await clientLog()).at(-1)
  assert.ok(resumeLog.args.includes('resume'))
  assert.ok(resumeLog.args.includes('thread-katan-check'))

  await writeFile(modePath, 'hang\n')
  const claude = launch(
    ['play', 'ABC234', '--claude', '--name', 'Claude Moss', '--server', baseUrl],
    runnerEnvironment({ KATAN_AGENT_WAKE_TIMEOUT_MS: '200' }),
  )
  running.push(claude.child)
  const claudeEntries = await waitFor(async () => {
    const entries = (await clientLog()).filter((entry) => entry.client === 'claude')
    return entries.length >= 2 ? entries : undefined
  })
  const firstClaudePid = claudeEntries[0].pid
  await waitFor(() => !processExists(firstClaudePid))
  claude.child.kill('SIGTERM')
  const claudeExit = await waitForExit(claude.child)
  assert.equal(claudeExit.code, 130)
  await waitFor(() => claudeEntries.every((entry) => !processExists(entry.pid)))
  const claudeStateFile = (await (await import('node:fs/promises')).readdir(stateDir)).find((file) => file !== stateFile)
  const claudeState = JSON.parse(await readFile(join(stateDir, claudeStateFile), 'utf8'))
  assert.ok(claudeEntries[0].args.includes('--session-id'))
  assert.ok(claudeEntries.slice(1).every((entry) => entry.args.includes('--resume')))
  assert.equal(claudeState.sessionReady, true)
  assert.ok(claudeEntries.every((entry) => entry.args.includes('mcp__katan__get_playbook,mcp__katan__read_rules,mcp__katan__get_view,mcp__katan__play_action')))
  assert.ok(claudeEntries.every((entry) => entry.args.includes('mcp__katan__join_room,mcp__katan__wait_for_event')))
  assert.ok(claudeEntries.every((entry) => !entry.args.includes('--safe-mode')))
  assert.ok(claudeEntries.every((entry) => entry.args[entry.args.indexOf('--setting-sources') + 1] === ''))
  assert.ok(claudeEntries.every((entry) => JSON.parse(entry.args[entry.args.indexOf('--mcp-config') + 1]).mcpServers.katan.alwaysLoad === true))
  assert.ok(claudeEntries.every((entry) => !JSON.stringify(entry.args).includes(claudeState.playerKey)))
  assert.ok(claudeEntries.every((entry) => !entry.envKeys.includes('KATAN_PLAYER_KEY')))
  assert.ok(upstreamAuthorizations.includes(`Bearer ${claudeState.playerKey}`))

  const claudeRunsBeforeResume = (await clientLog()).filter((entry) => entry.client === 'claude').length
  const joinsBeforeClaudeResume = joins.length
  const claudeResumed = launch(
    ['play', 'ABC234', '--claude', '--resume', claudeState.runnerId, '--server', baseUrl],
    runnerEnvironment({ KATAN_AGENT_WAKE_TIMEOUT_MS: '200' }),
  )
  running.push(claudeResumed.child)
  const claudeResumeEntry = await waitFor(async () => {
    const entries = (await clientLog()).filter((entry) => entry.client === 'claude')
    return entries.length > claudeRunsBeforeResume ? entries.at(-1) : undefined
  })
  claudeResumed.child.kill('SIGTERM')
  const claudeResumedExit = await waitForExit(claudeResumed.child)
  assert.equal(claudeResumedExit.code, 130)
  assert.equal(joins.length, joinsBeforeClaudeResume, 'Claude resume must not claim another seat')
  assert.ok(claudeResumeEntry.args.includes('--resume'))
  assert.ok(claudeResumeEntry.args.includes(claudeState.sessionId))
  assert.equal(claudeResumeEntry.cwd, claudeEntries[0].cwd, 'Claude must resume from the same stable workspace')

  console.log('agent runner check passed: idempotent join, 0600 recovery, secret-isolating proxy, stable Codex/Claude resume, authenticated WSS + pong recovery, no-progress guard, timeout, and child shutdown')
} finally {
  for (const child of running) if (child.exitCode === null) child.kill('SIGKILL')
  for (const socket of webSockets.clients) socket.terminate()
  await new Promise((resolve) => webSockets.close(() => resolve()))
  await new Promise((resolve) => server.close(() => resolve()))
  await rm(temporary, { recursive: true, force: true })
}
