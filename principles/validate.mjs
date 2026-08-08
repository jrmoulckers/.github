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

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_MANIFEST = join(REPO_ROOT, 'principles', 'manifest.json');

export function validatePrinciples({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  readText = (path) => readFileSync(path, 'utf8'),
  baselineManifest,
} = {}) {
  const manifest = JSON.parse(readText(manifestPath));
  const errors = validateManifest(manifest);
  const baseline = baselineManifest ?? readBaselineManifest(repoRoot);
  if (baseline) errors.push(...validatePublishedEvolution(manifest, baseline));
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
  for (const match of text.matchAll(/^## (GH-[^\r\n]+)$/gm)) {
    if (!/^GH-[A-Z]+-\d{3} — [^\r\n]+$/.test(match[1])) {
      errors.push(`${relativePath}: malformed principle heading "## ${match[1]}"`);
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
      values[field] = readField(principle.body, field);
      if (!values[field]) {
        errors.push(`${relativePath} ${principle.id}: missing ${field}`);
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
  if (!manifest.published || Object.keys(manifest.published).length === 0) {
    errors.push('principles/manifest.json: published must pin at least one principle file');
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
    if (new Set(source.sections).size !== source.sections.length) {
      errors.push(`${file}: legacy source sections must be unique`);
    }
    if (source.ref && (!/^[0-9a-f]{40}$/.test(source.ref) || /^0+$/.test(source.ref))) {
      errors.push(`${file}: legacy source ref must be a nonzero 40-character commit SHA`);
    }
    if (source.blobSha && (!/^[0-9a-f]{40}$/.test(source.blobSha) || /^0+$/.test(source.blobSha))) {
      errors.push(`${file}: legacy source blobSha must be a nonzero Git blob digest`);
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

function readField(body, field) {
  const lines = body.split(/\r?\n/);
  const prefix = `- **${field}:**`;
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) return '';

  const value = [lines[start].slice(prefix.length).trim()];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('- **') || line.startsWith('## ')) break;
    if (line.trim()) value.push(line.trim());
  }

  return value.join(' ').trim();
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
    if (!source || !source.sections.includes(section)) {
      errors.push(`${relativePath} ${id}: unresolved legacy reference "${reference}"`);
    }
  }

  return errors;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readBaselineManifest(repoRoot) {
  try {
    const text = execFileSync(
      'git',
      ['show', 'origin/main:principles/manifest.json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return JSON.parse(text);
  } catch {
    return null;
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
      if (/^## GH-[A-Z]+-\d{3} — /m.test(text)) {
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
