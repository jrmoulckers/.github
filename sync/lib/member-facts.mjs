// Derive registry claims from an existing member checkout. Real sync/check runs already own this
// checkout, so verification adds no network operation; offline tests supply synthetic trees.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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
    workflowUses: deriveCalledWorkflows(root, backbone),
  };
}

export function inspectMemberFacts(root, backbone) {
  return {
    framework: inspectFramework(root),
    packageManager: inspectPackageManager(root),
    workflowUses: deriveCalledWorkflows(root, backbone),
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

  const available = [
    ...(member.groups?.find((group) => group.kind === 'workflows')?.names ?? []),
  ].sort();
  const claimed = new Set(available);
  const undeclaredUses = actual.workflowUses.uses.filter((use) => !claimed.has(use.name));
  const mutableUses = actual.workflowUses.uses.filter((use) => !/^[0-9a-f]{40}$/.test(use.ref));
  const unusedDeclarations = available.filter(
    (name) => !actual.workflowUses.value.includes(name),
  );
  if (undeclaredUses.length) {
    errors.push(
      `workflow availability does not declare checkout use${undeclaredUses.length === 1 ? '' : 's'} ` +
        `${undeclaredUses.map((use) => `${quote(use.name)} at ${use.path}:${use.line}`).join(', ')} ` +
        `(${actual.workflowUses.evidence})`,
    );
  }
  for (const use of mutableUses) {
    errors.push(
      `workflow use ${quote(use.name)} at ${use.path}:${use.line} pins ${quote(use.ref)}; ` +
        'backbone workflow calls must use a full 40-character commit SHA',
    );
  }

  if (errors.length) {
    throw new Error(
      `${member.repo}: studio.config.json claims do not match the member checkout:\n` +
        errors.map((error) => `  - ${error}`).join('\n'),
    );
  }

  return {
    ...actual,
    workflowAvailability: {
      value: available,
      evidence: 'studio.config.json optIn.workflows availability declaration',
    },
    workflowObservations: {
      unusedDeclarations,
      undeclaredUses,
    },
  };
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
    return { value: [], uses: [], evidence: 'no .github/workflows directory' };
  }

  const escapedBackbone = escapeRegExp(backbone);
  const target =
    `${escapedBackbone}/\\.github/workflows/` +
    `([^/@\\s"'}]+)\\.ya?ml@([^\\s"'#},]+)`;
  const directUse = new RegExp(
    `(?:^|[,{])\\s*(?:-\\s*)?["']?uses["']?\\s*:\\s*(?:!!str\\s+)?` +
      `(?:&([A-Za-z][A-Za-z0-9_-]*)\\s+)?["']?${target}`,
    'gi',
  );
  const anchorDefinition = new RegExp(
    `&([A-Za-z][A-Za-z0-9_-]*)\\s+(?:!!str\\s+)?["']?${target}`,
    'gi',
  );
  const aliasUse =
    /(?:^|[,{])\s*(?:-\s*)?["']?uses["']?\s*:\s*\*([A-Za-z][A-Za-z0-9_-]*)/gi;
  const blockUse =
    /(?:^|[,{])\s*(?:-\s*)?["']?uses["']?\s*:\s*(?:!!str\s+)?[>|][-+0-9]*\s*$/i;
  const blockTarget = new RegExp(`^["']?${target}["']?$`, 'i');
  const uses = [];
  const files = walkFiles(workflowsRoot).filter((path) => /\.ya?ml$/i.test(path));

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    const relativePath = relative(root, file).replaceAll('\\', '/');
    const lines = contents.split(/\r?\n/);
    const yamlLines = maskNonUsesScalarBodies(lines);
    const anchors = new Map();
    for (const line of yamlLines) {
      const source = stripYamlComment(line);
      for (const match of source.matchAll(anchorDefinition)) {
        anchors.set(match[1], { name: match[2], ref: match[3] });
      }
    }
    for (const [index, line] of yamlLines.entries()) {
      const source = stripYamlComment(line);
      for (const match of source.matchAll(directUse)) {
        uses.push({
          name: match[2],
          ref: match[3],
          path: relativePath,
          line: index + 1,
        });
      }
      for (const match of source.matchAll(aliasUse)) {
        const targetUse = anchors.get(match[1]);
        if (!targetUse) continue;
        uses.push({
          ...targetUse,
          path: relativePath,
          line: index + 1,
        });
      }
      if (blockUse.test(source)) {
        const indentation = line.match(/^ */)[0].length;
        const values = [];
        let cursor = index + 1;
        while (cursor < lines.length) {
          const candidate = lines[cursor];
          const candidateIndentation = candidate.match(/^ */)[0].length;
          if (candidate.trim() && candidateIndentation <= indentation) break;
          if (candidate.trim()) values.push(stripYamlComment(candidate).trim());
          cursor += 1;
        }
        const match = values.join(' ').match(blockTarget);
        if (match) {
          uses.push({
            name: match[1],
            ref: match[2],
            path: relativePath,
            line: index + 1,
          });
        }
      }
    }
  }
  const uniqueUses = [
    ...new Map(
      uses.map((use) => [`${use.path}\0${use.line}\0${use.name}\0${use.ref}`, use]),
    ).values(),
  ];
  uniqueUses.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.name.localeCompare(b.name) ||
      a.ref.localeCompare(b.ref),
  );

  return {
    value: [...new Set(uniqueUses.map((use) => use.name))].sort(),
    uses: uniqueUses,
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
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
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

function stripYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
    if (character === '"' && !singleQuoted && line[index - 1] !== '\\') {
      doubleQuoted = !doubleQuoted;
    }

    if (character === '#' && !singleQuoted && !doubleQuoted) {
      return line.slice(0, index);
    }
  }
  return line;
}

function maskNonUsesScalarBodies(lines) {
  const masked = [...lines];
  let scalarIndentation = null;
  for (const [index, line] of lines.entries()) {
    const indentation = line.match(/^ */)[0].length;
    if (scalarIndentation !== null) {
      if (!line.trim() || indentation > scalarIndentation) {
        masked[index] = '';
        continue;
      }
      scalarIndentation = null;
    }
    const source = stripYamlComment(line);
    if (
      /:\s*[>|][-+0-9]*\s*$/.test(source) &&
      !/(?:^|[,{])\s*(?:-\s*)?["']?uses["']?\s*:/.test(source)
    ) {
      scalarIndentation = indentation;
    }
  }
  return masked;
}
