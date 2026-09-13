import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const pluginDir = path.join(repoRoot, '.obsidian', 'plugins', 'todoseq');

mkdirSync(pluginDir, { recursive: true });

const files = ['main.js', 'styles.css', 'manifest.json'];
for (const file of files) {
  const source = path.join(repoRoot, file);
  if (!existsSync(source)) {
    console.error(`Skipping missing file: ${file}`);
    continue;
  }
  copyFileSync(source, path.join(pluginDir, file));
}

console.log(`Plugin files copied to: ${pluginDir}`);
console.log('Reload the TODOseq plugin in Obsidian to apply changes');
