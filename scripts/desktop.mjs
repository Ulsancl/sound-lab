import { checkedPath, readInput, copyInput, stagingDirectory, publishDirectory, checkTree } from './safe-files.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildWeb, root } from './build-web.mjs';
import { verifySignatures } from './verify-release.mjs';

const require = createRequire(import.meta.url);
const mode = process.argv[2];
if (!['start', 'package', 'prepare-test', 'package-test', 'package-signed'].includes(mode)) {
  throw new Error('Use start, prepare-test, package, package-test or package-signed');
}
if (mode === 'prepare-test' && process.env.SOUND_DESKTOP_EXE) process.exit(0);
const signed = mode === 'package-signed', testPackage = mode === 'package-test';
if (signed && (process.platform !== 'win32' || !/^[\da-f]{40}$/i.test(process.env.SOUND_RELEASE_SIGNER_THUMBPRINT ?? ''))) {
  throw new Error('Release packaging requires Windows and the approved SOUND_RELEASE_SIGNER_THUMBPRINT');
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
if (!signed) {
  // Development and CI packaging never consumes a release signing identity.
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) delete env[key];
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}
function run(executable, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)));
  });
}
checkTree(root, path.join(root, 'node_modules/electron'));
const electronPackage = path.dirname(require.resolve('electron/package.json'));
await run(process.execPath, [path.join(electronPackage, 'install.js')]);
if (mode === 'start' || mode === 'prepare-test') {
  for (const input of ['desktop', 'resources']) checkTree(root, path.join(root, input));
  await buildWeb({ mode: mode === 'prepare-test' ? 'desktop-test' : 'production' });
  if (mode === 'start') await run(require('electron'), [root]);
} else {
  const stage = stagingDirectory(root), app = path.join(stage, 'app'), output = path.join(stage, 'windows');
  try {
    const configuration = JSON.parse(readInput(root, path.join(root, 'electron-builder.json')));
    const packageInfo = JSON.parse(readInput(root, path.join(root, 'package.json')));
    const configPath = path.join(stage, 'electron-builder.json');
    if (testPackage) configuration.electronFuses.enableNodeCliInspectArguments = true;
    configuration.forceCodeSigning = signed;
    fs.writeFileSync(configPath, JSON.stringify(configuration), { flag: 'wx', mode: 0o600 });
    const inputs = [...new Set(['desktop', 'package.json', configuration.directories.buildResources, ...configuration.files.filter(file => !file.includes('*')), ...configuration.extraResources.map(item => item.from)])];
    for (const input of inputs.filter(file => !inputs.some(parent => file !== parent && file.startsWith(parent + '/')))) {
      copyInput(root, path.join(root, input), path.join(app, input));
    }
    for (const dependency of Object.keys(packageInfo.dependencies || {})) {
      copyInput(root, path.join(root, 'node_modules', dependency), path.join(app, 'node_modules', dependency));
    }
    await buildWeb({ mode: testPackage ? 'desktop-test' : 'production', destination: path.join(app, 'dist') });
    const electronDist = checkedPath(root, path.join(root, 'node_modules', 'electron', 'dist'));
    checkTree(root, electronDist);
    await run(process.execPath, [path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'),
      '--win', ...(testPackage ? ['--dir'] : ['nsis']), '--x64', '--config', configPath, '--projectDir', app,
      `--config.electronDist=${electronDist}`, `--config.directories.output=${output}`, '--config.npmRebuild=false', '--publish', 'never'], stage);
    if (!testPackage) {
      const file = path.join(output, `Sound-Lab-Setup-${packageInfo.version}.exe`);
      if (signed) verifySignatures([file, path.join(output, 'win-unpacked', 'Sound Lab.exe')]);
      const checksum = createHash('sha256').update(readInput(root, file)).digest('hex');
      fs.writeFileSync(file + '.sha256', `${checksum}  ${path.basename(file)}\n`, { flag: 'wx', mode: 0o600 });
    }
    const destination = path.join(root, 'release', testPackage ? 'test-windows' : 'windows');
    publishDirectory(root, output, destination);
    console.log(`Windows output: ${destination}`);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
