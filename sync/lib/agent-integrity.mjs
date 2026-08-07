// Canonical custom-agent integrity validation.
//
// Agent files are the source of truth for role metadata. The manifest remains the sync selection
// catalog, so validation checks both directions and fails before a malformed roster can be planned
// or copied to members.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_FIELDS = [
  'name',
  'description',
  'model',
  'when_to_use',
  'primary_paths',
  'write_scope',
  'risk_level',
  'tools',
];
const ARRAY_FIELDS = new Set(['primary_paths', 'tools']);
const MODELS = new Set(['standard', 'strong-reasoning']);
const WRITE_SCOPES = new Set(['read-only', 'scoped-write', 'full']);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const TOOLS = new Set(['read', 'edit', 'search', 'shell']);
const REQUIRED_SECTIONS = [
  'Role',
  'Capabilities',
  'File Ownership',
  'Workflow',
  'Planning & Verification',
  'Technical Context',
  'Boundaries',
];

export function validateAgentIntegrity(repoRoot, manifest) {
  const errors = [];
  const sourceBase = manifest?.sourcePaths?.agents;
  const declared = manifest?.canon?.agents;

  if (typeof sourceBase !== 'string' || !Array.isArray(declared)) {
    throw new Error('Cannot validate canonical agents without sourcePaths.agents and canon.agents.');
  }

  const agentDir = join(repoRoot, ...sourceBase.split('/'));
  const fileNames = readdirSync(agentDir)
    .filter((name) => name.endsWith('.agent.md'))
    .sort();
  const records = fileNames.map((fileName) => {
    const relativePath = `${sourceBase}/${fileName}`;
    const text = readFileSync(join(agentDir, fileName), 'utf8').replace(/\r\n?/g, '\n');
    return inspectAgent(relativePath, fileName, text, errors);
  });

  validateUniqueNames(records, errors);
  validateRoster(records, declared, errors);

  const knownAgents = new Set(records.map((record) => record.fileStem));
  const knownSkills = new Set(manifest.canon?.skills ?? []);
  const knownPrompts = new Set(manifest.canon?.prompts ?? []);
  for (const record of records) {
    validateReferences(record, knownAgents, knownSkills, knownPrompts, errors);
  }
  validateMemberReferenceClosure(records, manifest, knownAgents, errors);

  if (errors.length) {
    throw new Error(`Invalid canonical agents:\n  - ${errors.join('\n  - ')}`);
  }

  return records.map(({ fileStem, frontmatter }) => ({
    name: fileStem,
    description: frontmatter.description,
    whenToUse: frontmatter.when_to_use,
  }));
}

function inspectAgent(relativePath, fileName, text, errors) {
  const fileStem = fileName.slice(0, -'.agent.md'.length);
  const { frontmatter, body } = parseFrontmatter(relativePath, text, errors);

  for (const field of REQUIRED_FIELDS) {
    if (!(field in frontmatter)) errors.push(`${relativePath}: missing frontmatter field "${field}"`);
  }
  for (const field of Object.keys(frontmatter)) {
    if (!REQUIRED_FIELDS.includes(field)) {
      errors.push(`${relativePath}: unknown frontmatter field "${field}"`);
    }
  }

  if (frontmatter.name !== fileStem) {
    errors.push(
      `${relativePath}: frontmatter name "${frontmatter.name ?? ''}" must match filename "${fileStem}"`,
    );
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(frontmatter.name ?? '')) {
    errors.push(`${relativePath}: frontmatter name must be a kebab-case slug`);
  }
  validateNonEmptyString(relativePath, 'description', frontmatter.description, errors);
  validateNonEmptyString(relativePath, 'when_to_use', frontmatter.when_to_use, errors);
  validateEnum(relativePath, 'model', frontmatter.model, MODELS, errors);
  validateEnum(relativePath, 'write_scope', frontmatter.write_scope, WRITE_SCOPES, errors);
  validateEnum(relativePath, 'risk_level', frontmatter.risk_level, RISK_LEVELS, errors);
  validateStringList(relativePath, 'primary_paths', frontmatter.primary_paths, null, errors);
  validateStringList(relativePath, 'tools', frontmatter.tools, TOOLS, errors);

  if (Array.isArray(frontmatter.tools)) {
    if (!frontmatter.tools.includes('read')) {
      errors.push(`${relativePath}: tools must include "read"`);
    }
    if (frontmatter.write_scope === 'read-only' && frontmatter.tools.includes('edit')) {
      errors.push(`${relativePath}: read-only agents must not grant "edit"`);
    }
    if (frontmatter.write_scope !== 'read-only' && !frontmatter.tools.includes('edit')) {
      errors.push(`${relativePath}: writable agents must grant "edit"`);
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    const count = body.split('\n').filter((line) => line === `## ${section}`).length;
    if (count !== 1) {
      errors.push(`${relativePath}: requires exactly one "## ${section}" section (found ${count})`);
    }
  }
  const humanGateCount = body
    .split('\n')
    .filter((line) => line === '### Human-Gated Operations').length;
  if (humanGateCount !== 1) {
    errors.push(
      `${relativePath}: requires exactly one "### Human-Gated Operations" section (found ${humanGateCount})`,
    );
  }

  return { relativePath, fileStem, frontmatter, body, text };
}

function parseFrontmatter(relativePath, text, errors) {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    errors.push(`${relativePath}: file must start with YAML frontmatter`);
    return { frontmatter: {}, body: text };
  }
  const closing = lines.indexOf('---', 1);
  if (closing < 0) {
    errors.push(`${relativePath}: frontmatter has no closing delimiter`);
    return { frontmatter: {}, body: '' };
  }

  const frontmatter = {};
  let currentKey = null;
  for (let i = 1; i < closing; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const item = line.match(/^  -\s+(.+)$/);
    if (item) {
      if (!currentKey || !ARRAY_FIELDS.has(currentKey)) {
        errors.push(`${relativePath}:${i + 1}: list item has no supported list field`);
        continue;
      }
      frontmatter[currentKey].push(parseScalar(item[1]));
      continue;
    }

    const field = line.match(/^([a-z_]+):(?:\s*(.*))?$/);
    if (!field) {
      errors.push(`${relativePath}:${i + 1}: unsupported frontmatter syntax`);
      currentKey = null;
      continue;
    }

    const [, key, rawValue] = field;
    if (key in frontmatter) errors.push(`${relativePath}:${i + 1}: duplicate frontmatter field "${key}"`);
    currentKey = key;
    if (ARRAY_FIELDS.has(key)) {
      frontmatter[key] = [];
      if (rawValue) errors.push(`${relativePath}:${i + 1}: "${key}" must use a YAML list`);
    } else {
      frontmatter[key] = parseScalar(rawValue);
    }
  }

  return { frontmatter, body: lines.slice(closing + 1).join('\n') };
}

function parseScalar(raw = '') {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function validateUniqueNames(records, errors) {
  const owners = new Map();
  for (const record of records) {
    const name = record.frontmatter.name;
    if (!name) continue;
    if (owners.has(name)) {
      errors.push(
        `${record.relativePath}: duplicate agent name "${name}" also declared by ${owners.get(name)}`,
      );
    } else {
      owners.set(name, record.relativePath);
    }
  }
}

function validateRoster(records, declared, errors) {
  const duplicateDeclared = duplicates(declared);
  for (const name of duplicateDeclared) {
    errors.push(`studio.config.json: canon.agents contains duplicate "${name}"`);
  }

  const onDisk = new Set(records.map((record) => record.fileStem));
  const inManifest = new Set(declared);
  for (const name of [...inManifest].sort()) {
    if (!onDisk.has(name)) errors.push(`studio.config.json: canon.agents "${name}" has no agent file`);
  }
  for (const name of [...onDisk].sort()) {
    if (!inManifest.has(name)) errors.push(`${name}.agent.md is not declared in canon.agents`);
  }
}

function validateReferences(record, knownAgents, knownSkills, knownPrompts, errors) {
  const roleReferences = agentReferences(record.text);
  for (const name of [...new Set(roleReferences)].sort()) {
    if (!knownAgents.has(name)) {
      errors.push(`${record.relativePath}: references undeclared agent "@${name}"`);
    }
  }

  const skillReferences = relatedSkillReferences(record, errors);
  for (const name of [...new Set(skillReferences)].sort()) {
    if (!knownSkills.has(name)) {
      errors.push(`${record.relativePath}: references undeclared related skill "${name}"`);
    }
  }

  for (const name of [...new Set(promptReferences(record.text))].sort()) {
    if (!knownPrompts.has(name)) {
      errors.push(`${record.relativePath}: references undeclared prompt "${name}"`);
    }
  }
}

function validateMemberReferenceClosure(records, manifest, knownAgents, errors) {
  const byName = new Map(records.map((record) => [record.fileStem, record]));

  (manifest.members ?? []).forEach((member, index) => {
    const selection = member.optIn?.agents;
    if (selection === false || selection === undefined) return;
    const selected = selection === '*' ? [...knownAgents] : Array.isArray(selection) ? selection : [];
    const available = new Set([...selected, ...(member.localAgents ?? [])]);
    const availableSkills = selectedNames(member.optIn?.skills, manifest.canon?.skills);
    const availablePrompts = selectedNames(member.optIn?.prompts, manifest.canon?.prompts);

    for (const name of selected) {
      const record = byName.get(name);
      if (!record) continue;
      for (const referenced of [...new Set(agentReferences(record.text))].sort()) {
        if (knownAgents.has(referenced) && !available.has(referenced)) {
          errors.push(
            `members[${index}] (${member.repo}): selected agent "${name}" references unavailable ` +
              `"@${referenced}"; opt in or declare a local replacement`,
          );
        }
      }
      for (const skill of [...new Set(relatedSkillReferences(record))].sort()) {
        if (!availableSkills.has(skill)) {
          errors.push(
            `members[${index}] (${member.repo}): selected agent "${name}" requires unavailable ` +
              `skill "${skill}"`,
          );
        }
      }
      for (const prompt of [...new Set(promptReferences(record.text))].sort()) {
        if (!availablePrompts.has(prompt)) {
          errors.push(
            `members[${index}] (${member.repo}): selected agent "${name}" requires unavailable ` +
              `prompt "${prompt}"`,
          );
        }
      }
    }
  });
}

function agentReferences(text) {
  return [...text.matchAll(/(?<![\w./])@([a-z][a-z0-9-]*)(?![\w/-])/g)].map(
    (match) => match[1],
  );
}

function promptReferences(text) {
  return [...text.matchAll(/\bthe `([a-z][a-z0-9-]*)` prompt\b/gi)].map((match) => match[1]);
}

function selectedNames(selection, canon = []) {
  if (selection === '*') return new Set(canon);
  return new Set(Array.isArray(selection) ? selection : []);
}

function relatedSkillReferences(record, errors = []) {
  const marker = '> **Related skills:**';
  const lines = record.body.split('\n');
  const starts = lines.flatMap((line, index) => (line.startsWith(marker) ? [index] : []));
  if (starts.length === 0) return [];
  if (starts.length > 1) {
    errors.push(`${record.relativePath}: must contain at most one Related skills declaration`);
  }

  const block = [lines[starts[0]].slice(marker.length)];
  for (let i = starts[0] + 1; i < lines.length && lines[i].startsWith('>'); i++) {
    block.push(lines[i].replace(/^>\s?/, ''));
  }
  const declaration = block.join(' ');
  const separator = declaration.indexOf('—');
  if (separator < 0) {
    errors.push(`${record.relativePath}: Related skills declaration must end with an em-dash note`);
    return [];
  }
  return [...declaration.slice(0, separator).matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function validateNonEmptyString(relativePath, field, value, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${relativePath}: "${field}" must be a non-empty string`);
  }
}

function validateEnum(relativePath, field, value, allowed, errors) {
  if (!allowed.has(value)) {
    errors.push(`${relativePath}: "${field}" must be one of ${[...allowed].join(', ')}`);
  }
}

function validateStringList(relativePath, field, value, allowed, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${relativePath}: "${field}" must be a non-empty list`);
    return;
  }
  if (duplicates(value).length) {
    errors.push(`${relativePath}: "${field}" must not contain duplicates`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || !item) {
      errors.push(`${relativePath}: "${field}" entries must be non-empty strings`);
    } else if (allowed && !allowed.has(item)) {
      errors.push(`${relativePath}: "${field}" contains unsupported value "${item}"`);
    }
  }
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}
