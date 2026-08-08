import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REQUIRED_FIELDS = [
  'Status',
  'Statement',
  'Rationale',
  'Verification / evidence',
  'Owner / ratification',
  'Cross-authority handoff',
  'Legacy inputs',
];

const OWNER_RATIFICATION =
  '`.github` owns this principle; it remains Draft until the repository owner ratifies it through a reviewed pull request.';

const IMPERATIVE_VERBS = new Set([
  'Assign',
  'Author',
  'Bind',
  'Block',
  'Challenge',
  'Define',
  'Design',
  'Disclose',
  'Dispatch',
  'Execute',
  'Factor',
  'Gate',
  'Give',
  'Grant',
  'Keep',
  'Let',
  'Maintain',
  'Make',
  'Minimize',
  'Normalize',
  'Pin',
  'Protect',
  'Re-run',
  'Reconcile',
  'Record',
  'Require',
  'Route',
  'Select',
  'Stage',
  'Stamp',
  'State',
  'Stop',
  'Store',
  'Structure',
  'Supersede',
  'Surface',
  'Treat',
  'Trigger',
  'Validate',
  'Version',
  'Vet',
]);

const AUTHORITY_REFERENCE = /(?:Product|Engineering|Studio|\.github|repository owner|member owner)/;

const BOOTSTRAP_BASE_COMMIT = '7f5214741cb4b26a8df92c7a3e4abb10308dc94f';

const BOOTSTRAP_PUBLISHED = {
  'principles/github/repository-governance.md': [
    'GH-REPO-001',
    'GH-REPO-002',
    'GH-REPO-003',
    'GH-REPO-004',
    'GH-REPO-005',
    'GH-REPO-006',
    'GH-REPO-007',
  ],
  'principles/github/actions-and-delivery.md': [
    'GH-ACT-001',
    'GH-ACT-002',
    'GH-ACT-003',
    'GH-ACT-004',
    'GH-ACT-005',
    'GH-ACT-006',
    'GH-ACT-007',
  ],
  'principles/ai/product-ai.md': [
    'GH-AIP-001',
    'GH-AIP-002',
    'GH-AIP-003',
    'GH-AIP-004',
    'GH-AIP-005',
    'GH-AIP-006',
    'GH-AIP-007',
    'GH-AIP-008',
  ],
  'principles/ai/agent-operations.md': [
    'GH-AIOPS-001',
    'GH-AIOPS-002',
    'GH-AIOPS-003',
    'GH-AIOPS-004',
    'GH-AIOPS-005',
    'GH-AIOPS-006',
    'GH-AIOPS-007',
    'GH-AIOPS-008',
    'GH-AIOPS-009',
    'GH-AIOPS-010',
    'GH-AIOPS-011',
    'GH-AIOPS-012',
    'GH-AIOPS-013',
    'GH-AIOPS-014',
    'GH-AIOPS-015',
  ],
  'principles/ai/evidence-and-evals.md': [
    'GH-AIEVAL-001',
    'GH-AIEVAL-002',
    'GH-AIEVAL-003',
    'GH-AIEVAL-004',
    'GH-AIEVAL-005',
    'GH-AIEVAL-006',
  ],
};

const BOOTSTRAP_LEGACY_SOURCES = {
  'ai-process.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/ai-process.md',
    blobSha: '1bea65c83d75aa4f26daaedcce729700175cc080',
    sections: [
      '1',
      '1.1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
    ],
  },
  'ai-products.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/ai-products.md',
    blobSha: '26a2781c27eb2957162b4566d77e1e856595f5cd',
    sections: ['1', '1.1', '2', '3', '4', '5', '6', '7', '8'],
  },
  'compliance.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/compliance.md',
    blobSha: '6760d67c5dad7699b51e54240b42bcea0c731623',
    sections: ['1', '7', '8'],
  },
  'devops.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/devops.md',
    blobSha: '4d1427f6d7cffbc34f9c555be59c1e4fd3c633f3',
    sections: [
      '1',
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '2',
      '3',
      '8',
      '11',
      '12',
      '13',
      '14',
      '15',
    ],
  },
  'featuring.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/featuring.md',
    blobSha: 'ea9c7dc52e9d8d251b213877c4c67b95a851d11d',
    sections: ['6'],
  },
  'process.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/process.md',
    blobSha: 'badcfa128c2dab6b74ad929c9b4d82143ca63265',
    sections: ['1', '4'],
  },
  'security.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/security.md',
    blobSha: '18e4a8780e6c7997662e1ef1add9cf0fdbbbbe07',
    sections: ['1', '2', '4', '5'],
  },
  'testing.md': {
    repository: 'jrmoulckers/studio',
    ref: '7bccd0eb1cb3092135b9fbf1bef5df4ad07cc972',
    path: 'principles/testing.md',
    blobSha: '4a22fa00dfc62747abf321d966e0cf4a1186a543',
    sections: ['7', '8', '10'],
  },
};

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_MANIFEST = join(REPO_ROOT, 'principles', 'manifest.json');

export function validatePrinciples({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  readText = (path) => readFileSync(path, 'utf8'),
  baselineManifest,
  baselineCommit,
} = {}) {
  const manifest = JSON.parse(readText(manifestPath));
  const errors = validateManifest(manifest);
  errors.push(...validatePublishedEvolution(manifest, { published: BOOTSTRAP_PUBLISHED }));

  if (baselineManifest !== undefined) {
    if (baselineManifest) {
      errors.push(...validatePublishedEvolution(manifest, baselineManifest));
      errors.push(...validateLegacyEvolution(manifest, baselineManifest));
    } else {
      errors.push(
        ...validateLegacyEvolution(manifest, {
          legacySources: BOOTSTRAP_LEGACY_SOURCES,
        }),
      );
    }
  } else {
    const evidence = readBaselineEvidence(repoRoot, baselineCommit);
    if (evidence.manifest) {
      errors.push(...validatePublishedEvolution(manifest, evidence.manifest));
      errors.push(...validateLegacyEvolution(manifest, evidence.manifest));
    } else if (evidence.baseCommit !== BOOTSTRAP_BASE_COMMIT) {
      errors.push(
        `principles/manifest.json: trustworthy base manifest unavailable${
          evidence.error ? ` (${evidence.error})` : ''
        }`,
      );
    } else {
      errors.push(
        ...validateLegacyEvolution(manifest, {
          legacySources: BOOTSTRAP_LEGACY_SOURCES,
        }),
      );
    }
  }
  const seenIds = new Map();
  const publishedPaths = new Set(Object.keys(manifest.published ?? {}));
  let principleCount = 0;

  for (const relativePath of discoverPrincipleFiles(repoRoot)) {
    if (!publishedPaths.has(relativePath)) {
      errors.push(`${relativePath}: principle file is not pinned in principles/manifest.json`);
    }
  }

  for (const [relativePath, expectedIds] of Object.entries(manifest.published ?? {})) {
    let text;
    try {
      text = readText(join(repoRoot, relativePath));
    } catch (error) {
      errors.push(`${relativePath}: cannot read published principle file (${error.message})`);
      continue;
    }

    const result = validatePrincipleDocument({
      relativePath,
      text,
      expectedIds,
      legacySources: manifest.legacySources ?? {},
      seenIds,
    });
    errors.push(...result.errors);
    principleCount += result.ids.length;
  }

  if (errors.length > 0) {
    const error = new Error(`Principle validation failed:\n- ${errors.join('\n- ')}`);
    error.validationErrors = errors;
    throw error;
  }

  return {
    fileCount: Object.keys(manifest.published).length,
    principleCount,
  };
}

export function validatePrincipleDocument({
  relativePath,
  text,
  expectedIds,
  legacySources,
  seenIds = new Map(),
}) {
  const errors = [];
  for (const match of text.matchAll(/^( {0,3})## (GH-[^\r\n]+)$/gm)) {
    if (match[1] || !/^GH-[A-Z]+-\d{3} — [^\r\n]+$/.test(match[2])) {
      errors.push(`${relativePath}: malformed principle heading "${match[0]}"`);
    }
  }
  const principles = parsePrinciples(text);
  const ids = principles.map(({ id }) => id);

  if (!arraysEqual(ids, expectedIds)) {
    errors.push(
      `${relativePath}: published IDs must be [${expectedIds.join(', ')}], found [${ids.join(', ')}]`,
    );
  }

  for (const principle of principles) {
    const previousPath = seenIds.get(principle.id);
    if (previousPath) {
      errors.push(`${relativePath}: duplicate principle ID ${principle.id} (already in ${previousPath})`);
    } else {
      seenIds.set(principle.id, relativePath);
    }

    const values = {};
    for (const field of REQUIRED_FIELDS) {
      const occurrences = readFields(principle.body, field);
      values[field] = occurrences[0] ?? '';
      if (occurrences.length === 0 || !values[field]) {
        errors.push(`${relativePath} ${principle.id}: missing ${field}`);
      } else if (occurrences.length > 1) {
        errors.push(`${relativePath} ${principle.id}: ${field} must appear exactly once`);
      }
    }

    if (values.Status && values.Status !== 'Draft') {
      errors.push(`${relativePath} ${principle.id}: Status must be Draft`);
    }

    if (values.Statement) {
      const firstWord = values.Statement.split(/\s+/, 1)[0];
      if (!IMPERATIVE_VERBS.has(firstWord)) {
        errors.push(
          `${relativePath} ${principle.id}: Statement must start with an imperative verb, found "${firstWord}"`,
        );
      }
    }

    if (values['Owner / ratification'] && values['Owner / ratification'] !== OWNER_RATIFICATION) {
      errors.push(`${relativePath} ${principle.id}: Owner / ratification must use owner-only wording`);
    }

    if (
      values['Cross-authority handoff'] &&
      !AUTHORITY_REFERENCE.test(values['Cross-authority handoff'])
    ) {
      errors.push(
        `${relativePath} ${principle.id}: Cross-authority handoff must name a responsible authority`,
      );
    }

    if (values['Legacy inputs']) {
      errors.push(
        ...validateLegacyInputs(
          relativePath,
          principle.id,
          values['Legacy inputs'],
          legacySources,
        ),
      );
    }
  }

  return { errors, ids };
}

export function validatePublishedEvolution(current, baseline) {
  const errors = [];

  for (const [relativePath, baselineIds] of Object.entries(baseline.published ?? {})) {
    const currentIds = current.published?.[relativePath];
    if (!currentIds) {
      errors.push(`${relativePath}: published principle file cannot be removed from the manifest`);
      continue;
    }

    if (!arraysEqual(currentIds.slice(0, baselineIds.length), baselineIds)) {
      errors.push(
        `${relativePath}: published IDs are append-only; baseline [${baselineIds.join(', ')}], current [${currentIds.join(', ')}]`,
      );
    }
  }

  return errors;
}

export function validateLegacyEvolution(current, baseline) {
  const errors = [];
  const baselineMigrations = Array.isArray(baseline.legacyMigrations)
    ? baseline.legacyMigrations
    : [];
  const currentMigrations = Array.isArray(current.legacyMigrations)
    ? current.legacyMigrations
    : [];
  if (
    !jsonEqual(
      currentMigrations.slice(0, baselineMigrations.length),
      baselineMigrations,
    )
  ) {
    errors.push('principles/manifest.json: legacyMigrations history is append-only');
  }
  const appendedMigrations = currentMigrations.slice(baselineMigrations.length);
  const currentSources = current.legacySources ?? {};
  const baselineSources = baseline.legacySources ?? {};
  const sourceNames = new Set([
    ...Object.keys(currentSources),
    ...Object.keys(baselineSources),
    ...appendedMigrations.map((migration) => migration.source).filter(Boolean),
  ]);

  for (const sourceName of sourceNames) {
    const before = baselineSources[sourceName] ?? null;
    const after = currentSources[sourceName] ?? null;
    const migrations = appendedMigrations.filter(
      (entry) => entry.source === sourceName,
    );
    if (jsonEqual(before, after)) {
      if (migrations.length > 0) {
        errors.push(`${sourceName}: appended migration does not change the legacy source`);
      }
      continue;
    }

    let cursor = before;
    for (const [index, migration] of migrations.entries()) {
      if (!jsonEqual(migration.from, cursor)) {
        errors.push(
          `${sourceName}: appended migration ${index} is disconnected from the prior source`,
        );
        cursor = undefined;
        break;
      }
      cursor = migration.to;
    }
    if (migrations.length === 0 || !jsonEqual(cursor, after)) {
      errors.push(
        `${sourceName}: legacy source changes require a connected legacyMigrations chain with review evidence`,
      );
    }
  }

  return errors;
}

export function verifyLegacySources(manifest, loadSource) {
  const errors = [];

  for (const [file, source] of Object.entries(manifest.legacySources ?? {})) {
    let resolved;
    try {
      resolved = loadSource(source);
    } catch (error) {
      errors.push(`${file}: cannot resolve pinned legacy source (${error.message})`);
      continue;
    }

    if (resolved.sha !== source.blobSha) {
      errors.push(
        `${file}: pinned legacy blob mismatch; expected ${source.blobSha}, found ${resolved.sha}`,
      );
    }

    const text = Buffer.from(resolved.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const headings = new Set(
      [...text.matchAll(/^#{3,4} (\d+(?:\.\d+)?)(?:\.)? /gm)].map((match) => match[1]),
    );
    for (const section of source.sections) {
      if (!headings.has(section)) {
        errors.push(`${file}: pinned legacy source has no section ${section}`);
      }
    }
  }

  return errors;
}

function validateManifest(manifest) {
  const errors = [];

  if (manifest.schemaVersion !== 1) {
    errors.push('principles/manifest.json: schemaVersion must be 1');
  }
  if (
    manifest.history?.bootstrapBaseCommit !== BOOTSTRAP_BASE_COMMIT
  ) {
    errors.push(
      `principles/manifest.json: history.bootstrapBaseCommit must remain ${BOOTSTRAP_BASE_COMMIT}`,
    );
  }
  if (!manifest.published || Object.keys(manifest.published).length === 0) {
    errors.push('principles/manifest.json: published must pin at least one principle file');
  }
  for (const [file, ids] of Object.entries(manifest.published ?? {})) {
    if (!Array.isArray(ids) || ids.length === 0) {
      errors.push(`${file}: published IDs must be a nonempty array`);
    }
  }

  for (const [file, source] of Object.entries(manifest.legacySources ?? {})) {
    if (
      !source.repository ||
      !source.ref ||
      !source.path ||
      !source.blobSha ||
      !Array.isArray(source.sections) ||
      source.sections.length === 0
    ) {
      errors.push(`${file}: legacy source must define repository, ref, path, blobSha, and sections`);
    }
    if (
      Array.isArray(source.sections) &&
      new Set(source.sections).size !== source.sections.length
    ) {
      errors.push(`${file}: legacy source sections must be unique`);
    }
    if (source.ref && !isNonzeroSha(source.ref)) {
      errors.push(`${file}: legacy source ref must be a nonzero 40-character commit SHA`);
    }
    if (source.blobSha && !isNonzeroSha(source.blobSha)) {
      errors.push(`${file}: legacy source blobSha must be a nonzero Git blob digest`);
    }
  }

  if (!Array.isArray(manifest.legacyMigrations)) {
    errors.push('principles/manifest.json: legacyMigrations must be an array');
  }
  const migrations = Array.isArray(manifest.legacyMigrations)
    ? manifest.legacyMigrations
    : [];
  for (const [index, migration] of migrations.entries()) {
    if (
      !migration.source ||
      !('from' in migration) ||
      !('to' in migration) ||
      !migration.reason?.trim() ||
      !/^https:\/\/github\.com\/jrmoulckers\/\.github\/(?:issues|pull)\/\d+$/.test(
        migration.reviewEvidence ?? '',
      )
    ) {
      errors.push(
        `principles/manifest.json: legacyMigrations[${index}] must define source, exact from/to, reason, and .github reviewEvidence`,
      );
    }
  }

  return errors;
}

function parsePrinciples(text) {
  const heading = /^## (GH-[A-Z]+-\d{3}) — ([^\r\n]+)$/gm;
  const matches = [...text.matchAll(heading)];

  return matches.map((match, index) => ({
    id: match[1],
    title: match[2],
    body: text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length),
  }));
}

function readFields(body, field) {
  const lines = body.split(/\r?\n/);
  const fieldPattern = new RegExp(`^ {0,3}- \\*\\*${escapeRegExp(field)}:\\*\\*(.*)$`);
  const values = [];

  for (let start = 0; start < lines.length; start += 1) {
    const match = fieldPattern.exec(lines[start]);
    if (!match) continue;
    const value = [match[1].trim()];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^ {0,3}- \*\*/.test(line) || /^ {0,3}## /.test(line)) break;
      if (line.trim()) value.push(line.trim());
    }
    values.push(value.join(' ').trim());
  }

  return values;
}

function validateLegacyInputs(relativePath, id, value, legacySources) {
  if (value === 'none') return [];

  const errors = [];
  const references = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const residue = value.replace(/`[^`]+`/g, '').replace(/[\s,]/g, '');

  if (references.length === 0 || residue) {
    errors.push(`${relativePath} ${id}: Legacy inputs must be exact backticked references or none`);
    return errors;
  }

  for (const reference of references) {
    const match = /^(.+\.md) §(\d+(?:\.\d+)?)$/.exec(reference);
    if (!match) {
      errors.push(`${relativePath} ${id}: malformed legacy reference "${reference}"`);
      continue;
    }

    const [, file, section] = match;
    const source = legacySources[file];
    if (!source || !Array.isArray(source.sections) || !source.sections.includes(section)) {
      errors.push(`${relativePath} ${id}: unresolved legacy reference "${reference}"`);
    }
  }

  return errors;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isNonzeroSha(value) {
  return /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value);
}

export function selectBaselineCommit({
  explicit,
  mergeBase,
  head,
  previous,
}) {
  if (explicit) {
    if (!isNonzeroSha(explicit)) {
      throw new Error('PRINCIPLES_BASE_SHA must be a nonzero commit SHA');
    }
    return explicit;
  }
  if (!mergeBase) throw new Error('merge base is unavailable');
  if (mergeBase !== head) return mergeBase;
  if (!previous) throw new Error('previous revision is unavailable for a self-baseline');
  return previous;
}

function readBaselineEvidence(
  repoRoot,
  explicitBaseCommit = process.env.PRINCIPLES_BASE_SHA,
) {
  let head;
  let mergeBase;
  let previous;
  try {
    head = execFileSync(
      'git',
      ['rev-parse', 'HEAD'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    mergeBase = execFileSync(
      'git',
      ['merge-base', 'HEAD', 'origin/main'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (mergeBase === head) {
      previous = execFileSync(
        'git',
        ['rev-parse', 'HEAD^'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
    }
  } catch (error) {
    return { error: `cannot resolve baseline revisions: ${error.message}` };
  }

  let baseCommit;
  try {
    baseCommit = selectBaselineCommit({
      explicit: explicitBaseCommit,
      mergeBase,
      head,
      previous,
    });
  } catch (error) {
    return { error: error.message };
  }

  try {
    const text = execFileSync(
      'git',
      ['show', `${baseCommit}:principles/manifest.json`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return { baseCommit, manifest: JSON.parse(text) };
  } catch {
    return { baseCommit };
  }
}

function discoverPrincipleFiles(repoRoot) {
  const files = [];

  for (const directory of ['principles/github', 'principles/ai']) {
    const absoluteDirectory = join(repoRoot, directory);
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const absolutePath = join(absoluteDirectory, entry.name);
      const text = readFileSync(absolutePath, 'utf8');
      if (/^ {0,3}## GH-/m.test(text)) {
        files.push(relative(repoRoot, absolutePath).replaceAll('\\', '/'));
      }
    }
  }

  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = validatePrinciples();
    if (process.argv.includes('--verify-legacy')) {
      const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8'));
      const errors = verifyLegacySources(manifest, loadGitHubSource);
      if (errors.length > 0) {
        throw new Error(`Legacy source verification failed:\n- ${errors.join('\n- ')}`);
      }
    }
    console.log(
      `Validated ${result.principleCount} Draft principles across ${result.fileCount} files.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function loadGitHubSource(source) {
  const endpoint =
    `repos/${source.repository}/contents/${source.path}?ref=${source.ref}`;
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
