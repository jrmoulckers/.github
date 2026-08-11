import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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

const RATIFICATION_BASE_COMMIT = '97ff60ec21321563fa0fc7ba80015261e7dcd6fa';
const RATIFICATION_IDS = Object.values(BOOTSTRAP_PUBLISHED).flat();
const EXPECTED_RATIFICATION_DECISION = {
  recordPath: 'principles/decisions/0001-github-ai-owner-ratification.md',
  principles: RATIFICATION_IDS,
  sourcePullRequests: [89, 92],
  finalReviewEvidence: [
    {
      pullRequest: 89,
      finalHeadCommit: '95293ea98a26228d2ee143fbbb19e04e2aff80b3',
      mergeCommit: '7f5214741cb4b26a8df92c7a3e4abb10308dc94f',
      successfulChecks: ['Sync engine tests'],
    },
    {
      pullRequest: 92,
      finalHeadCommit: '698bc2befb0b697b3946d996471339fbf2b13136',
      mergeCommit: '3036d5d1ed882a4c5acffe1ccfa0b49165538eef',
      successfulChecks: [
        'Principle metadata tests',
        'Sync engine tests',
        'CI gate',
      ],
    },
    {
      pullRequest: 97,
      finalHeadCommit: '73a5bf6769a4d4235b55057453d896d876f71069',
      mergeCommit: '97ff60ec21321563fa0fc7ba80015261e7dcd6fa',
      successfulChecks: [
        'Principle metadata tests',
        'Sync engine tests',
        'CI gate',
      ],
    },
  ],
  baseCommit: RATIFICATION_BASE_COMMIT,
  currentApprovalState:
    'Proposed; this record does not claim repository-owner approval before merge.',
  effectiveApproval:
    'Ratification is effective only when repository owner jrmoulckers merges the pull request containing this record after CI gate succeeds.',
  requiredProtection: {
    branch: 'main',
    strictRequiredCheck: 'CI gate',
    forcePushes: false,
    deletions: false,
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
  let comparisonManifest;
  let comparisonCommit = baselineCommit;

  if (baselineManifest !== undefined) {
    comparisonManifest = baselineManifest;
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
    comparisonManifest = evidence.manifest;
    comparisonCommit = evidence.baseCommit;
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
  errors.push(
    ...validateRatificationEvolution(
      manifest,
      comparisonManifest ?? { published: BOOTSTRAP_PUBLISHED },
      comparisonCommit,
    ),
  );
  errors.push(...validateDecisionRecords(manifest, repoRoot, readText));
  errors.push(...validateRatificationSemanticBase(manifest, repoRoot, readText));
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
      statusCatalog: manifest.statusCatalog ?? {},
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
  statusCatalog = {},
  seenIds = new Map(),
}) {
  const errors = [];
  const semanticHashes = {};
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

    const catalogEntry = statusCatalog[principle.id];
    const expectedStatus = catalogEntry?.status ?? 'Ratified';
    if (values.Status && values.Status !== expectedStatus) {
      errors.push(`${relativePath} ${principle.id}: Status must be ${expectedStatus}`);
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

    if (REQUIRED_FIELDS.every((field) => values[field])) {
      const semanticHash = semanticContentHash({
        id: principle.id,
        title: principle.title,
        values,
      });
      semanticHashes[principle.id] = semanticHash;
      if (
        catalogEntry?.semanticContentSha256 &&
        catalogEntry.semanticContentSha256 !== semanticHash
      ) {
        errors.push(
          `${relativePath} ${principle.id}: semantic content hash must remain ${catalogEntry.semanticContentSha256}, found ${semanticHash}`,
        );
      }
    }
  }

  return { errors, ids, semanticHashes };
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

export function validateRatificationEvolution(current, baseline, baselineCommit) {
  const errors = [];
  const currentDecisions = Array.isArray(current.ratificationDecisions)
    ? current.ratificationDecisions
    : [];
  const baselineDecisions = Array.isArray(baseline.ratificationDecisions)
    ? baseline.ratificationDecisions
    : [];
  if (!jsonEqual(currentDecisions.slice(0, baselineDecisions.length), baselineDecisions)) {
    errors.push('principles/manifest.json: ratificationDecisions history is append-only');
  }

  const currentCatalog = current.statusCatalog ?? {};
  const baselineCatalog = baseline.statusCatalog ?? draftCatalogFromPublished(
    baseline.published ?? {},
    currentCatalog,
  );
  const changedToRatified = [];
  for (const [id, before] of Object.entries(baselineCatalog)) {
    const after = currentCatalog[id];
    if (!after) {
      errors.push(`${id}: status catalog entries cannot be deleted`);
      continue;
    }
    if (
      before.path !== after.path ||
      before.semanticContentSha256 !== after.semanticContentSha256
    ) {
      errors.push(`${id}: status catalog path and semantic hash are immutable`);
    }
    if (before.status === after.status) continue;
    if (before.status === 'Draft' && after.status === 'Ratified') {
      changedToRatified.push(id);
    } else {
      errors.push(`${id}: unauthorized status transition ${before.status} -> ${after.status}`);
    }
  }

  const appendedDecisions = currentDecisions.slice(baselineDecisions.length);
  const coveredIds = appendedDecisions.flatMap((decision) => decision.principles ?? []);
  if (!arraysEqual(changedToRatified, coveredIds)) {
    errors.push(
      `principles/manifest.json: Draft-to-Ratified changes must exactly match newly appended decision IDs; changed [${changedToRatified.join(', ')}], covered [${coveredIds.join(', ')}]`,
    );
  }
  if (
    appendedDecisions.length > 0 &&
    baselineCommit &&
    appendedDecisions.some((decision) => decision.baseCommit !== baselineCommit)
  ) {
    errors.push(
      `principles/manifest.json: Ratification decision baseCommit must match event base ${baselineCommit}`,
    );
  }

  const decisionCoverage = new Map();
  for (const decision of currentDecisions) {
    for (const id of decision.principles ?? []) {
      decisionCoverage.set(id, (decisionCoverage.get(id) ?? 0) + 1);
    }
  }
  for (const [id, entry] of Object.entries(currentCatalog)) {
    if (entry.status !== 'Ratified') continue;
    const coverage = decisionCoverage.get(id) ?? 0;
    if (coverage !== 1) {
      errors.push(
        `${id}: Ratified status must be covered exactly once by owner Ratification decision history, found ${coverage}`,
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

/**
 * Git's object name for a blob: sha1 over the header plus the raw bytes. Verified against real
 * `gh api` responses -- this reproduces the `sha` GitHub reports for a contents fetch exactly.
 *
 * @param {Buffer} bytes
 * @returns {string}
 */
export function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
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

    // Decode the whole payload at once. `gh api` hard-wraps base64 at 60 characters and 60 % 4 == 0,
    // so each line is a complete base64 block -- which is exactly why decoding line by line looks
    // safe. It is not: 60 base64 chars carry 45 bytes, and 45 aligns to nothing in UTF-8, so any
    // multibyte character straddling a 45-byte boundary is destroyed in both halves. The property
    // that makes per-line decoding survive is ASCII-only *content*, not anything about the method,
    // which is why a probe run against an ASCII file reports it as lossless. Stripping all
    // whitespace first and decoding once is what makes this correct.
    const bytes = Buffer.from(resolved.content.replace(/\s/g, ''), 'base64');

    // Hash what we actually decoded. Both checks above compare a value GitHub reported against a
    // value we pinned; neither is derived from these bytes, so a corrupt or truncated decode would
    // pass them and then be scanned for headings. A hash over corrupted text is stable and
    // reproducible, so the wrong answer would look like a settled one. Skip the section checks when
    // this fails -- headings scanned out of damaged text produce misleading "no section" errors that
    // bury the real cause.
    const decodedSha = gitBlobSha(bytes);
    if (decodedSha !== resolved.sha) {
      errors.push(
        `${file}: decoded content does not hash to the returned blob ${resolved.sha} (got ${decodedSha}); the transfer was corrupted or truncated`,
      );
      continue;
    }

    const text = bytes.toString('utf8');
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

export function validateDecisionRecords(manifest, repoRoot, readText) {
  const errors = [];
  for (const decision of manifest.ratificationDecisions ?? []) {
    let actual;
    try {
      actual = readText(join(repoRoot, decision.recordPath));
    } catch (error) {
      errors.push(`${decision.recordPath}: cannot read Ratification decision record (${error.message})`);
      continue;
    }
    const expected = renderRatificationDecision(decision);
    if (normalizeText(actual) !== normalizeText(expected)) {
      errors.push(
        `${decision.recordPath}: Ratification decision record must exactly match manifest evidence and owner-merge approval wording`,
      );
    }
  }
  return errors;
}

export function validateRatificationSemanticBase(
  manifest,
  repoRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const errors = [];
  const loaded = new Map();
  const comparedDocuments = new Set();
  for (const decision of manifest.ratificationDecisions ?? []) {
    for (const id of decision.principles ?? []) {
      const entry = manifest.statusCatalog?.[id];
      if (!entry) continue;
      const key = `${decision.baseCommit}:${entry.path}`;
      if (!loaded.has(key)) {
        try {
          loaded.set(key, loadGitText(repoRoot, decision.baseCommit, entry.path));
        } catch (error) {
          errors.push(
            `${entry.path}: cannot read Ratification semantic base ${decision.baseCommit} (${error.message})`,
          );
          loaded.set(key, null);
        }
      }
      const baselineText = loaded.get(key);
      if (baselineText === null) continue;
      if (!comparedDocuments.has(key)) {
        comparedDocuments.add(key);
        let currentText;
        try {
          currentText = readText(join(repoRoot, entry.path));
        } catch (error) {
          errors.push(`${entry.path}: cannot read current Ratification document (${error.message})`);
          currentText = null;
        }
        if (
          currentText !== null &&
          normalizeRatificationStatus(currentText) !==
            normalizeRatificationStatus(baselineText)
        ) {
          errors.push(
            `${entry.path}: Ratification document must match semantic base ${decision.baseCommit} outside exact Status fields`,
          );
        }
      }
      const principle = parsePrinciples(baselineText).find((candidate) => candidate.id === id);
      if (!principle) {
        errors.push(`${entry.path}: Ratification semantic base has no ${id}`);
        continue;
      }
      const values = Object.fromEntries(
        REQUIRED_FIELDS.map((field) => [field, readFields(principle.body, field)[0] ?? '']),
      );
      const baselineHash = semanticContentHash({
        id,
        title: principle.title,
        values,
      });
      if (baselineHash !== entry.semanticContentSha256) {
        errors.push(
          `${entry.path} ${id}: semantic catalog must match Ratification base ${decision.baseCommit}; expected ${baselineHash}, found ${entry.semanticContentSha256}`,
        );
      }
    }
  }
  return errors;
}

export function semanticContentHash({ id, title, values }) {
  const semantic = {
    id,
    title,
    Statement: values.Statement,
    Rationale: values.Rationale,
    'Verification / evidence': values['Verification / evidence'],
    'Owner / ratification': values['Owner / ratification'],
    'Cross-authority handoff': values['Cross-authority handoff'],
    'Legacy inputs': values['Legacy inputs'],
  };
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}

export function renderRatificationDecision(decision) {
  const evidence89 = decision.finalReviewEvidence[0];
  const evidence92 = decision.finalReviewEvidence[1];
  const evidence97 = decision.finalReviewEvidence[2];
  return `# GitHub and AI principle owner Ratification

- **Decision:** Ratify the listed principles only when repository owner \`jrmoulckers\` merges the pull
  request containing this record after the required \`CI gate\` succeeds.
- **Current approval state:** ${decision.currentApprovalState.replace(
    'repository-owner approval before merge.',
    'repository-owner approval before\n  merge.',
  )}
- **Principles:** \`GH-REPO-001\`–\`GH-REPO-007\`, \`GH-ACT-001\`–\`GH-ACT-007\`,
  \`GH-AIP-001\`–\`GH-AIP-008\`, \`GH-AIOPS-001\`–\`GH-AIOPS-015\`, and
  \`GH-AIEVAL-001\`–\`GH-AIEVAL-006\`.
- **Source pull requests:** [#${decision.sourcePullRequests[0]}](https://github.com/jrmoulckers/.github/pull/${decision.sourcePullRequests[0]}) and
  [#${decision.sourcePullRequests[1]}](https://github.com/jrmoulckers/.github/pull/${decision.sourcePullRequests[1]}).
- **Final review evidence:** #89 ended at \`${evidence89.finalHeadCommit}\`
  with \`${evidence89.successfulChecks[0]}\` successful and owner merge
  \`${evidence89.mergeCommit}\`; #92 ended at
  \`${evidence92.finalHeadCommit}\` with \`${evidence92.successfulChecks[0]}\`,
  \`${evidence92.successfulChecks[1]}\`, and \`${evidence92.successfulChecks[2]}\` successful and owner merge
  \`${evidence92.mergeCommit}\`; #97 finalized \`GH-ACT-005\` at
  \`${evidence97.finalHeadCommit}\` with \`${evidence97.successfulChecks[0]}\`,
  \`${evidence97.successfulChecks[1]}\`, and \`${evidence97.successfulChecks[2]}\` successful and owner merge
  \`${evidence97.mergeCommit}\`.
- **Content and ownership:** IDs, statements, rationale, verification, owner / ratification wording,
  cross-authority handoffs, Legacy inputs, ordering, and paths are unchanged; only each listed
  \`Status\` changes from \`Draft\` to \`Ratified\`.
- **Effective approval:** The repository-owner merge event for the pull request containing this
  record is the Ratification act. Authorship, agent work, source-PR merges, checks, and this proposed
  record are evidence, not approval of this Ratification.
- **Required protection:** \`${decision.requiredProtection.branch}\` strictly requires \`${decision.requiredProtection.strictRequiredCheck}\`; force pushes and branch deletion are
  disabled. The required check must succeed on the final pull-request head before owner merge.
- **Non-goals:** This decision does not alter ADR-0003, authority boundaries, legacy evidence,
  migration history, agents, skills, prompts, instructions, sync behavior, or workflows.
`;
}

function validateManifest(manifest) {
  const errors = [];

  if (manifest.schemaVersion !== 2) {
    errors.push('principles/manifest.json: schemaVersion must be 2');
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

  const publishedEntries = Object.entries(manifest.published ?? {}).flatMap(
    ([path, ids]) => (Array.isArray(ids) ? ids.map((id) => [id, path]) : []),
  );
  const publishedIds = publishedEntries.map(([id]) => id);
  const catalog = manifest.statusCatalog;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    errors.push('principles/manifest.json: statusCatalog must be an object');
  } else if (!arraysEqual(Object.keys(catalog), publishedIds)) {
    errors.push(
      `principles/manifest.json: statusCatalog IDs must exactly match published order [${publishedIds.join(', ')}]`,
    );
  }
  for (const [id, path] of publishedEntries) {
    const entry = catalog?.[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${id}: status catalog entry is required`);
      continue;
    }
    if (entry.path !== path) {
      errors.push(`${id}: status catalog path must be ${path}`);
    }
    if (!['Draft', 'Ratified'].includes(entry.status)) {
      errors.push(`${id}: status catalog value must be Draft or Ratified`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.semanticContentSha256 ?? '')) {
      errors.push(`${id}: status catalog semanticContentSha256 must be a SHA-256 digest`);
    }
    if (
      !arraysEqual(
        Object.keys(entry),
        ['path', 'status', 'semanticContentSha256'],
      )
    ) {
      errors.push(`${id}: status catalog entry must contain only path, status, semanticContentSha256`);
    }
  }

  if (!Array.isArray(manifest.ratificationDecisions)) {
    errors.push('principles/manifest.json: ratificationDecisions must be an array');
  } else if (manifest.ratificationDecisions.length !== 1) {
    errors.push(
      'principles/manifest.json: must contain exactly one nonempty Ratification decision for the published corpus',
    );
  } else if (!jsonEqual(manifest.ratificationDecisions[0], EXPECTED_RATIFICATION_DECISION)) {
    errors.push(
      'principles/manifest.json: ratificationDecisions[0] must preserve the exact owner-only decision, source review evidence, event base, and CI gate protection',
    );
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

function draftCatalogFromPublished(published, currentCatalog) {
  return Object.fromEntries(
    Object.entries(published).flatMap(([path, ids]) =>
      ids.map((id) => [
        id,
        {
          path,
          status: 'Draft',
          semanticContentSha256: currentCatalog[id]?.semanticContentSha256,
        },
      ]),
    ),
  );
}

function normalizeText(value) {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

function normalizeRatificationStatus(value) {
  return normalizeText(value).replace(
    /^- \*\*Status:\*\* (?:Draft|Ratified)$/gm,
    '- **Status:** <excluded>',
  );
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
  const expected = mergeBase && mergeBase !== head ? mergeBase : previous;
  if (explicit) {
    if (!isNonzeroSha(explicit)) {
      throw new Error('PRINCIPLES_BASE_SHA must be a nonzero commit SHA');
    }
    if (!expected) {
      throw new Error('cannot verify PRINCIPLES_BASE_SHA against event baseline');
    }
    if (explicit !== expected) {
      throw new Error(
        `PRINCIPLES_BASE_SHA does not match event baseline; expected ${expected}, found ${explicit}`,
      );
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
      const uncommittedPrincipleChanges = execFileSync(
        'git',
        ['diff', '--name-only', 'HEAD', '--', 'principles'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      previous = uncommittedPrincipleChanges
        ? head
        : execFileSync(
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

function loadGitText(repoRoot, commit, relativePath) {
  return execFileSync(
    'git',
    ['show', `${commit}:${relativePath}`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
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
      `Validated ${result.principleCount} Ratified principles across ${result.fileCount} files.`,
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
