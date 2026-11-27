$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$directory = [IO.DirectoryInfo]::new([Console]::In.ReadToEnd())
$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $user, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
$directory.Create($security)
$access = $directory.GetAccessControl()
$rules = $access.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    !$access.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $user) {
    throw 'The staging directory must have a private ACL'
}
