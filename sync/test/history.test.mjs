import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { historicalFileVersions } from '../lib/history.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { apply } from '../lib/copier.mjs';
import { readLock } from '../lib/lock.mjs';
import { inject } from '../lib/provenance.mjs';

function git(root, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=History Test', '-c', 'user.email=history@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function write(root, path, content) {
  const abs = join(root, ...path.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

test('historical evidence contains exact prior committed source blobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'history-test-'));
  try {
    git(root, 'init');
    const path = 'prompts/review.prompt.md';
    write(root, path, '# prior canon\n');
    git(root, 'add', path);
    git(root, 'commit', '-m', 'prior');

    write(root, path, '# current canon\n');
    git(root, 'add', path);
    git(root, 'commit', '-m', 'current');

    const versions = historicalFileVersions(root, [path]);
    assert.deepEqual(
      new Set(versions.get(path)),
      new Set(['# prior canon\n', '# current canon\n']),
      'the positive recovery test is not vacuous: both committed blobs are available as evidence',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical evidence refuses a shallow repository', () => {
  const source = mkdtempSync(join(tmpdir(), 'history-source-'));
  const clone = mkdtempSync(join(tmpdir(), 'history-clone-'));
  try {
    git(source, 'init');
    write(source, 'prompts/review.prompt.md', '# canon\n');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'canon');

    rmSync(clone, { recursive: true, force: true });
    execFileSync('git', ['clone', '--depth', '1', `file:///${source.replace(/\\/g, '/')}`, clone], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.throws(
      () => historicalFileVersions(clone, ['prompts/review.prompt.md']),
      /requires full backbone history/,
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

test('target enumeration recovers a member holding a prior committed engine rendering', () => {
  const backbone = mkdtempSync(join(tmpdir(), 'history-backbone-'));
  const member = mkdtempSync(join(tmpdir(), 'history-member-'));
  try {
    git(backbone, 'init');
    const sourcePath = 'prompts/review.prompt.md';
    const targetPath = '.github/prompts/review.prompt.md';
    const prior = '---\ndescription: Review\n---\n\nPrior canon.\n';
    const current = '---\ndescription: Review\n---\n\nCurrent canon.\n';

    write(backbone, sourcePath, prior);
    git(backbone, 'add', sourcePath);
    git(backbone, 'commit', '-m', 'prior');
    write(backbone, sourcePath, current);
    git(backbone, 'add', sourcePath);
    git(backbone, 'commit', '-m', 'current');

    const resolved = {
      groups: [
        {
          kind: 'prompts',
          mode: 'file',
          names: ['review'],
          sourceBase: 'prompts',
          targetBase: '.github/prompts',
        },
      ],
    };
    const [spec] = enumerateTargets(resolved, backbone).writes;
    const priorRendered = inject(targetPath, prior);
    write(member, targetPath, priorRendered);

    const { report } = apply(member, [spec], readLock(member, 'jrmoulckers/.github'), {
      write: true,
    });

    assert.deepEqual(report.updated.map((item) => item.targetPath), [targetPath]);
    assert.equal(report.drift.length, 0);
    assert.equal(readFileSync(join(member, ...targetPath.split('/')), 'utf8'), inject(targetPath, current));
  } finally {
    rmSync(backbone, { recursive: true, force: true });
    rmSync(member, { recursive: true, force: true });
  }
});
