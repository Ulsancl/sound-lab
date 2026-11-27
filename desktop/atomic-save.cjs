const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { powershellPath, powershellArgs } = require('./windows-powershell.cjs');

const WINDOWS_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400]);
const transientCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function windowsReplace(target, temporary, contents, existing) {
  const script = readFileSync(path.join(__dirname, 'save-windows.ps1'), 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), powershellArgs(script), {
      windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Object.assign(
      new Error('안전한 Windows 파일 저장을 완료하지 못했습니다.'),
      { code: code === 2 ? 'EBUSY' : 'EIO' })));
    child.stdin.end(JSON.stringify({ target, temporary, contents, existing }));
  });
}

// A complete sibling replaces the destination only after it has been flushed.
// Some Windows readers/scanners briefly prevent replacement; retry only that
// operation, with the destination checked again before every attempt.
async function atomicWriteProject(target, contents, {
  validateTarget,
  operations = fs,
  platform = process.platform,
  wait = delay,
} = {}) {
  if (typeof validateTarget !== 'function') throw new TypeError('A target validator is required');
  const original = await validateTarget(target);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  if (platform === 'win32' && operations === fs) {
    for (let attempt = 0; ; attempt++) {
      const current = await validateTarget(target);
      if (Boolean(current) !== Boolean(original) || (current && (current.dev !== original.dev || current.ino !== original.ino))) {
        throw new Error('저장할 파일이 변경되었습니다. 다시 선택해 주세요.');
      }
      try { await windowsReplace(target, temporary, contents, Boolean(current)); return; }
      catch (error) {
        if (!transientCodes.has(error.code) || attempt >= WINDOWS_RETRY_DELAYS_MS.length) throw error;
        await wait(WINDOWS_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  let ownsTemporary = false;
  try {
    const handle = await operations.open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    try {
      await handle.writeFile(contents, 'utf8');
      if (platform !== 'win32' && original) {
        const tempStat = await handle.stat();
        if (tempStat.uid !== original.uid || tempStat.gid !== original.gid) await handle.chown(original.uid, original.gid);
        await handle.chmod(original.mode & 0o777);
      }
      await handle.sync();
    }
    finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      await validateTarget(target);
      try {
        await operations.rename(temporary, target);
        ownsTemporary = false;
        return;
      } catch (error) {
        if (platform !== 'win32' || !transientCodes.has(error.code) || attempt >= WINDOWS_RETRY_DELAYS_MS.length) throw error;
        await wait(WINDOWS_RETRY_DELAYS_MS[attempt]);
      }
    }
  } finally {
    if (ownsTemporary) await operations.unlink(temporary).catch(() => {});
  }
}

module.exports = { atomicWriteProject, WINDOWS_RETRY_DELAYS_MS };
