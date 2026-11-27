import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { powershellPath, powershellArgs } from '../desktop/windows-powershell.cjs';

const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$installables = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
foreach ($file in $installables) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or
        !$signature.SignerCertificate -or !$signature.TimeStamperCertificate) {
        throw "A valid timestamped Authenticode signature is required: $($signature.Status)"
    }
    if ($env:SOUND_RELEASE_SIGNER_THUMBPRINT -notmatch '\\A[0-9a-fA-F]{40}\\z' -or
        $signature.SignerCertificate.Thumbprint -ne $env:SOUND_RELEASE_SIGNER_THUMBPRINT) {
        throw 'Authenticode signer did not match the approved certificate'
    }
}
`;

export function verifySignatures(files) {
  if (process.platform !== 'win32' || files.length === 0) throw new Error('Windows executable paths are required');
  const result = spawnSync(powershellPath(), powershellArgs(script), {
    input: JSON.stringify(files.map(file => path.resolve(file))), encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Authenticode verification failed');
  console.log('Verified timestamped Authenticode signatures for the approved publisher.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) verifySignatures(process.argv.slice(2));
