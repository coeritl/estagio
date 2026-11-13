param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ClaspArguments)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$cli = Join-Path $PSScriptRoot 'node_modules/@google/clasp/build/src/index.js'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Instale as dependências locais do clasp antes de executar.' }
Push-Location -LiteralPath $PSScriptRoot
try {
  & $node $cli --project (Join-Path $PSScriptRoot '.clasp.json') @ClaspArguments
  $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
