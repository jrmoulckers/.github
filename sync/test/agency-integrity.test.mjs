import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgencyIntegrity } from '../lib/agency-integrity.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical agency policy uses reviewed pins and explicit bounded tools', () => {
  const policy = validateAgencyIntegrity(REPO_ROOT);
  assert.deepEqual([...policy.active.keys()], ['context7', 'sequential-thinking']);
  assert.deepEqual([...policy.optional.keys()], ['playwright', 'memory']);
  assert.deepEqual(policy.optional.get('memory').tools, ['read_graph', 'search_nodes', 'open_nodes']);
});

test('mutable packages, wildcard grants, and the nonexistent Playwright package are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agency-integrity-'));
  try {
    writeFileSync(
      join(root, 'agency.toml'),
      `[mcps.servers]
context7 = { args = ["-y", "@upstash/context7-mcp@latest"], command = "npx", tools = ["*"], type = "stdio" }
playwright = { args = ["-y", "@anthropic/mcp-server-playwright"], command = "npx", tools = ["*"], type = "stdio" }
`,
      'utf8',
    );
    assert.throws(
      () => validateAgencyIntegrity(root),
      /mutable package specs.*wildcard tool grants|deprecated\/nonexistent/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unreviewed valid TOML server declarations fail closed instead of bypassing parsing', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agency-integrity-'));
  try {
    writeFileSync(
      join(root, 'agency.toml'),
      `[mcps.servers]
context7 = { args = ['-y', '@upstash/context7-mcp@4.0.0'], command = 'npx', tools = ['*'], type = 'stdio' }
sequential-thinking = { args = ["-y", "@modelcontextprotocol/server-sequential-thinking@2026.7.4"], command = "npx", tools = ["sequentialthinking"], type = "stdio" }

# The consuming host's enforcement of agency.toml tool allowlists is not yet documented.
# playwright = { args = ["-y", "@playwright/mcp@0.0.79"], command = "npx", tools = ["browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_take_screenshot", "browser_find", "browser_click", "browser_fill_form", "browser_type", "browser_select_option", "browser_press_key", "browser_hover", "browser_wait_for", "browser_tabs", "browser_close", "browser_console_messages"], type = "stdio" }
# memory = { args = ["-y", "@modelcontextprotocol/server-memory@2026.7.4"], command = "npx", tools = ["read_graph", "search_nodes", "open_nodes"], type = "stdio" }
`,
      'utf8',
    );
    assert.throws(
      () => validateAgencyIntegrity(root),
      /unsupported or unreviewed active server declaration/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nested TOML server tables and declarations outside the reviewed table fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agency-integrity-'));
  try {
    writeFileSync(
      join(root, 'agency.toml'),
      `[mcps.servers]
context7 = { args = ["-y", "@upstash/context7-mcp@4.0.0"], command = "npx", tools = ["resolve-library-id", "query-docs"], type = "stdio" }
sequential-thinking = { args = ["-y", "@modelcontextprotocol/server-sequential-thinking@2026.7.4"], command = "npx", tools = ["sequentialthinking"], type = "stdio" }

[mcps.servers.evil]
command = "npx"
args = ["-y", "@example/evil@1.2.3"]
tools = ["steal"]

# The consuming host's enforcement of agency.toml tool allowlists is not yet documented.
# playwright = { args = ["-y", "@playwright/mcp@0.0.79"], command = "npx", tools = ["browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_take_screenshot", "browser_find", "browser_click", "browser_fill_form", "browser_type", "browser_select_option", "browser_press_key", "browser_hover", "browser_wait_for", "browser_tabs", "browser_close", "browser_console_messages"], type = "stdio" }
# memory = { args = ["-y", "@modelcontextprotocol/server-memory@2026.7.4"], command = "npx", tools = ["read_graph", "search_nodes", "open_nodes"], type = "stdio" }
`,
      'utf8',
    );
    assert.throws(
      () => validateAgencyIntegrity(root),
      /unsupported table "\[mcps\.servers\.evil\]".*declaration outside \[mcps\.servers\]/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
