import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Deleting either validateRecords call from validateAgencyIntegrity left the full suite green. The
// wildcard-tools and exact-semver checks live outside validateRecords and keep firing, so they mask
// nothing -- but they also cover none of the pin or tool-list policy. Each row below wrongs a pin on
// exactly one side of the active/optional split, so the message isolates a single dispatch: an
// optional-server corruption is invisible to the active call and vice versa.
const AGENCY_DISPATCH = [
  {
    call: "validateRecords('active', active, EXPECTED_ACTIVE, errors)",
    from: '@upstash/context7-mcp@4.0.0',
    to: '@upstash/context7-mcp@4.0.1',
    needle: 'context7 must pin @upstash/context7-mcp@4.0.0',
  },
  {
    call: "validateRecords('optional', optional, EXPECTED_OPTIONAL, errors)",
    from: '@playwright/mcp@0.0.79',
    to: '@playwright/mcp@0.0.78',
    needle: 'playwright must pin @playwright/mcp@0.0.79',
  },
];

test('every agency validator is reached from the integrity entry point', () => {
  const original = readFileSync(join(REPO_ROOT, 'agency.toml'), 'utf8');
  for (const row of AGENCY_DISPATCH) {
    const root = mkdtempSync(join(tmpdir(), 'studio-agency-dispatch-'));
    try {
      // An anchor that no longer matches yields a mutant that was never applied, which would read as
      // a covered defect rather than as a skip.
      assert.ok(
        original.includes(row.from),
        `agency.toml: anchor ${JSON.stringify(row.from)} is absent, so the ${row.call} probe would not apply`,
      );
      const mutated = original.split(row.from).join(row.to);
      assert.notEqual(mutated, original, `corruption for ${row.call} changed nothing`);
      writeFileSync(join(root, 'agency.toml'), mutated, 'utf8');

      let message = null;
      try {
        validateAgencyIntegrity(root);
      } catch (error) {
        message = error.message;
      }
      assert.ok(message, `${row.call} must be reached: its corruption produced no error at all`);
      assert.ok(
        message.includes(row.needle),
        `${row.call} must be reached from validateAgencyIntegrity: no ${JSON.stringify(row.needle)} in ${JSON.stringify(message)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// Both dispatches call the same function under different arguments, so a population keyed by
// function name would collapse them into one and let a deleted call pass. Derive on the whole call
// expression instead, from the entry point's own source.
test('the agency dispatch table covers every validator the entry point calls', () => {
  const source = readFileSync(join(REPO_ROOT, 'sync', 'lib', 'agency-integrity.mjs'), 'utf8');
  const start = source.indexOf('export function validateAgencyIntegrity');
  assert.ok(start >= 0, 'validateAgencyIntegrity is no longer an exported declaration');
  const end = source.indexOf('\nfunction ', start);
  assert.ok(end > start, 'could not find the end of the validateAgencyIntegrity body');
  // Slice past the signature: the entry point's own declaration matches the call regex, and counting
  // it would make the table permanently one row short of a set that can never be satisfied.
  const body = source.slice(source.indexOf('\n', start), end);

  const called = [...body.matchAll(/\bvalidate[A-Z]\w*\([^)]*\)/g)].map((match) => match[0]);
  assert.ok(called.length > 0, 'extracted no validator calls, so this check would pass vacuously');

  assert.deepEqual(
    [...new Set(called)].sort(),
    [...new Set(AGENCY_DISPATCH.map((row) => row.call))].sort(),
    'the reachability table and the entry point dispatch must name the same validators',
  );
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
