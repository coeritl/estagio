$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $node)) {
  throw 'Node.js não foi localizado. Instale o Node.js ou ajuste o caminho em run-sync.ps1.'
}

Set-Location -LiteralPath $root
& $node (Join-Path $root 'src\index.mjs')
exit $LASTEXITCODE
