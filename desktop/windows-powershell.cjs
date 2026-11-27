const path = require('node:path');

function powershellPath() {
  const root = process.env.SystemRoot;
  if (!root || !path.isAbsolute(root)) throw new Error('Windows SystemRoot is unavailable');
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function powershellArgs(script) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

module.exports = { powershellPath, powershellArgs };
