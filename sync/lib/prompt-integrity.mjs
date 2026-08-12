// Canonical prompt integrity validation.
//
// Prompt files are executable workflow specifications distributed to member repositories. This
// validator keeps their runtime contract, parameters, agent references, and member selections
// dependency-closed before the sync engine can plan or copy them.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOP_LEVEL_FIELDS = [
  'name',
  'description',
  'parameters',
  'built_ins',
  'agent_dependencies',
];
const LIST_FIELDS = new Set(['built_ins', 'agent_dependencies']);
const PARAMETER_FIELDS = new Set([
  'name',
  'type',
  'description',
  'default',
  'required',
  'minimum',
  'maximum',
  'minimum_items',
  'maximum_items',
]);
const PARAMETER_TYPES = new Set(['string', 'integer', 'agent-list']);
const BUILT_INS = new Set(['task', 'code-review', 'read_agent', 'list_agents', 'sql_todos']);
const PR_CHECK_FIELDS = new Set([
  'bucket',
  'completedAt',
  'description',
  'event',
  'link',
  'name',
  'startedAt',
  'state',
  'workflow',
]);

export function validatePromptIntegrity(repoRoot, manifest) {
  const errors = [];
  const sourceBase = manifest?.sourcePaths?.prompts;
  const declared = manifest?.canon?.prompts;

  if (typeof sourceBase !== 'string' || !Array.isArray(declared)) {
    throw new Error('Cannot validate canonical prompts without sourcePaths.prompts and canon.prompts.');
  }

  const promptDir = join(repoRoot, ...sourceBase.split('/'));
  const fileNames = readdirSync(promptDir)
    .filter((name) => name.endsWith('.prompt.md'))
    .sort();
  const records = fileNames.map((fileName) => {
    const relativePath = `${sourceBase}/${fileName}`;
    const text = readFileSync(join(promptDir, fileName), 'utf8').replace(/\r\n?/g, '\n');
    return inspectPrompt(relativePath, fileName, text, errors);
  });

  validateUniqueNames(records, errors);
  validateRoster(records, declared, errors);
  validateMemberDependencyClosure(records, manifest, errors);

  if (errors.length) {
    throw new Error(`Invalid canonical prompts:\n  - ${errors.join('\n  - ')}`);
  }

  return records.map(({ fileStem, frontmatter }) => ({
    name: fileStem,
    description: frontmatter.description,
    parameters: frontmatter.parameters,
    builtIns: frontmatter.built_ins,
    agentDependencies: frontmatter.agent_dependencies,
  }));
}

function inspectPrompt(relativePath, fileName, text, errors) {
  const fileStem = fileName.slice(0, -'.prompt.md'.length);
  const { frontmatter, body } = parseFrontmatter(relativePath, text, errors);

  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in frontmatter)) errors.push(`${relativePath}: missing frontmatter field "${field}"`);
  }
  for (const field of Object.keys(frontmatter)) {
    if (!TOP_LEVEL_FIELDS.includes(field)) {
      errors.push(`${relativePath}: unknown frontmatter field "${field}"`);
    }
  }

  if (frontmatter.name !== fileStem) {
    errors.push(
      `${relativePath}: frontmatter name "${frontmatter.name ?? ''}" must match filename "${fileStem}"`,
    );
  }
  if (!isSlug(frontmatter.name)) {
    errors.push(`${relativePath}: frontmatter name must be a kebab-case slug`);
  }
  validateNonEmptyString(relativePath, 'description', frontmatter.description, errors);
  validateParameters(relativePath, frontmatter.parameters, body, errors);
  validateStringList(relativePath, 'built_ins', frontmatter.built_ins, BUILT_INS, errors);
  validateStringList(
    relativePath,
    'agent_dependencies',
    frontmatter.agent_dependencies,
    null,
    errors,
  );
  validateBuiltIns(relativePath, frontmatter.built_ins, body, errors);
  validateAgentReferences(relativePath, frontmatter.agent_dependencies, body, errors);
  validateCheckFields(relativePath, body, errors);

  if (!body.split('\n').some((line) => line === '## Runtime Contract')) {
    errors.push(`${relativePath}: requires exactly one "## Runtime Contract" section`);
  } else if (body.split('\n').filter((line) => line === '## Runtime Contract').length !== 1) {
    errors.push(`${relativePath}: requires exactly one "## Runtime Contract" section`);
  }

  return { relativePath, fileStem, frontmatter, body };
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
  let section = null;
  let currentParameter = null;
  const implicitEmptyLists = new Set();

  for (let i = 1; i < closing; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const topLevel = line.match(/^([a-z_]+):(?:\s*(.*))?$/);
    if (topLevel) {
      const [, key, rawValue = ''] = topLevel;
      if (key in frontmatter) {
        errors.push(`${relativePath}:${i + 1}: duplicate frontmatter field "${key}"`);
      }
      section = null;
      currentParameter = null;

      if (key === 'parameters' || LIST_FIELDS.has(key)) {
        frontmatter[key] = [];
        if (rawValue === '[]') continue;
        if (rawValue) {
          errors.push(`${relativePath}:${i + 1}: "${key}" must use a YAML list or []`);
          continue;
        }
        section = key;
        implicitEmptyLists.add(key);
      } else {
        frontmatter[key] = parseScalar(rawValue);
      }
      continue;
    }

    if (section === 'parameters') {
      const start = line.match(/^  -\s+([a-z_]+):(?:\s*(.*))?$/);
      if (start) {
        currentParameter = { [start[1]]: parseScalar(start[2] ?? '') };
        frontmatter.parameters.push(currentParameter);
        implicitEmptyLists.delete('parameters');
        continue;
      }
      const field = line.match(/^    ([a-z_]+):(?:\s*(.*))?$/);
      if (field && currentParameter) {
        if (field[1] in currentParameter) {
          errors.push(
            `${relativePath}:${i + 1}: duplicate parameter field "${field[1]}"`,
          );
        }
        currentParameter[field[1]] = parseScalar(field[2] ?? '');
        continue;
      }
    } else if (LIST_FIELDS.has(section)) {
      const item = line.match(/^  -\s+(.+)$/);
      if (item) {
        frontmatter[section].push(parseScalar(item[1]));
        implicitEmptyLists.delete(section);
        continue;
      }
    }

    errors.push(`${relativePath}:${i + 1}: unsupported frontmatter syntax`);
  }

  for (const key of implicitEmptyLists) {
    errors.push(`${relativePath}: "${key}" must use explicit [] or at least one list item`);
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
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function validateParameters(relativePath, parameters, body, errors) {
  if (!Array.isArray(parameters)) {
    errors.push(`${relativePath}: "parameters" must be a list`);
    return;
  }

  const names = [];
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
      errors.push(`${relativePath}: each parameter must be an object`);
      continue;
    }
    for (const field of ['name', 'type', 'description', 'default']) {
      if (!(field in parameter)) {
        errors.push(`${relativePath}: parameter missing field "${field}"`);
      }
    }
    for (const field of Object.keys(parameter)) {
      if (!PARAMETER_FIELDS.has(field)) {
        errors.push(`${relativePath}: parameter "${parameter.name ?? ''}" has unknown field "${field}"`);
      }
    }

    const label = `parameter "${parameter.name ?? ''}"`;
    if (parameter.name !== 'N' && !isSlug(parameter.name)) {
      errors.push(`${relativePath}: ${label} name must be kebab-case or the conventional "N"`);
    }
    names.push(parameter.name);
    validateNonEmptyString(relativePath, `${label} description`, parameter.description, errors);
    if (!PARAMETER_TYPES.has(parameter.type)) {
      errors.push(
        `${relativePath}: ${label} type must be one of ${[...PARAMETER_TYPES].join(', ')}`,
      );
      continue;
    }
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') {
      errors.push(`${relativePath}: ${label} required must be a boolean`);
    }

    if (parameter.type === 'integer') {
      for (const field of ['default', 'minimum', 'maximum']) {
        if (!Number.isInteger(parameter[field])) {
          errors.push(`${relativePath}: ${label} ${field} must be an integer`);
        }
      }
      if (Number.isInteger(parameter.minimum) && parameter.minimum < 1) {
        errors.push(`${relativePath}: ${label} minimum must be positive`);
      }
      if (
        Number.isInteger(parameter.minimum) &&
        Number.isInteger(parameter.default) &&
        Number.isInteger(parameter.maximum) &&
        (parameter.minimum > parameter.default || parameter.default > parameter.maximum)
      ) {
        errors.push(`${relativePath}: ${label} default must be within minimum and maximum`);
      }
      if ('minimum_items' in parameter || 'maximum_items' in parameter) {
        errors.push(`${relativePath}: ${label} cannot declare item bounds`);
      }
    } else if (parameter.type === 'agent-list') {
      if (typeof parameter.default !== 'string') {
        errors.push(`${relativePath}: ${label} default must be a comma-separated string`);
      }
      if (parameter.required !== true) {
        errors.push(`${relativePath}: ${label} must set required: true`);
      }
      for (const field of ['minimum_items', 'maximum_items']) {
        if (!Number.isInteger(parameter[field]) || parameter[field] < 1) {
          errors.push(`${relativePath}: ${label} ${field} must be a positive integer`);
        }
      }
      if (
        Number.isInteger(parameter.minimum_items) &&
        Number.isInteger(parameter.maximum_items) &&
        parameter.minimum_items > parameter.maximum_items
      ) {
        errors.push(`${relativePath}: ${label} item bounds are inverted`);
      }
      if ('minimum' in parameter || 'maximum' in parameter) {
        errors.push(`${relativePath}: ${label} cannot declare numeric bounds`);
      }
    } else {
      if (typeof parameter.default !== 'string') {
        errors.push(`${relativePath}: ${label} default must be a string`);
      }
      for (const field of ['minimum', 'maximum', 'minimum_items', 'maximum_items']) {
        if (field in parameter) errors.push(`${relativePath}: ${label} cannot declare "${field}"`);
      }
    }
  }

  for (const duplicate of duplicates(names.filter(Boolean))) {
    errors.push(`${relativePath}: duplicate parameter name "${duplicate}"`);
  }

  const referenced = [];
  const withoutPlaceholders = body.replace(
    /(?<!\{)\{\{\s*([A-Za-z][A-Za-z0-9-]*)\s*\}\}(?!\})/g,
    (_, name) => {
      referenced.push(name);
      if (!names.includes(name)) {
        errors.push(`${relativePath}: unresolved placeholder "{{ ${name} }}"`);
      }
      return '';
    },
  );
  if (withoutPlaceholders.includes('{{') || withoutPlaceholders.includes('}}')) {
    errors.push(`${relativePath}: malformed or unresolved parameter placeholder`);
  }
  for (const name of names.filter(Boolean)) {
    if (!referenced.includes(name)) {
      errors.push(`${relativePath}: parameter "${name}" is never interpolated`);
    }
  }
}

function validateBuiltIns(relativePath, declared, body, errors) {
  if (!Array.isArray(declared)) return;
  const referenced = new Set();
  if (/\btask\s*\(/.test(body)) referenced.add('task');
  if (/agent_type\s*=\s*["']code-review["']/.test(body)) referenced.add('code-review');
  if (/\bread_agent\b/.test(body)) referenced.add('read_agent');
  if (/\blist_agents\b/.test(body)) referenced.add('list_agents');
  if (/\bSQL todos\b/i.test(body)) referenced.add('sql_todos');

  validateExactDependencies(relativePath, 'built-in', declared, referenced, errors);
}

function validateAgentReferences(relativePath, declared, body, errors) {
  if (!Array.isArray(declared)) return;
  const referenced = new Set(
    [...body.matchAll(/(?<![\w./])@([a-z][a-z0-9-]*)(?![\w/-])/g)].map((match) => match[1]),
  );
  for (const match of body.matchAll(/agent_type\s*=\s*["']([a-z][a-z0-9-]*)["']/g)) {
    if (!BUILT_INS.has(match[1])) referenced.add(match[1]);
  }
  validateExactDependencies(relativePath, 'agent', declared, referenced, errors);
}

function validateExactDependencies(relativePath, kind, declared, referenced, errors) {
  const declaredSet = new Set(declared);
  for (const name of [...referenced].sort()) {
    if (!declaredSet.has(name)) {
      errors.push(`${relativePath}: references undeclared ${kind} dependency "${name}"`);
    }
  }
  for (const name of [...declaredSet].sort()) {
    if (!referenced.has(name)) {
      errors.push(`${relativePath}: declares unused ${kind} dependency "${name}"`);
    }
  }
}

function validateCheckFields(relativePath, body, errors) {
  for (const command of body.matchAll(/\bgh\s+pr\s+checks\b(?:\\\r?\n|[^\n`])*/g)) {
    const occurrences = [...command[0].matchAll(/--json\b/g)];
    const selections = [
      ...command[0].matchAll(/--json(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s`\\]+))/g),
    ];
    if (occurrences.length !== selections.length) {
      errors.push(`${relativePath}: gh pr checks has an unparseable --json selection`);
      continue;
    }
    for (const selection of selections) {
      const fields = selection[1] ?? selection[2] ?? selection[3];
      for (const field of fields.split(',')) {
        if (!PR_CHECK_FIELDS.has(field)) {
          errors.push(`${relativePath}: gh pr checks uses unsupported JSON field "${field}"`);
        }
      }
    }
  }
}

function validateUniqueNames(records, errors) {
  const owners = new Map();
  for (const record of records) {
    const name = record.frontmatter.name;
    if (!name) continue;
    if (owners.has(name)) {
      errors.push(
        `${record.relativePath}: duplicate prompt name "${name}" also declared by ${owners.get(name)}`,
      );
    } else {
      owners.set(name, record.relativePath);
    }
  }
}

function validateRoster(records, declared, errors) {
  for (const name of duplicates(declared)) {
    errors.push(`studio.config.json: canon.prompts contains duplicate "${name}"`);
  }

  const onDisk = new Set(records.map((record) => record.fileStem));
  const inManifest = new Set(declared);
  for (const name of [...inManifest].sort()) {
    if (!onDisk.has(name)) {
      errors.push(`studio.config.json: canon.prompts "${name}" has no prompt file`);
    }
  }
  for (const name of [...onDisk].sort()) {
    if (!inManifest.has(name)) errors.push(`${name}.prompt.md is not declared in canon.prompts`);
  }
}

function validateMemberDependencyClosure(records, manifest, errors) {
  const byName = new Map(records.map((record) => [record.fileStem, record]));
  const knownAgents = new Set(manifest.canon?.agents ?? []);

  for (const record of records) {
    for (const dependency of record.frontmatter.agent_dependencies ?? []) {
      if (!knownAgents.has(dependency)) {
        errors.push(`${record.relativePath}: references unknown canonical agent "${dependency}"`);
      }
    }
  }

  (manifest.members ?? []).forEach((member, index) => {
    const selectedPrompts = selectedNames(member.optIn?.prompts, manifest.canon?.prompts);
    const selectedAgents = selectedNames(member.optIn?.agents, manifest.canon?.agents);
    const availableAgents = new Set([...selectedAgents, ...(member.localAgents ?? [])]);

    for (const name of selectedPrompts) {
      const record = byName.get(name);
      if (!record) continue;
      for (const dependency of record.frontmatter.agent_dependencies ?? []) {
        if (!availableAgents.has(dependency)) {
          errors.push(
            `members[${index}] (${member.repo}): selected prompt "${name}" requires unavailable ` +
              `agent "${dependency}"`,
          );
        }
      }
    }
  });
}

function selectedNames(selection, canon = []) {
  if (selection === '*') return [...canon];
  return Array.isArray(selection) ? selection : [];
}

function validateStringList(relativePath, field, value, allowed, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${relativePath}: "${field}" must be a list`);
    return;
  }
  for (const duplicate of duplicates(value)) {
    errors.push(`${relativePath}: "${field}" contains duplicate "${duplicate}"`);
  }
  for (const item of value) {
    if (!isSlug(item) && !/^[a-z][a-z0-9_]*$/.test(item ?? '')) {
      errors.push(`${relativePath}: "${field}" entries must be non-empty slugs`);
    } else if (allowed && !allowed.has(item)) {
      errors.push(`${relativePath}: "${field}" contains unsupported value "${item}"`);
    }
  }
}

function validateNonEmptyString(relativePath, field, value, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${relativePath}: "${field}" must be a non-empty string`);
  }
}

function isSlug(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
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
