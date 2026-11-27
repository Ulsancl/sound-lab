$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$ownsTemporary = $false
$status = 0
try {
    $parent = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($request.target))
    for ($directory = $parent; $null -ne $directory; $directory = $directory.Parent) {
        if (!$directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Invalid project directory'
        }
    }
    $security = [Security.AccessControl.FileSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))
    $stream = [IO.FileStream]::new($request.temporary, [IO.FileMode]::CreateNew,
        [Security.AccessControl.FileSystemRights]::FullControl, [IO.FileShare]::None, 4096,
        [IO.FileOptions]::None, $security)
    $ownsTemporary = $true
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($request.contents)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }

    if ($request.existing) {
        $attributes = [IO.File]::GetAttributes($request.target)
        if ($attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) {
            throw 'Invalid project destination'
        }
        # Windows ReplaceFile preserves the destination DACL and fails if its
        # metadata cannot be merged. The empty backup path is translated to null.
        [IO.File]::Replace($request.temporary, $request.target, [NullString]::Value, $false)
    } else {
        # Move fails if a new destination appeared after the dialog.
        [IO.File]::Move($request.temporary, $request.target)
    }
    $ownsTemporary = $false
} catch {
    $problem = $_.Exception
    while ($problem.InnerException) { $problem = $problem.InnerException }
    $code = $problem.HResult -band 0xffff
    $status = if ($code -in @(5, 32, 33, 1224)) { 2 } else { 1 }
} finally {
    if ($ownsTemporary) { [IO.File]::Delete($request.temporary) }
}
exit $status
