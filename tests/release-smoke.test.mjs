import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { root } from '../scripts/build-web.mjs';
import { stagingDirectory } from '../scripts/safe-files.mjs';
import { verifySignatures } from '../scripts/verify-release.mjs';
import { powershellPath, powershellArgs } from '../desktop/windows-powershell.cjs';

const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const release = path.join(root, 'release', 'windows');
const executable = path.join(release, 'win-unpacked', 'Sound Lab.exe');
const installer = path.join(release, `Sound-Lab-Setup-${version}.exe`);
assert.throws(() => verifySignatures([installer]), /valid timestamped Authenticode signature is required/);

const wire = await getCurrentFuseWire(executable);
// Fuse wire bytes are ASCII 0/1, reported as numeric values by getCurrentFuseWire.
for (const fuse of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments', 'GrantFileProtocolExtraPrivileges']) {
  assert.equal(wire[FuseV1Options[fuse]], 48, fuse);
}
for (const fuse of ['EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar']) {
  assert.equal(wire[FuseV1Options[fuse]], 49, fuse);
}

const profile = stagingDirectory(root);
const child = spawn(executable, [], { cwd: path.dirname(executable),
  env: { ...process.env, SOUND_LAB_DATA_DIR: profile }, stdio: 'ignore' });
const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
// Observe failures both during startup and during orderly close.
exit.catch(() => {});
try {
  const log = path.join(profile, 'desktop.log');
  let loaded = false;
  for (let attempt = 0; attempt < 100 && !loaded; attempt++) {
    assert.equal(child.exitCode, null, 'Production executable must stay running');
    const value = await fs.readFile(log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    loaded = value.includes(`Loaded ${version}`);
    if (!loaded) await Promise.race([delay(150), exit]);
  }
  assert.ok(loaded, 'Production executable must load the offline bundle with ASAR checks enabled');
  const close = spawnSync(powershellPath(), powershellArgs(`
    $ErrorActionPreference = 'Stop'
    $app = [Diagnostics.Process]::GetProcessById([int][Console]::In.ReadToEnd())
    for ($i = 0; $i -lt 40; $i++) {
        $app.Refresh()
        if ($app.CloseMainWindow()) { exit 0 }
        Start-Sleep -Milliseconds 100
    }
    throw 'Sound Lab main window did not open'
  `), { input: String(child.pid), encoding: 'utf8', windowsHide: true });
  assert.equal(close.status, 0, close.stderr);
  let exited;
  try { exited = await Promise.race([exit, delay(15000, 'timeout', { ref: false })]); }
  finally { if (exited === 'timeout') child.kill(); }
  assert.equal(exited, 0, 'Production executable must close normally');
  await fs.access(path.join(profile, 'window.json'));
  console.log('Production fuses, offline bundle startup, window save and unsigned release rejection passed.');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exit.catch(() => {});
  await fs.rm(profile, { recursive: true, force: true });
}
