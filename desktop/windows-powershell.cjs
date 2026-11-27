const path = require('node:path');

function powershellPath() {
  const root = process.env.SystemRoot;
  if (!root || !path.isAbsolute(root)) throw new Error('Windows SystemRoot is unavailable');
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function powershellArgs(script) {
  // Hosted jobs use PowerShell 7 and may pass module paths that 5.1 cannot load.
  // System helpers only require the built-in 5.1 modules.
  const command = "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules');\n" + script;
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
}

module.exports = { powershellPath, powershellArgs };
