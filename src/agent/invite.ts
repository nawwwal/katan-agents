export type AgentClient = 'codex' | 'claude'

export const KATAN_AGENT_VERSION = '0.2.0'
export const KATAN_AGENT_PACKAGE = `nawwwal-katan-live-agent-${KATAN_AGENT_VERSION}.tgz`
export const KATAN_AGENT_GUIDE_URL = 'https://github.com/nawwwal/katan-agents/blob/main/docs/LOCAL_AGENTS.md'

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
const normalizeOrigin = (value: string) => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Katan must use HTTP or HTTPS')
  return url.origin
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export const resolveRoomServerOrigin = (browserOrigin: string) => {
  const url = new URL(browserOrigin)
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) url.port = '8787'
  return url.origin
}

export const buildAgentRunnerCommand = (code: string, client: AgentClient, serverUrl: string, packageOrigin: string) => {
  const server = normalizeOrigin(serverUrl)
  const artifactOrigin = normalizeOrigin(packageOrigin)
  const command = [
    'npx',
    '--yes',
    shellQuote(`${artifactOrigin}/${KATAN_AGENT_PACKAGE}`),
    'play',
    normalizeCode(code),
    `--${client}`,
  ]
  if (server !== artifactOrigin) command.push('--server', shellQuote(server))
  return command.join(' ')
}

export const buildAgentMcpInstallCommand = (client: AgentClient, serverUrl: string) => {
  const endpoint = `${normalizeOrigin(serverUrl)}/api/mcp`
  return client === 'codex'
    ? `codex mcp add katan --url ${shellQuote(endpoint)}`
    : `claude mcp add --transport http --scope user katan ${shellQuote(endpoint)}`
}

export const buildAgentPlayPrompt = (code: string) => `Join Katan room ${normalizeCode(code)} under the name the runner gives you. Read the bundled player playbook, play the personality in your seat brief, and keep playing until the game ends.`
