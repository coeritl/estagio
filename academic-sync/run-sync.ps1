$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $node)) {
  throw 'Node.js não foi localizado. Instale o Node.js ou ajuste o caminho em run-sync.ps1.'
}

Set-Location -LiteralPath $root
$credentialsPath = Join-Path $root 'credentials.dpapi.json'
$clearBytes = $null

try {
  if (Test-Path -LiteralPath $credentialsPath) {
    $stored = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
    $protectedBytes = [Convert]::FromBase64String([string]$stored.password)
    $clearBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $env:ACADEMIC_SYNC_USERNAME = [string]$stored.username
    $env:ACADEMIC_SYNC_PASSWORD = [Text.Encoding]::UTF8.GetString($clearBytes)
  }

  & $node (Join-Path $root 'src\index.mjs')
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:ACADEMIC_SYNC_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:ACADEMIC_SYNC_PASSWORD -ErrorAction SilentlyContinue
  if ($clearBytes) { [Array]::Clear($clearBytes, 0, $clearBytes.Length) }
}

exit $exitCode
