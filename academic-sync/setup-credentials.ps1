$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $root 'credentials.dpapi.json'
$username = Read-Host 'Login do Sistema Academico (nome.sobrenome)'
if ([string]::IsNullOrWhiteSpace($username)) {
  throw 'O login nao foi informado.'
}

$securePassword = Read-Host 'Senha do Sistema Academico' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$clearBytes = $null
try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrEmpty($plainPassword)) { throw 'A senha nao foi informada.' }
  $clearBytes = [Text.Encoding]::UTF8.GetBytes($plainPassword)
  $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
    $clearBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $protectedPassword = [Convert]::ToBase64String($protectedBytes)
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($clearBytes) { [Array]::Clear($clearBytes, 0, $clearBytes.Length) }
  $plainPassword = $null
}

$payload = [ordered]@{
  username = $username.Trim()
  password = $protectedPassword
  protection = 'DPAPI-CurrentUser'
  protected_for = "$env:USERDOMAIN\$env:USERNAME"
  created_at = (Get-Date).ToUniversalTime().ToString('o')
}

$payload | ConvertTo-Json | Set-Content -LiteralPath $target -Encoding UTF8
Write-Host ''
Write-Host 'Credenciais protegidas com sucesso.' -ForegroundColor Green
Write-Host "Arquivo: $target"
Write-Host "Usuário do Windows autorizado: $($payload.protected_for)"
Write-Host 'A senha nao foi gravada em texto aberto e nao sera enviada ao GitHub.'
