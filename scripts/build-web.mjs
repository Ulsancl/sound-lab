import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { copyInput, publishDirectory, stagingDirectory } from './safe-files.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildWeb({ workspace = root, mode = 'production', destination = path.join(workspace, 'dist') } = {}) {
  const stage = stagingDirectory(workspace);
  try {
    for (const input of ['index.html', 'vite.config.js', 'package.json', 'src', 'public', 'node_modules/three']) {
      copyInput(workspace, path.join(workspace, input), path.join(stage, input));
    }
    const output = path.join(stage, 'dist');
    // The configuration and the only frontend dependency are staged alongside
    // the source. The Vite executable itself comes from the locked toolchain.
    await build({ root: stage, configFile: path.join(stage, 'vite.config.js'), envDir: false,
      mode, build: { outDir: output, emptyOutDir: false } });
    publishDirectory(workspace, output, destination);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildWeb();
