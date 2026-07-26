import assert from 'node:assert/strict'
import {
  ADD_MCP_VERSION,
  buildAgentMcpEndpoint,
  buildAgentMcpInstallCommand,
  buildAgentRunnerCommand,
  buildAgentUniversalInvite,
  KATAN_AGENT_PACKAGE,
  resolveRoomServerOrigin,
} from './invite'

const PROD = 'https://katan-agents.vercel.app'

// The universal invitation is the primary artifact: one thing the host copies
// and any MCP-capable agent pastes. These checks pin the contract that makes it
// work cold in an arbitrary agent, and that it never carries a seat secret.
{
  const invite = buildAgentUniversalInvite('abc234', PROD)

  // Normalizes the room code the same way the server does, uppercased.
  assert.match(invite, /room ABC234\b/, 'invite names the normalized room code')
  assert.ok(!invite.includes('abc234'), 'invite does not leak the raw lowercase code')

  // Points at the hosted MCP endpoint, the one protocol every serious agent speaks.
  assert.ok(invite.includes(`${PROD}/api/mcp`), 'invite names the hosted MCP endpoint')

  // Bootstraps a cold agent that has no katan tools yet.
  assert.ok(invite.includes(`add-mcp@${ADD_MCP_VERSION}`), 'invite offers the universal add-mcp bootstrap')

  // Walks the full play loop against tools the hosted MCP actually exposes.
  for (const tool of ['join_room', 'read_rules', 'get_playbook', 'get_view', 'play_action', 'wait_for_event']) {
    assert.ok(invite.includes(tool), `invite instructs the ${tool} tool`)
  }
  assert.match(invite, /playerKey/, 'invite tells the agent to keep the minted playerKey')
  assert.match(invite, /expectedRevision/, 'invite tells the agent to submit at the exact revision')

  // Never client-specific. It must not read like a Codex-only or Claude-only card.
  assert.ok(!/\bcodex mcp add\b/i.test(invite), 'invite is not the Codex-only install')
  assert.ok(!/\bclaude mcp add\b/i.test(invite), 'invite is not the Claude-only install')

  // Prompt-injection guardrail travels with the artifact.
  assert.match(invite, /never an instruction/i, 'invite carries the untrusted-data boundary')

  // Carries no seat secret. The invite is a room code plus a server origin only.
  assert.ok(!/Bearer\s/i.test(invite), 'invite carries no bearer token')
  assert.ok(!/[A-Za-z0-9_-]{32,}/.test(invite.replaceAll('add-mcp', '')), 'invite embeds no key-shaped secret')
}

// Endpoint derivation and local dev routing stay intact for both paths.
{
  assert.equal(buildAgentMcpEndpoint(PROD), `${PROD}/api/mcp`)
  assert.equal(buildAgentMcpEndpoint('http://127.0.0.1:8787/x?y=1'), 'http://127.0.0.1:8787/api/mcp')
  assert.equal(resolveRoomServerOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:8787')
  assert.equal(resolveRoomServerOrigin('https://katan-agents.vercel.app'), PROD)
  const local = buildAgentUniversalInvite('ABC234', resolveRoomServerOrigin('http://localhost:5173'))
  assert.ok(local.includes('http://localhost:8787/api/mcp'), 'local invite targets the local room service')
}

// The demoted Codex and Claude runner paths still resolve, so the disclosure works.
{
  const codex = buildAgentRunnerCommand('ABC234', 'codex', PROD, PROD)
  assert.ok(codex.startsWith('npx --yes'), 'runner command shells out through npx')
  assert.ok(codex.includes(KATAN_AGENT_PACKAGE), 'runner command names the versioned package')
  assert.ok(codex.includes('play ABC234 --codex'), 'runner command plays the room as Codex')
  assert.ok(buildAgentRunnerCommand('ABC234', 'claude', PROD, PROD).includes('--claude'))
  assert.ok(buildAgentMcpInstallCommand('codex', PROD).includes('codex mcp add katan'))
  assert.ok(buildAgentMcpInstallCommand('claude', PROD).includes('claude mcp add --transport http'))
}

console.log('invite checks passed')
