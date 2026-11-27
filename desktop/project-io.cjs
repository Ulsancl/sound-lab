const { constants } = require('node:fs');
const fs = require('node:fs/promises');

const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
const sameFile = (a, b) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;

async function readBounded(handle, limit, tooLarge) {
  const chunks = [];
  let total = 0;
  while (total <= limit) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    total += bytesRead;
    if (total > limit) throw tooLarge();
    chunks.push(buffer.subarray(0, bytesRead));
  }
}

async function readRegularFile(target, validate, limit, tooLarge) {
  const before = await validate(target);
  if (before.size > limit) throw tooLarge();
  const handle = await fs.open(target, readFlags);
  try {
    const opened = await handle.stat();
    if (!sameFile(opened, before) || !sameFile(opened, await validate(target))) {
      throw new Error('파일이 변경되었습니다. 다시 선택해 주세요.');
    }
    if (opened.size > limit) throw tooLarge();
    return await readBounded(handle, limit, tooLarge);
  } finally { await handle.close(); }
}

module.exports = { readFlags, sameFile, readBounded, readRegularFile };
