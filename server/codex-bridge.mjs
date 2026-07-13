process.env.KATAN_AGENT_COMMAND ||= 'codex'
process.env.KATAN_AGENT_ARGS ||= JSON.stringify([
  'exec',
  '--model', process.env.KATAN_CODEX_MODEL || 'gpt-5.6-sol',
  '--sandbox', 'read-only',
  '--skip-git-repo-check',
  '--ephemeral',
  '--ignore-user-config',
  '--disable', 'plugins',
  '--disable', 'apps',
  '--disable', 'memories',
  '--disable', 'goals',
  '--disable', 'browser_use',
  '--disable', 'in_app_browser',
  '--disable', 'multi_agent',
  '--disable', 'shell_snapshot',
  '--disable', 'shell_tool',
  '--disable', 'unified_exec',
  '--disable', 'image_generation',
  '--disable', 'computer_use',
  '--disable', 'hooks',
  '-',
])

await import('./agent-bridge.mjs')
