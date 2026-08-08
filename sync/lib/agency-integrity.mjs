// Canonical agency.toml package and tool-exposure policy validation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED_ACTIVE = new Map([
  [
    'context7',
    {
      package: '@upstash/context7-mcp@4.0.0',
      tools: ['resolve-library-id', 'query-docs'],
    },
  ],
  [
    'sequential-thinking',
    {
      package: '@modelcontextprotocol/server-sequential-thinking@2026.7.4',
      tools: ['sequentialthinking'],
    },
  ],
]);
const EXPECTED_OPTIONAL = new Map([
  [
    'playwright',
    {
      package: '@playwright/mcp@0.0.79',
      tools: [
        'browser_navigate',
        'browser_navigate_back',
        'browser_snapshot',
        'browser_take_screenshot',
        'browser_find',
        'browser_click',
        'browser_fill_form',
        'browser_type',
        'browser_select_option',
        'browser_press_key',
        'browser_hover',
        'browser_wait_for',
        'browser_tabs',
        'browser_close',
        'browser_console_messages',
      ],
    },
  ],
  [
    'memory',
    {
      package: '@modelcontextprotocol/server-memory@2026.7.4',
      tools: ['read_graph', 'search_nodes', 'open_nodes'],
    },
  ],
]);

export function validateAgencyIntegrity(repoRoot) {
  const path = join(repoRoot, 'agency.toml');
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const errors = [];

  if (/@anthropic\/mcp-server-playwright/.test(text)) {
    errors.push('agency.toml: deprecated/nonexistent @anthropic/mcp-server-playwright is forbidden');
  }
  if (/@latest\b|tools\s*=\s*\[\s*["']\*["']\s*\]/i.test(text)) {
    errors.push('agency.toml: mutable package specs and wildcard tool grants are forbidden');
  }
  if (!/tool allowlists is not yet documented/i.test(text)) {
    errors.push('agency.toml: must document the unproven host allowlist contract');
  }

  const active = new Map();
  const optional = new Map();
  let inServerTable = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      if (trimmed === '[mcps.servers]') {
        inServerTable = true;
      } else {
        inServerTable = false;
        errors.push(`agency.toml: unsupported table "${trimmed}"`);
      }
      continue;
    }

    if (trimmed && !trimmed.startsWith('#')) {
      if (!inServerTable) {
        errors.push(`agency.toml: declaration outside [mcps.servers] "${trimmed}"`);
        continue;
      }
      const activeRecord = parseServerLine(trimmed);
      if (!activeRecord) {
        errors.push(`agency.toml: unsupported or unreviewed active server declaration "${trimmed}"`);
      } else if (active.has(activeRecord.name)) {
        errors.push(`agency.toml: duplicate active server "${activeRecord.name}"`);
      } else {
        active.set(activeRecord.name, activeRecord);
      }
    }

    const optionalMatch = line.match(/^#\s+(.+)$/);
    const optionalRecord = optionalMatch ? parseServerLine(optionalMatch[1]) : null;
    if (optionalRecord) {
      if (optional.has(optionalRecord.name)) {
        errors.push(`agency.toml: duplicate optional server "${optionalRecord.name}"`);
      } else {
        optional.set(optionalRecord.name, optionalRecord);
      }
    }
  }

  validateRecords('active', active, EXPECTED_ACTIVE, errors);
  validateRecords('optional', optional, EXPECTED_OPTIONAL, errors);
  for (const risky of EXPECTED_OPTIONAL.keys()) {
    if (active.has(risky)) errors.push(`agency.toml: risky server "${risky}" must be disabled by default`);
  }

  for (const record of [...active.values(), ...optional.values()]) {
    if (!/@\d+\.\d+\.\d+$/.test(record.package)) {
      errors.push(`agency.toml: ${record.name} package must use an exact semantic version`);
    }
    if (record.tools.includes('*')) {
      errors.push(`agency.toml: ${record.name} must not grant wildcard tools`);
    }
  }

  if (errors.length) throw new Error(`Invalid agency.toml:\n  - ${errors.join('\n  - ')}`);
  return { active, optional };
}

function parseServerLine(line) {
  const name = line.match(/^([a-z][a-z0-9-]*)\s*=/)?.[1];
  const packageSpec = line.match(/args\s*=\s*\[\s*"-y"\s*,\s*"([^"]+)"\s*\]/)?.[1];
  const command = line.match(/command\s*=\s*"([^"]+)"/)?.[1];
  const toolsRaw = line.match(/tools\s*=\s*\[([^\]]*)\]/)?.[1];
  const type = line.match(/type\s*=\s*"([^"]+)"/)?.[1];
  const keys = [...line.matchAll(/\b([a-z][a-z0-9-]*)\s*=/g)].map((match) => match[1]);
  if (
    !name ||
    !packageSpec ||
    command !== 'npx' ||
    toolsRaw === undefined ||
    type !== 'stdio' ||
    !sameArray(keys, [name, 'args', 'command', 'tools', 'type']) ||
    toolsRaw.replace(/"[^"]*"/g, '').replace(/[,\s]/g, '') !== ''
  ) {
    return null;
  }
  const tools = [...toolsRaw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return { name, package: packageSpec, tools, command, type };
}

function validateRecords(label, actual, expected, errors) {
  if (!sameSet(actual.keys(), expected.keys())) {
    errors.push(
      `agency.toml: ${label} servers must be [${[...expected.keys()].join(', ')}], got [${[...actual.keys()].join(', ')}]`,
    );
  }
  for (const [name, policy] of expected) {
    const record = actual.get(name);
    if (!record) continue;
    if (record.package !== policy.package) {
      errors.push(`agency.toml: ${name} must pin ${policy.package}`);
    }
    if (!sameArray(record.tools, policy.tools)) {
      errors.push(`agency.toml: ${name} tools must be [${policy.tools.join(', ')}]`);
    }
  }
}

function sameSet(actual, expected) {
  const actualValues = [...actual];
  const expectedValues = [...expected];
  const expectedSet = new Set(expectedValues);
  return actualValues.length === expectedValues.length && actualValues.every((value) => expectedSet.has(value));
}

function sameArray(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
