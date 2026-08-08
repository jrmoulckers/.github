#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadManifest } from './lib/manifest.mjs';
import { validatePromptIntegrity } from './lib/prompt-integrity.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = loadManifest(repoRoot);
const prompts = validatePromptIntegrity(repoRoot, manifest);

process.stdout.write(`Validated ${prompts.length} canonical prompts: ${prompts.map((p) => p.name).join(', ')}\n`);
