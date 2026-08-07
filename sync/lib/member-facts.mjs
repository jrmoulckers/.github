// Derive registry claims from an existing member checkout. Real sync/check runs already own this
// checkout, so verification adds no network operation; offline tests supply synthetic trees.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { memberMode } from './manifest.mjs';

const PACKAGE_LOCKS = new Map([
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]);

export function deriveMemberFacts(root, backbone) {
  return {
    framework: deriveFramework(root),
    packageManager: derivePackageManager(root),
    workflows: deriveCalledWorkflows(root, backbone),
  };
}

export function inspectMemberFacts(root, backbone) {
  return {
    framework: inspectFramework(root),
    packageManager: inspectPackageManager(root),
    workflows: deriveCalledWorkflows(root, backbone),
  };
}

export function assertMemberFacts(root, member, backbone) {
  const mode = memberMode(member);
  const actual =
    mode === 'application'
      ? deriveMemberFacts(root, backbone)
      : inspectMemberFacts(root, backbone);
  const errors = [];

  if (mode === 'application') {
    compareScalar(errors, 'framework', member.framework, actual.framework);
    compareScalar(errors, 'packageManager', member.packageManager, actual.packageManager);
  } else if (mode === 'infrastructure') {
    compareOptionalScalar(errors, 'framework', member.framework, actual.framework);
    compareOptionalScalar(errors, 'packageManager', member.packageManager, actual.packageManager);
  } else {
    rejectBootstrappedEvidence(errors, actual);
  }

  const claimed = new Set(
    member.groups?.find((group) => group.kind === 'workflows')?.names ?? [],
  );
  const missing = actual.workflows.value.filter((name) => !claimed.has(name));
  if (missing.length) {
    errors.push(
      `optIn.workflows does not list checkout call${missing.length === 1 ? '' : 's'} ` +
        `${missing.map(quote).join(', ')} (${actual.workflows.evidence})`,
    );
  }

  if (errors.length) {
    throw new Error(
      `${member.repo}: studio.config.json claims do not match the member checkout:\n` +
        errors.map((error) => `  - ${error}`).join('\n'),
    );
  }

  return actual;
}

export function derivePackageManager(root) {
  const match = inspectPackageManager(root);
  if (!match) {
    throw new Error(
      'cannot derive packageManager: no root package-lock.json, pnpm-lock.yaml, yarn.lock, ' +
        'bun.lock, or bun.lockb',
    );
  }
  return match;
}

export function inspectPackageManager(root) {
  const matches = [...PACKAGE_LOCKS]
    .filter(([file]) => existsSync(join(root, file)))
    .map(([file, value]) => ({ file, value }));

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `cannot derive packageManager: conflicting root lockfiles ${matches.map((m) => m.file).join(', ')}`,
    );
  }
  return { value: matches[0].value, evidence: matches[0].file };
}

export function deriveFramework(root) {
  const match = inspectFramework(root);
  if (!match) throw new Error('cannot derive framework: no supported framework signature found');
  return match;
}

export function inspectFramework(root) {
  const candidates = [];
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    const pkg = readJson(packagePath);
    const dependencies = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    if ('next' in dependencies) {
      candidates.push({ value: 'nextjs', evidence: 'package.json dependency "next"' });
    }
    if ('svelte' in dependencies || Object.keys(dependencies).some((name) => name.startsWith('@sveltejs/'))) {
      candidates.push({ value: 'svelte', evidence: 'package.json Svelte dependency' });
    }
  }

  const gradleBuildPath = join(root, 'build.gradle.kts');
  const gradleBuild = existsSync(gradleBuildPath) ? readFileSync(gradleBuildPath, 'utf8') : '';
  if (
    existsSync(join(root, 'gradlew')) &&
    existsSync(join(root, 'settings.gradle.kts')) &&
    existsSync(join(root, 'apps', 'web', 'package.json')) &&
    /(?:org\.jetbrains\.kotlin\.multiplatform|kotlin\.multiplatform)/.test(gradleBuild)
  ) {
    candidates.push({
      value: 'kmp-web',
      evidence: 'Kotlin Multiplatform build.gradle.kts + Gradle wrapper + apps/web/package.json',
    });
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      `cannot derive framework: conflicting signatures ${candidates
        .map((candidate) => `${quote(candidate.value)} (${candidate.evidence})`)
        .join(', ')}`,
    );
  }
  return candidates[0];
}

export function deriveCalledWorkflows(root, backbone) {
  const workflowsRoot = join(root, '.github', 'workflows');
  if (!existsSync(workflowsRoot)) {
    return { value: [], evidence: 'no .github/workflows directory' };
  }

  const escapedBackbone = escapeRegExp(backbone);
  const call = new RegExp(
    `^\\s*(?:-\\s*)?uses:\\s*["']?${escapedBackbone}/\\.github/workflows/` +
      `([^/@\\s"']+)\\.ya?ml@[^\\s"'#]+`,
    'gim',
  );
  const names = new Set();
  const files = walkFiles(workflowsRoot).filter((path) => /\.ya?ml$/i.test(path));

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(call)) names.add(match[1]);
  }

  return {
    value: [...names].sort(),
    evidence: `${files.length} workflow file${files.length === 1 ? '' : 's'} under .github/workflows`,
  };
}

function compareScalar(errors, field, claimed, actual) {
  if (claimed !== actual.value) {
    errors.push(
      `${field} claims ${quote(claimed)} but checkout derives ${quote(actual.value)} ` +
        `from ${actual.evidence}`,
    );
  }
}

function compareOptionalScalar(errors, field, claimed, actual) {
  if (claimed === undefined && actual) {
    errors.push(
      `${field} is omitted in infrastructure mode but checkout derives ${quote(actual.value)} ` +
        `from ${actual.evidence}; declare the fact or change mode`,
    );
    return;
  }
  if (claimed !== undefined && !actual) {
    const evidence =
      field === 'framework'
        ? 'no supported framework signature'
        : 'no supported root package-manager lockfile';
    errors.push(`${field} claims ${quote(claimed)} but checkout has ${evidence}`);
    return;
  }
  if (claimed !== undefined) compareScalar(errors, field, claimed, actual);
}

function rejectBootstrappedEvidence(errors, actual) {
  const found = [
    actual.framework
      ? `framework ${quote(actual.framework.value)} from ${actual.framework.evidence}`
      : null,
    actual.packageManager
      ? `packageManager ${quote(actual.packageManager.value)} from ${actual.packageManager.evidence}`
      : null,
  ].filter(Boolean);
  if (!found.length) return;

  errors.push(
    `pre-bootstrap mode is no longer valid: checkout derives ${found.join(' and ')}; ` +
      'upgrade mode and declared facts before syncing (use "application" when both application ' +
      'facts exist, otherwise use "infrastructure" and declare each fact that applies)',
  );
}

function walkFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot derive framework: ${path} is not valid JSON: ${error.message}`);
  }
}

function quote(value) {
  return JSON.stringify(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
