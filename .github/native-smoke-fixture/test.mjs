// Stands in for a member's web tests. Asserting on the build output keeps the harness honest: a
// test command that always passes would still exercise the workflow's plumbing, but it would not
// notice if the build step had silently produced nothing.
import { readFileSync } from 'node:fs';

const version = process.env.SMOKE_VERSION;
const bundle = readFileSync('dist/index.js', 'utf8');

if (!bundle.includes(JSON.stringify(version))) {
  console.error(`dist/index.js does not carry SMOKE_VERSION (${version})`);
  process.exit(1);
}

console.log('bundle carries the smoke version');
