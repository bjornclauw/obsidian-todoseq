import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Cross-platform launcher for the Playwright CLI.
 *
 * Lets `npm run test:integration*` set environment variables without the
 * Unix-only `VAR=value command` prefix, and strips the custom `--coverage`
 * flag (which maps to `COLLECT_COVERAGE=1`) before forwarding to Playwright.
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const cli = path.join(
  repoRoot,
  'node_modules',
  '@playwright',
  'test',
  'cli.js',
);

if (!existsSync(cli)) {
  console.error(`Playwright CLI not found at ${cli}. Run npm install first.`);
  process.exit(1);
}

const forwarded = [];
let coverage = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--coverage') coverage = true;
  else forwarded.push(arg);
}

const suppress = '--disable-warning=DEP0205';
const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
if (!existingNodeOptions.includes(suppress)) {
  process.env.NODE_OPTIONS = `${existingNodeOptions} ${suppress}`.trim();
}
if (coverage) {
  process.env.COLLECT_COVERAGE = '1';
}

const child = spawn(process.execPath, [cli, ...forwarded], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
