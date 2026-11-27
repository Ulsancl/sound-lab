import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { powershellPath, powershellArgs } from '../desktop/windows-powershell.cjs';

function inside(root, file) {
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Path escaped the workspace');
  return relative;
}

export function checkedPath(root, file) {
  root = path.resolve(root); file = path.resolve(file);
  const relative = inside(root, file);
  let current = root;
  for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Symlinks and special files are not allowed: ' + current);
    const real = fs.realpathSync(current);
    if (path.relative(real, current) !== '') throw new Error('Non-canonical input path: ' + current);
  }
  return file;
}

export function readInput(root, file) {
  file = checkedPath(root, file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd), current = fs.lstatSync(checkedPath(root, file));
    if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('Input changed while opening');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function checkTree(root, directory) {
  checkedPath(root, directory);
  if (fs.statSync(directory).isDirectory()) for (const name of fs.readdirSync(directory)) checkTree(root, path.join(directory, name));
}

export function secureDirectory(root, directory) {
  root = path.resolve(root); directory = path.resolve(directory);
  const relative = inside(root, directory);
  let current = root;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    checkedPath(root, current);
    const info = fs.statSync(current);
    if (!info.isDirectory()) throw new Error('Output parent must be a directory');
    // A distinct local user must not be able to swap verified output parents.
    if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o022))) throw new Error('Output directory must be owned by this user and not writable by other users');
  }
  return directory;
}

export function stagingDirectory(root) {
  secureDirectory(root, root);
  return privateStage(root);
}

function privateStage(parent) {
  if (process.platform !== 'win32') return fs.mkdtempSync(path.join(parent, '.security-stage-'));
  const directory = path.join(parent, '.security-stage-' + randomUUID());
  const script = fs.readFileSync(new URL('./private-directory.ps1', import.meta.url), 'utf8');
  const result = spawnSync(powershellPath(), powershellArgs(script), { input: directory, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not create a private Windows staging directory: ' + result.stderr.trim());
  return directory;
}

export function writeArtifact(root, file, data) {
  const parent = secureDirectory(root, path.dirname(file));
  if (fs.lstatSync(file, { throwIfNoEntry: false })) checkedPath(root, file);
  const stage = privateStage(parent);
  try {
    const temporary = path.join(stage, 'artifact');
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    secureDirectory(root, parent);
    if (fs.lstatSync(file, { throwIfNoEntry: false })) checkedPath(root, file);
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export function copyInput(root, source, target) {
  checkedPath(root, source);
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) copyInput(root, path.join(source, name), path.join(target, name));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, readInput(root, source), { flag: 'wx', mode: 0o600 });
  }
}

export function publishDirectory(root, source, target) {
  checkTree(root, source);
  if (!fs.lstatSync(source).isDirectory()) throw new Error('Staged output must be a directory');
  secureDirectory(root, path.dirname(target));
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    checkTree(root, target);
    if (!fs.lstatSync(target).isDirectory()) throw new Error('Existing output must be a directory');
    // Keep the previous generated result until the new one is published.
    const backup = path.join(path.dirname(source), 'previous');
    fs.renameSync(target, backup);
    try { fs.renameSync(source, target); } catch (error) { fs.renameSync(backup, target); throw error; }
    fs.rmSync(backup, { recursive: true });
  } else fs.renameSync(source, target);
}

export function artifactDirectory(root, destination) {
  destination = path.resolve(root, destination);
  secureDirectory(root, path.dirname(destination));
  if (fs.lstatSync(destination, { throwIfNoEntry: false })) checkTree(root, destination);
  const stage = stagingDirectory(root), output = path.join(stage, 'artifacts');
  fs.mkdirSync(output, { mode: 0o700 });
  process.once('exit', () => {
    try { publishDirectory(root, output, destination); }
    finally { fs.rmSync(stage, { recursive: true, force: true }); }
  });
  return output;
}
