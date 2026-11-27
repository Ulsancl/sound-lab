import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInput, writeArtifact, copyInput, publishDirectory, stagingDirectory } from '../scripts/safe-files.mjs';

test('packaging reads reject file and directory symlinks before exposing outside bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-input-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-input-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private fixture');
  try { fs.symlinkSync(outside, path.join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS requires symlink privilege'); throw error; }
  assert.throws(() => readInput(root, path.join(root, 'docs', 'private.txt')), /Symlinks|canonical/);
  assert.throws(() => copyInput(root, path.join(root, 'docs'), path.join(root, 'copy')), /Symlinks|canonical/);
  assert.throws(() => writeArtifact(root, path.join(root, 'docs', 'private.txt'), 'changed'), /Symlinks|canonical/);
  assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), 'private fixture');
});

test('artifacts replace regular files atomically and directory publication keeps complete results', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'release', 'checksum');
  writeArtifact(root, target, 'first'); writeArtifact(root, target, 'second');
  assert.equal(readInput(root, target).toString(), 'second');
  const stage = stagingDirectory(root), source = path.join(stage, 'output');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'app'), 'new');
  const destination = path.join(root, 'release', 'windows');
  fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'app'), 'old');
  publishDirectory(root, source, destination);
  assert.equal(readInput(root, path.join(destination, 'app')).toString(), 'new');
});

test('directory publication rejects junctions in staged output and a dangling output path', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = stagingDirectory(root), output = path.join(stage, 'output'), target = path.join(root, 'dist');
  const missing = path.join(root, 'missing');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.mkdirSync(output);
  fs.symlinkSync(missing, path.join(output, 'linked'), linkType);
  assert.throws(() => publishDirectory(root, output, target), /Symlinks|canonical/);
  fs.unlinkSync(path.join(output, 'linked'));
  fs.symlinkSync(missing, target, linkType);
  assert.throws(() => publishDirectory(root, output, target), /Symlinks|canonical/);
  assert.ok(fs.lstatSync(target).isSymbolicLink());
  assert.equal(fs.existsSync(missing), false);
});
