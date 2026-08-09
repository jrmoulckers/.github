// Zero-dependency integrity validation for canonical GitHub Actions workflows.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FULL_SHA = /^[0-9a-f]{40}$/;
const USE_VALUE =
  /(?:^|[,{])\s*(?:-\s*)?["']?uses["']?\s*:\s*["']?([^"'#\s},]+)["']?/gi;
const PERMISSION_CEILINGS = new Map([
  ['ci.yml', new Map([
    ['principle-tests', new Map([['contents', 'read']])],
    ['sync-tests', new Map([['contents', 'read']])],
    ['ci-gate', new Map()],
  ])],
  ['studio-sync.yml', new Map([['sync', new Map([['contents', 'read']])]])],
  ['reusable-change-detection.yml', new Map([['detect', new Map([['contents', 'read']])]])],
  ['reusable-ci-lint.yml', new Map([
    ['lint', new Map([['contents', 'read'], ['packages', 'read']])],
    ['pr-title', new Map([['pull-requests', 'read']])],
  ])],
  ['reusable-ci-web.yml', new Map([
    ['web', new Map([['contents', 'read'], ['packages', 'read']])],
  ])],
  ['reusable-deploy-pages.yml', new Map([
    ['build', new Map([['contents', 'read'], ['packages', 'read']])],
    ['deploy', new Map([['pages', 'write'], ['id-token', 'write']])],
  ])],
  ['reusable-deploy-preview.yml', new Map([
    ['preview', new Map([['contents', 'read'], ['packages', 'read']])],
  ])],
  ['reusable-perf-budget.yml', new Map([
    ['performance', new Map([['contents', 'read'], ['packages', 'read']])],
  ])],
  ['reusable-security-ci.yml', new Map([
    ['package-audit', new Map([['contents', 'read']])],
    ['secret-scan', new Map([['contents', 'read']])],
    ['dependency-review', new Map([['contents', 'read']])],
  ])],
  ['reusable-smoke-test.yml', new Map([
    ['smoke', new Map([['contents', 'read'], ['packages', 'read']])],
    ['summary', new Map()],
  ])],
]);

// The only credential a canonical reusable workflow may accept. It is a registry read token
// consumed by npm and pnpm during install; nothing else may enter through workflow_call.
const ALLOWED_CALL_SECRETS = new Set(['NODE_AUTH_TOKEN']);

export function validateWorkflowIntegrity(repoRoot, manifest) {
  const errors = [];
  const workflowDir = join(repoRoot, '.github', 'workflows');
  const files = readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  const reusableFiles = files.filter((name) => /^reusable-.*\.yml$/.test(name));
  const declared = [...(manifest?.canon?.workflows ?? [])].sort();
  const onDisk = reusableFiles.map((name) => name.slice(0, -'.yml'.length)).sort();

  for (const name of duplicates(declared)) {
    errors.push(`studio.config.json: canon.workflows contains duplicate "${name}"`);
  }
  for (const name of declared) {
    if (!onDisk.includes(name)) {
      errors.push(`studio.config.json: canon.workflows "${name}" has no reusable workflow file`);
    }
  }
  for (const name of onDisk) {
    if (!declared.includes(name)) {
      errors.push(`.github/workflows/${name}.yml is not declared in canon.workflows`);
    }
  }

  const sources = new Map();
  for (const fileName of files) {
    const relativePath = `.github/workflows/${fileName}`;
    const text = readFileSync(join(workflowDir, fileName), 'utf8').replace(/\r\n?/g, '\n');
    sources.set(fileName, text);
    errors.push(
      ...inspectWorkflowSource(relativePath, text, {
        reusable: reusableFiles.includes(fileName),
      }),
    );
  }

  validateArtifactContracts(sources, errors);
  validatePagesAuthority(sources.get('reusable-deploy-pages.yml'), errors);
  validateSecurityContract(sources.get('reusable-security-ci.yml'), errors);
  validateChangeDetectionContract(sources.get('reusable-change-detection.yml'), errors);

  if (errors.length) {
    throw new Error(`Invalid canonical workflows:\n  - ${errors.join('\n  - ')}`);
  }

  return { files, reusableFiles };
}

export function inspectWorkflowSource(relativePath, text, { reusable = false } = {}) {
  const errors = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  if (text.includes('\t')) errors.push(`${relativePath}: tab indentation is not allowed`);
  errors.push(...inspectYamlSurface(relativePath, lines));
  if (!/^name:\s*\S/m.test(text)) errors.push(`${relativePath}: requires a workflow name`);
  if (!/^on:\s*$/m.test(text)) errors.push(`${relativePath}: requires an on block`);
  if (!/^jobs:\s*$/m.test(text)) errors.push(`${relativePath}: requires a jobs block`);
  if (/^\s*pull_request_target\s*:/m.test(text)) {
    errors.push(`${relativePath}: pull_request_target is forbidden`);
  }
  if (/^\s*secrets:\s*inherit\s*$/m.test(text)) {
    errors.push(`${relativePath}: secrets inheritance is forbidden`);
  }
  if (/^\s*(?:version|image):\s*["']?(?:latest|main)["']?\s*$/im.test(text)) {
    errors.push(`${relativePath}: mutable tool versions are forbidden`);
  }
  if (/(?:npx|pnpm\s+dlx)\s+[^\s]+@(?:latest|\*)\b/i.test(executableShell(text))) {
    errors.push(`${relativePath}: mutable package runner specifications are forbidden`);
  }

  for (const use of extractUses(lines)) {
    const target = use.target;
    if (target.startsWith('./')) continue;
    if (target.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/.test(target)) {
        errors.push(`${relativePath}:${use.line}: container actions must pin an image digest`);
      }
      continue;
    }
    const at = target.lastIndexOf('@');
    const ref = at === -1 ? '' : target.slice(at + 1);
    if (!FULL_SHA.test(ref)) {
      errors.push(`${relativePath}:${use.line}: remote uses must pin a full commit SHA`);
    }
    if (!use.comment || !/\bv?[0-9]+(?:\.[0-9]+){1,3}\b/.test(use.comment)) {
      errors.push(`${relativePath}:${use.line}: pinned actions require a version update comment`);
    }
  }

  for (const [index, line] of lines.entries()) {
    if (!/uses:\s*actions\/checkout@/.test(line)) continue;
    const following = lines.slice(index + 1, index + 12).join('\n');
    if (!/^\s+persist-credentials:\s*false\s*$/m.test(following)) {
      errors.push(`${relativePath}:${index + 1}: checkout must set persist-credentials: false`);
    }
  }
  for (const [index, line] of lines.entries()) {
    if (line.includes('!= *"/../"*') && !line.includes('!= ".."')) {
      errors.push(
        `${relativePath}:${index + 1}: path validation must reject an exact parent segment`,
      );
    }
  }

  for (const block of shellBlocks(lines)) {
    if (block.text.includes('${{')) {
      errors.push(
        `${relativePath}:${block.line}: GitHub expressions must reach shell through env, not source interpolation`,
      );
    }
  }

  const jobBlocks = extractJobBlocks(lines);
  const fileName = relativePath.split('/').at(-1);
  const permissionCeilings = PERMISSION_CEILINGS.get(fileName);
  if (jobBlocks.length === 0) errors.push(`${relativePath}: requires at least one job`);
  for (const block of jobBlocks) {
    if (!/^\s{4}timeout-minutes:\s*[1-9][0-9]*\s*$/m.test(block.text)) {
      errors.push(`${relativePath}: job "${block.name}" requires a bounded timeout-minutes`);
    }
    if (!/^\s{4}permissions:\s*(?:\{\}|$)/m.test(block.text)) {
      errors.push(`${relativePath}: job "${block.name}" requires explicit permissions`);
    }
    const expectedPermissions = permissionCeilings?.get(block.name);
    const actualPermissions = new Map(
      [...block.text.matchAll(/^\s{6}([a-z-]+):\s*(read|write)\s*$/gm)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    if (!expectedPermissions) {
      errors.push(`${relativePath}: job "${block.name}" has no declared permission ceiling`);
    } else {
      for (const [scope, level] of actualPermissions) {
        if (expectedPermissions.get(scope) !== level) {
          errors.push(
            `${relativePath}: job "${block.name}" exceeds its permission ceiling with ${scope}: ${level}`,
          );
        }
      }
      for (const [scope, level] of expectedPermissions) {
        if (actualPermissions.get(scope) !== level) {
          errors.push(
            `${relativePath}: job "${block.name}" must declare ${scope}: ${level}`,
          );
        }
      }
      if (actualPermissions.size !== expectedPermissions.size) {
        errors.push(
          `${relativePath}: job "${block.name}" permission set must match its ceiling exactly`,
        );
      }
    }
  }

  if (!/^permissions:\s*\{\}\s*$/m.test(text)) {
    errors.push(`${relativePath}: workflows must default permissions to none`);
  }
  if (reusable) {
    if (!/^\s{2}workflow_call:\s*$/m.test(text)) {
      errors.push(`${relativePath}: reusable workflows require workflow_call`);
    }
    for (const name of extractCallSecrets(lines)) {
      if (!ALLOWED_CALL_SECRETS.has(name)) {
        errors.push(`${relativePath}: workflow_call secret "${name}" is outside the allowed contract`);
      }
    }
    const ownsDeploymentConcurrency = fileName === 'reusable-deploy-pages.yml';
    if (ownsDeploymentConcurrency) {
      if (
        !/^concurrency:\s*$/m.test(text) ||
        !/^\s{2}group:\s*pages-\$\{\{\s*github\.repository\s*\}\}\s*$/m.test(text) ||
        !/^\s{2}cancel-in-progress:\s*false\s*$/m.test(text)
      ) {
        errors.push(`${relativePath}: Pages deployment requires non-cancelling repository concurrency`);
      }
    } else if (/^concurrency:\s*$/m.test(text)) {
      errors.push(
        `${relativePath}: non-deployment reusable workflows leave concurrency to the caller to avoid cancelling sibling calls`,
      );
    }
  }

  return errors;
}

function validateArtifactContracts(sources, errors) {
  const web = sources.get('reusable-ci-web.yml') ?? '';
  for (const pattern of [
    /artifact-name:/,
    /artifact-path:/,
    /artifact-retention-days:/,
    /uses:\s*actions\/upload-artifact@[0-9a-f]{40}/,
    /name:\s*Verify artifact path/,
  ]) {
    if (!pattern.test(web)) errors.push('reusable-ci-web.yml: incomplete build-artifact producer contract');
  }
  if (!/^\s{6}artifact-name:\s*\$\{\{\s*inputs\.artifact-name\s*\}\}\s*$/m.test(web)) {
    errors.push('reusable-ci-web.yml: artifact-name output must map the validated input directly');
  }
  if (!/artifact path must not contain symbolic links/.test(web)) {
    errors.push('reusable-ci-web.yml: artifact producer must reject symbolic links');
  }

  const consumers = new Map([
    ['reusable-deploy-preview.yml', /name:\s*Verify preview artifact/],
    ['reusable-perf-budget.yml', /name:\s*Verify build artifact/],
    ['reusable-smoke-test.yml', /name:\s*Verify downloaded artifact/],
  ]);
  for (const [fileName, verification] of consumers) {
    const text = sources.get(fileName) ?? '';
    if (
      !/artifact-name:/.test(text) ||
      !/uses:\s*actions\/download-artifact@[0-9a-f]{40}/.test(text) ||
      !verification.test(text) ||
      !/must not traverse parent directories/.test(text) ||
      !/must not contain symbolic links/.test(text)
    ) {
      errors.push(`${fileName}: incomplete same-run artifact consumer contract`);
    }
  }

  const preview = sources.get('reusable-deploy-preview.yml') ?? '';
  if (
    /^\s{6}(?:provider|preview-command):/m.test(preview) ||
    /^\s{6}DEPLOY_TOKEN:/m.test(preview)
  ) {
    errors.push('reusable-deploy-preview.yml: arbitrary provider commands and deploy secrets are forbidden');
  }
  if (
    !/standalone-artifact-prefix:/.test(preview) ||
    !/cat \/proc\/sys\/kernel\/random\/uuid/.test(preview)
  ) {
    errors.push('reusable-deploy-preview.yml: standalone artifact names must be collision-safe');
  }

  const performance = sources.get('reusable-perf-budget.yml') ?? '';
  if (
    !/lighthouse-public-upload:[\s\S]{0,220}?default:\s*false/.test(performance) ||
    /temporary-public-storage/.test(executableShell(performance)) ||
    /temporaryPublicStorage:\s*true/.test(performance)
  ) {
    errors.push('reusable-perf-budget.yml: Lighthouse public storage must default off');
  }
  if (
    !/lighthouse-artifact-prefix:/.test(performance) ||
    !/artifactName:\s*\$\{\{\s*steps\.lighthouse\.outputs\.name\s*\}\}/.test(performance)
  ) {
    errors.push('reusable-perf-budget.yml: Lighthouse artifact names must be collision-safe');
  }
}

function validatePagesAuthority(text = '', errors) {
  const relativePath = '.github/workflows/reusable-deploy-pages.yml';
  const jobs = new Map(extractJobBlocks(text.split('\n')).map((block) => [block.name, block.text]));
  const build = jobs.get('build') ?? '';
  const deploy = jobs.get('deploy') ?? '';

  if (
    !/^\s{4}permissions:\s*$[\s\S]*?^\s{6}contents:\s*read\s*$/m.test(build) ||
    /^\s{6}(?:pages|id-token):\s*write\s*$/m.test(build)
  ) {
    errors.push(`${relativePath}: build job must have contents read only`);
  }
  if (
    !/^\s{6}pages:\s*write\s*$/m.test(deploy) ||
    !/^\s{6}id-token:\s*write\s*$/m.test(deploy) ||
    !/^\s{4}environment:\s*$/m.test(deploy) ||
    !/^\s{6}name:\s*github-pages\s*$/m.test(deploy) ||
    !/uses:\s*actions\/deploy-pages@[0-9a-f]{40}/.test(deploy)
  ) {
    errors.push(`${relativePath}: deploy job requires isolated Pages authority and environment gating`);
  }
  if (/uses:\s*actions\/checkout@/.test(deploy) || /^\s+run:/m.test(deploy)) {
    errors.push(`${relativePath}: deploy job must not checkout or execute caller code`);
  }
  if (!/uses:\s*actions\/upload-pages-artifact@[0-9a-f]{40}/.test(build)) {
    errors.push(`${relativePath}: build job must hand off the fixed Pages artifact`);
  }
}

function validateSecurityContract(text = '', errors) {
  if (
    !/ghcr\.io\/trufflesecurity\/trufflehog@sha256:[0-9a-f]{64}\s+#\s+v3\.96\.0/.test(text) ||
    !/docker run --rm --cap-drop=ALL --security-opt=no-new-privileges/.test(text) ||
    !/--fail-on-scan-errors/.test(text) ||
    !/uses:\s*actions\/dependency-review-action@[0-9a-f]{40}/.test(text) ||
    !/audit-command:/.test(text) ||
    /^\s{4}secrets:\s*$/m.test(text)
  ) {
    errors.push('reusable-security-ci.yml: incomplete secret, dependency, or package audit contract');
  }
}

function validateChangeDetectionContract(text = '', errors) {
  if (
    !/path-groups-json:/.test(text) ||
    !/changed-groups-json:/.test(text) ||
    !/spawnSync\(\s*'git'/.test(text) ||
    !/shell:\s*false/.test(text) ||
    !/literal path-prefix arrays/.test(text) ||
    !/base-sha is required for a new-branch push/.test(text) ||
    /\beval\s*\(/.test(text)
  ) {
    errors.push('reusable-change-detection.yml: change detection must use validated data and git arguments');
  }
}

function extractUses(lines) {
  const uses = [];
  for (let index = 0; index < lines.length; index += 1) {
    const { source, comment } = splitYamlComment(lines[index]);
    for (const match of source.matchAll(USE_VALUE)) {
      uses.push({ target: match[1], comment, line: index + 1 });
    }

    const block = source.match(
      /(?:^|[,{])\s*(?:-\s*)?["']?uses["']?\s*:\s*[>|][-+0-9]*\s*$/,
    );
    if (!block) continue;
    const indentation = lines[index].match(/^ */)[0].length;
    const values = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor];
      const candidateIndentation = candidate.match(/^ */)[0].length;
      if (candidate.trim() && candidateIndentation <= indentation) break;
      if (candidate.trim()) values.push(stripYamlComment(candidate).trim());
      cursor += 1;
    }
    const target = values.join(' ').trim();
    if (target) uses.push({ target, comment, line: index + 1 });
  }
  return uses;
}

function extractCallSecrets(lines) {
  const callIndex = lines.findIndex((line) => /^ {2}workflow_call:\s*$/.test(line));
  if (callIndex === -1) return [];
  const secretsIndex = lines.findIndex(
    (line, index) => index > callIndex && /^ {4}secrets:\s*$/.test(line),
  );
  if (secretsIndex === -1) return [];
  const names = [];
  for (let index = secretsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.match(/^ */)[0].length <= 4) break;
    const match = line.match(/^ {6}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
}

function extractJobBlocks(lines) {
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return [];
  const starts = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/);
    if (match) starts.push({ index, name: match[1] });
  }
  return starts.map((start, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    return {
      name: start.name,
      text: lines.slice(start.index, end).join('\n'),
    };
  });
}

function shellBlocks(lines) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) {
      const source = stripYamlComment(lines[index]);
      const flow = source.match(
        /(?:^|[,{])\s*(?:-\s*)?["']?run["']?\s*:\s*(.+?)(?:}\s*)?$/,
      );
      if (flow) blocks.push({ line: index + 1, text: flow[1] });
      continue;
    }
    const indentation = match[1].length;
    const collected = [match[2]];
    let cursor = index + 1;
    if (/^[>|][-+0-9]*$/.test(match[2].trim())) {
      collected.length = 0;
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line.trim() && line.match(/^\s*/)[0].length <= indentation) break;
        collected.push(line);
        cursor += 1;
      }
    }
    blocks.push({ line: index + 1, text: collected.join('\n') });
  }
  return blocks;
}

function executableShell(text) {
  return shellBlocks(text.split('\n'))
    .map((block) => block.text)
    .join('\n');
}

function inspectYamlSurface(relativePath, lines) {
  const errors = [];
  let blockIndent = null;
  for (const [index, line] of lines.entries()) {
    const indentation = line.match(/^ */)[0].length;
    if (blockIndent !== null) {
      if (!line.trim() || indentation > blockIndent) continue;
      blockIndent = null;
    }
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation % 2 !== 0) {
      errors.push(`${relativePath}:${index + 1}: YAML indentation must use two-space levels`);
    }

    const source = stripYamlComment(line);
    if (/:\s*[>|][-+0-9]*\s*$/.test(source)) {
      blockIndent = indentation;
      continue;
    }
    const balance = flowBalance(source);
    if (balance.quote) {
      errors.push(`${relativePath}:${index + 1}: unterminated YAML quote`);
    }
    if (balance.square !== 0 || balance.curly !== 0) {
      errors.push(`${relativePath}:${index + 1}: flow collections must open and close on one line`);
    }
  }
  return errors;
}

function flowBalance(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && line[index + 1] === "'") {
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }
    if (character === '"' && !singleQuoted && line[index - 1] !== '\\') {
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (singleQuoted || doubleQuoted) continue;
    if (character === '[') square += 1;
    if (character === ']') square -= 1;
    if (character === '{') curly += 1;
    if (character === '}') curly -= 1;
  }
  return { square, curly, quote: singleQuoted || doubleQuoted };
}

function stripYamlComment(line) {
  return splitYamlComment(line).source;
}

function splitYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
    if (character === '"' && !singleQuoted && line[index - 1] !== '\\') {
      doubleQuoted = !doubleQuoted;
    }
    if (character === '#' && !singleQuoted && !doubleQuoted) {
      return { source: line.slice(0, index), comment: line.slice(index + 1).trim() };
    }
  }
  return { source: line, comment: '' };
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
