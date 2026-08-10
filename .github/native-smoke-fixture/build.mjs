// Stands in for a member's web build. It writes a bundle so the harness exercises the real
// build -> test -> bundle-budget path rather than a no-op, and it reads SMOKE_VERSION to prove the
// caller's `version` input actually reaches the platform job's environment.
import { mkdirSync, writeFileSync } from 'node:fs';

const version = process.env.SMOKE_VERSION;
if (!version) {
  console.error('SMOKE_VERSION was not set: the version input did not reach the build step');
  process.exit(1);
}

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.js', `export const smokeVersion = ${JSON.stringify(version)};\n`, 'utf8');
console.log(`built dist/index.js for ${version}`);
