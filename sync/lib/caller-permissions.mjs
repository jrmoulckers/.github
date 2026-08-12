// Non-fatal observations for reusable-workflow caller permission ceilings.
//
// GitHub validates a called workflow's requested permissions before it creates any job. A caller
// that explicitly omits `packages: read` therefore gets only an opaque startup_failure: no job,
// check-run, or log exists to explain it. This scanner reports the mismatch before that run.
//
// The parser is deliberately dependency-free and conservative. Unsupported YAML is "unknown",
// never "safe" or a local integrity failure.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  listOpenPullRequests,
  readPullRequestWorkflowSources,
} from './git.mjs';
import { reusableWorkflowsDeclaringPermission } from './workflow-integrity.mjs';

const PACKAGES_WORKFLOWS = new Set(reusableWorkflowsDeclaringPermission('packages'));

export function inspectCallerPermissionCheckout(root, backbone) {
  const workflowsRoot = join(root, '.github', 'workflows');
  if (!existsSync(workflowsRoot)) {
    return { findings: [], unknown: [], inspected: 0 };
  }
  const sources = walkFiles(workflowsRoot)
    .filter((path) => /\.ya?ml$/i.test(path))
    .map((path) => ({
      path: relative(root, path).replaceAll('\\', '/'),
      text: readFileSync(path, 'utf8'),
    }));
  return inspectCallerPermissionSources(sources, backbone);
}

export function inspectCallerPermissionSources(sources, backbone) {
  const findings = [];
  const unknown = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    try {
      const result = inspectCallerPermissionSource(source.path, source.text, backbone);
      findings.push(...result.findings);
      unknown.push(...result.unknown);
    } catch (error) {
      unknown.push({
        path: source.path,
        line: 1,
        message: `could not inspect workflow file: ${error.message}`,
      });
    }
  }
  return { findings, unknown, inspected: sources.length };
}

export function inspectCallerPermissionSource(path, text, backbone) {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = maskScalarBodies(rawLines);
  const findings = [];
  const unknown = [];
  const jobsIndex = lines.findIndex((line) => stripYamlComment(line) === 'jobs:');
  if (jobsIndex === -1) {
    for (const target of findPackageWorkflowTargets(lines, backbone)) {
      unknown.push({
        path,
        line: target.line,
        message: `could not resolve the jobs mapping for ${target.workflow}`,
      });
    }
    return { findings, unknown, inspected: 1 };
  }
  const jobsBoundary = lines.findIndex(
    (line, index) =>
      index > jobsIndex &&
      line.trim() &&
      !line.trimStart().startsWith('#') &&
      line.match(/^ */)[0].length === 0,
  );
  const jobsEnd = jobsBoundary === -1 ? lines.length : jobsBoundary;

  const workflowPermission = parseWorkflowPermission(lines, jobsIndex, jobsEnd);
  const anchors = collectWorkflowUseAnchors(rawLines, backbone);
  const jobCandidates = [];
  for (let index = jobsIndex + 1; index < jobsEnd; index += 1) {
    const match = stripYamlComment(lines[index]).match(
      /^( +)(?:"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'|([A-Za-z_][A-Za-z0-9_-]*)):\s*$/,
    );
    if (match) {
      jobCandidates.push({
        index,
        indentation: match[1].length,
        name: match[2] ?? match[3] ?? match[4],
      });
    }
  }
  const jobIndentation = Math.min(...jobCandidates.map((job) => job.indentation));
  const starts = jobCandidates.filter((job) => job.indentation === jobIndentation);

  const parsedCallLines = new Set();
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.index ?? jobsEnd;
    const propertyIndentation = directChildIndentation(lines, start.index + 1, end, start.indentation);
    const use = parseJobUse(
      rawLines,
      start.index + 1,
      end,
      propertyIndentation,
      backbone,
      anchors,
    );
    if (!use || !PACKAGES_WORKFLOWS.has(use.workflow)) continue;
    parsedCallLines.add(use.targetLine);

    const jobPermission = parsePermission(lines, propertyIndentation, start.index + 1, end);
    const effective = jobPermission.state === 'absent' ? workflowPermission : jobPermission;
    const source =
      jobPermission.state === 'absent'
        ? workflowPermission.state === 'absent'
          ? 'repository default'
          : 'workflow'
        : 'job';
    const state = effective.state === 'absent' ? 'inherited' : effective.state;
    findings.push({
      path,
      line: use.line,
      job: start.name,
      affectedJobs: starts.map((job) => job.name),
      workflow: use.workflow,
      state,
      source,
      detail: effective.detail,
    });
  }

  const escapedBackbone = escapeRegExp(backbone);
  const anyTarget = new RegExp(
    `(?:^|[,{])\\s*["']?uses["']?\\s*:\\s*.*?` +
      `${escapedBackbone}/\\.github/workflows/([^/@\\s"'#},]+)\\.ya?ml@[^\\s"'#},]+`,
    'i',
  );
  for (let index = jobsIndex + 1; index < jobsEnd; index += 1) {
    const match = stripYamlComment(lines[index]).match(anyTarget);
    if (
      match &&
      PACKAGES_WORKFLOWS.has(match[1]) &&
      !parsedCallLines.has(index + 1)
    ) {
      unknown.push({
        path,
        line: index + 1,
        message: `could not resolve the caller job or effective permissions for ${match[1]}`,
      });
    }
  }

  return { findings, unknown, inspected: 1 };
}

export function observeCallerPermissions(
  { root, repo, backbone, token = '', includePullRequests = false, rootLabel = 'default branch' },
  adapters = {},
) {
  const inspectRoot = adapters.inspectRoot ?? inspectCallerPermissionCheckout;
  const listPullRequests = adapters.listPullRequests ?? listOpenPullRequests;
  const readPullRequestSources =
    adapters.readPullRequestSources ?? readPullRequestWorkflowSources;
  const refs = [];
  const unknown = [];

  try {
    refs.push({ label: rootLabel, ...inspectRoot(root, backbone) });
  } catch (error) {
    unknown.push({ label: rootLabel, message: error.message });
  }

  if (!includePullRequests) return { refs, unknown };

  let listing;
  try {
    listing = listPullRequests(repo, token);
  } catch (error) {
    unknown.push({ label: 'open pull requests', message: error.message });
    return { refs, unknown };
  }
  if (listing.truncated) {
    unknown.push({
      label: 'open pull requests',
      message: `more than ${listing.pullRequests.length} open pull requests; remaining heads were not inspected`,
    });
  }

  for (const pullRequest of listing.pullRequests) {
    const label = `PR #${pullRequest.number} (${pullRequest.headRefName})`;
    try {
      const sources = readPullRequestSources(root, pullRequest);
      refs.push({ label, ...inspectCallerPermissionSources(sources, backbone) });
    } catch (error) {
      unknown.push({ label, message: error.message });
    }
  }
  return { refs, unknown };
}

export function formatCallerPermissionWarnings(repo, observation) {
  const messages = [];
  for (const ref of observation?.refs ?? []) {
    for (const finding of ref.findings.filter((item) => item.state === 'unsafe')) {
      messages.push(
        `${repo} ${ref.label}: ${finding.path}:${finding.line} job ${finding.job} calls ` +
          `${finding.workflow} but its explicit ${finding.source} permission ceiling does not grant ` +
          '`packages: read`; the entire workflow run will fail at startup with no job or log',
      );
    }
    for (const finding of ref.findings.filter((item) => item.state === 'unknown')) {
      messages.push(
        `${repo} ${ref.label}: ${finding.path}:${finding.line} job ${finding.job} calls ` +
          `${finding.workflow}, but its effective permissions are unknown — ${finding.detail}`,
      );
    }
    for (const item of ref.unknown) {
      messages.push(
        `${repo} ${ref.label}: caller permissions unknown at ${item.path}:${item.line} — ${item.message}`,
      );
    }
  }
  for (const item of observation?.unknown ?? []) {
    messages.push(`${repo} ${item.label}: caller permission scan unavailable — ${item.message}`);
  }
  return messages;
}

export function callerPermissionLintReport(result) {
  const unsafe = result.findings.filter((finding) => finding.state === 'unsafe');
  const unresolved = [
    ...result.findings
      .filter((finding) => finding.state === 'unknown')
      .map((finding) => ({
        path: finding.path,
        line: finding.line,
        message:
          `job ${finding.job} calls ${finding.workflow}, but its effective permissions are unknown — ` +
          finding.detail,
      })),
    ...result.unknown,
  ];
  // A scan that read no workflow file produces no findings, which is byte-identical to a clean
  // result. This lint runs from a caller workflow file, so that file is always present in a
  // correct checkout: zero inspected files means the checkout or the scan root is wrong, never
  // that the repository is clean. Reporting it as unresolved keeps an absent measurement from
  // rendering in the schema of a passing one.
  if ((result.inspected ?? 0) === 0) {
    unresolved.push({
      path: '.github/workflows',
      line: 1,
      message:
        'no workflow file was inspected, so this lint measured nothing; the check runs from a ' +
        'caller workflow file, so an empty scan means the checkout or scan root is wrong rather ' +
        'than that no caller exists',
    });
  }
  const annotations = [
    ...unsafe.map((finding) => ({
      level: 'error',
      path: finding.path,
      line: finding.line,
      title: `Unsafe permission ceiling in job ${finding.job}`,
      message: unsafeFindingMessage(finding),
    })),
    ...unresolved.map((finding) => ({
      level: 'error',
      path: finding.path,
      line: finding.line,
      title: 'Caller permissions could not be verified',
      message: finding.message,
    })),
  ];
  const lines = ['### Caller permission lint', ''];

  if (!unsafe.length && !unresolved.length) {
    lines.push(
      `Inspected ${result.inspected} workflow file(s). All direct calls to canonical ` +
        'package-reading workflows have compatible caller permissions.',
      '',
      '**This passing check is the positive evidence for this commit.** A previously green run does ' +
        'not prove that a future reusable-workflow re-pin has a compatible permission ceiling.',
    );
  } else {
    lines.push(
      `${unsafe.length} unsafe caller job(s); ${unresolved.length} caller permission shape(s) could not be verified.`,
      '',
    );
    if (unsafe.length) {
      lines.push(
        '| Workflow file | Caller job | Canonical workflow | Blast radius |',
        '| --- | --- | --- | --- |',
      );
      for (const finding of unsafe) {
        const collateral = finding.affectedJobs.filter((job) => job !== finding.job);
        lines.push(
          `| \`${finding.path}\` | \`${finding.job}\` | \`${finding.workflow}\` | ` +
            `${finding.affectedJobs.length} total job(s); ` +
            (collateral.length
              ? `${collateral.length} other job(s) also die: ${collateral.map((job) => `\`${job}\``).join(', ')}`
              : 'no other jobs') +
            ' |',
        );
      }
      lines.push('');
    }
    if (unresolved.length) {
      lines.push('#### Could not verify', '');
      for (const finding of unresolved) {
        lines.push(`- \`${finding.path}:${finding.line}\` — ${finding.message}`);
      }
      lines.push('');
    }
    lines.push(
      'GitHub rejects the affected workflow file before creating any job, check run, or readable ' +
        'log. This lint runs from a separate workflow file so it can report the failure.',
    );
  }

  return {
    ok: annotations.length === 0,
    unsafe,
    unresolved,
    annotations,
    summary: `${lines.join('\n')}\n`,
  };
}

function unsafeFindingMessage(finding) {
  const collateral = finding.affectedJobs.filter((job) => job !== finding.job);
  const blastRadius = collateral.length
    ? `${collateral.length} other job(s) in ${finding.path} also never start: ${collateral.join(', ')}`
    : `this is the only job in ${finding.path}`;
  return (
    `job ${finding.job} calls ${finding.workflow}, but its explicit ${finding.source} permission ` +
    `ceiling does not grant packages: read; ${blastRadius}`
  );
}

function parseJobUse(lines, start, end, indentation, backbone, anchors) {
  if (indentation === null) return null;
  const escapedBackbone = escapeRegExp(backbone);
  const target = new RegExp(
    `^["']?${escapedBackbone}/\\.github/workflows/([^/@\\s"']+)\\.ya?ml@[^\\s"']+["']?$`,
    'i',
  );
  for (let index = start; index < end; index += 1) {
    const source = stripYamlComment(lines[index]);
    const match = source.match(
      new RegExp(`^ {${indentation}}["']?uses["']?\\s*:\\s*(.+?)\\s*$`),
    );
    if (!match) continue;
    let value = match[1].trim();
    let targetLine = index + 1;
    if (/^[>|][-+0-9]*$/.test(value)) {
      const continuation = scalarContinuation(lines, index, end, indentation);
      value = continuation.value;
      targetLine = continuation.line;
    }
    const alias = value.match(/^\*([A-Za-z][A-Za-z0-9_-]*)$/);
    if (alias) {
      const workflow = anchors.get(alias[1]);
      if (workflow) return { workflow, line: index + 1, targetLine };
      continue;
    }
    value = value.replace(/^&[A-Za-z][A-Za-z0-9_-]*\s+/, '');
    const parsed = value.match(target);
    if (parsed) return { workflow: parsed[1], line: index + 1, targetLine };
  }
  return null;
}

function collectWorkflowUseAnchors(lines, backbone) {
  const anchors = new Map();
  const escapedBackbone = escapeRegExp(backbone);
  const definition = new RegExp(
    `&([A-Za-z][A-Za-z0-9_-]*)\\s+["']?${escapedBackbone}/\\.github/workflows/` +
      `([^/@\\s"']+)\\.ya?ml@[^\\s"']+`,
    'i',
  );
  for (const line of lines) {
    const match = stripYamlComment(line).match(definition);
    if (match) anchors.set(match[1], match[2]);
  }
  return anchors;
}

function findPackageWorkflowTargets(lines, backbone) {
  const escapedBackbone = escapeRegExp(backbone);
  const target = new RegExp(
    `(?:^|[,{])\\s*["']?uses["']?\\s*:\\s*.*?` +
      `${escapedBackbone}/\\.github/workflows/([^/@\\s"'#},]+)\\.ya?ml@[^\\s"'#},]+`,
    'i',
  );
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const match = stripYamlComment(line).match(target);
    if (match && PACKAGES_WORKFLOWS.has(match[1])) {
      matches.push({ line: index + 1, workflow: match[1] });
    }
  }
  return matches;
}

function parseWorkflowPermission(lines, jobsIndex, jobsEnd) {
  const beforeJobs = parsePermission(lines, 0, 0, jobsIndex);
  if (beforeJobs.state !== 'absent') return beforeJobs;
  return parsePermission(lines, 0, jobsEnd, lines.length);
}

function parsePermission(lines, indentation, start, end) {
  if (indentation === null) return { state: 'absent', detail: '' };
  for (let index = start; index < end; index += 1) {
    const source = stripYamlComment(lines[index]);
    const match = source.match(
      new RegExp(`^ {${indentation}}["']?permissions["']?\\s*:\\s*(.*?)\\s*$`),
    );
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) return parseInlinePermission(inline);

    const values = new Map();
    let sawChild = false;
    let mappingIndentation = null;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const child = stripYamlComment(lines[cursor]);
      if (!child.trim()) continue;
      const childIndentation = child.match(/^ */)[0].length;
      if (childIndentation <= indentation) break;
      mappingIndentation ??= childIndentation;
      const item = child.match(
        new RegExp(`^ {${mappingIndentation}}["']?([A-Za-z-]+)["']?\\s*:\\s*([^\\s#]+)\\s*$`),
      );
      if (!item || childIndentation !== mappingIndentation) {
        return { state: 'unknown', detail: 'unsupported permissions mapping' };
      }
      sawChild = true;
      values.set(item[1], unquote(item[2]));
    }
    if (!sawChild) return { state: 'unknown', detail: 'empty permissions value' };
    return permissionMapState(values);
  }
  return { state: 'absent', detail: '' };
}

function directChildIndentation(lines, start, end, parentIndentation) {
  let indentation = null;
  for (let index = start; index < end; index += 1) {
    const line = stripYamlComment(lines[index]);
    if (!line.trim()) continue;
    const candidate = line.match(/^ */)[0].length;
    if (candidate > parentIndentation && (indentation === null || candidate < indentation)) {
      indentation = candidate;
    }
  }
  return indentation;
}

function parseInlinePermission(value) {
  const scalar = unquote(value);
  if (scalar === 'read-all' || scalar === 'write-all') {
    return { state: 'safe', detail: scalar };
  }
  if (scalar === '{}') return { state: 'unsafe', detail: '{}' };
  if (!scalar.startsWith('{') || !scalar.endsWith('}') || scalar.includes('${{')) {
    return { state: 'unknown', detail: `unsupported permissions value ${JSON.stringify(scalar)}` };
  }
  const body = scalar.slice(1, -1).trim();
  if (!body) return { state: 'unsafe', detail: '{}' };
  const values = new Map();
  for (const entry of body.split(',')) {
    const match = entry.trim().match(/^["']?([A-Za-z-]+)["']?\s*:\s*["']?([A-Za-z-]+)["']?$/);
    if (!match) return { state: 'unknown', detail: 'unsupported flow permissions mapping' };
    values.set(match[1], match[2]);
  }
  return permissionMapState(values);
}

function permissionMapState(values) {
  const packages = values.get('packages');
  if (packages === 'read' || packages === 'write') {
    return { state: 'safe', detail: `packages: ${packages}` };
  }
  return {
    state: 'unsafe',
    detail: packages ? `packages: ${packages}` : 'packages omitted',
  };
}

function maskScalarBodies(lines) {
  const masked = [...lines];
  let scalarIndentation = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indentation = line.match(/^ */)[0].length;
    if (scalarIndentation !== null) {
      if (!line.trim() || indentation > scalarIndentation) {
        masked[index] = '';
        continue;
      }
      scalarIndentation = null;
    }
    if (/:\s*[>|][-+0-9]*\s*$/.test(stripYamlComment(line))) {
      scalarIndentation = indentation;
    }
  }
  return masked;
}

function scalarContinuation(lines, index, end, indentation) {
  const values = [];
  let line = index + 1;
  for (let cursor = index + 1; cursor < end; cursor += 1) {
    const candidate = lines[cursor];
    if (candidate.trim() && candidate.match(/^ */)[0].length <= indentation) break;
    if (candidate.trim()) {
      if (!values.length) line = cursor + 1;
      values.push(stripYamlComment(candidate).trim());
    }
  }
  return { value: values.join(' '), line };
}

function stripYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && line[index + 1] === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted && line[index - 1] !== '\\') {
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character === '#' && !singleQuoted && !doubleQuoted) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
