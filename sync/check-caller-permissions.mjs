#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  callerPermissionLintReport,
  inspectCallerPermissionCheckout,
} from './lib/caller-permissions.mjs';

const root = resolve(process.argv[2] ?? '.');
const result = inspectCallerPermissionCheckout(root, 'jrmoulckers/.github');
const report = callerPermissionLintReport(result);

for (const annotation of report.annotations) {
  process.stdout.write(
    `::${annotation.level} file=${escapeProperty(annotation.path)},` +
      `line=${annotation.line},title=${escapeProperty(annotation.title)}::` +
      `${escapeData(annotation.message)}\n`,
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.summary);
} else {
  process.stdout.write(`${report.summary}\n`);
}

if (!report.ok) process.exitCode = 1;

function escapeData(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
