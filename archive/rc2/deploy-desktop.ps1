param([ValidateSet('check','apply','restore')][string]$Action='check')
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$manifest=Get-Content -LiteralPath (Join-Path $root '.desktop-candidate/manifest.json') -Raw | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($manifest.source)
$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/app.asar'))
if($target -ne $expected){throw 'Unexpected installation target'}
$candidate=[IO.Path]::GetFullPath((Join-Path $root '.desktop-candidate/app.asar'))
$backup=Join-Path $root '.desktop-backup/app.asar'
function Hash($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$active=Hash $target
if($active -notin @($manifest.originalSha256,$manifest.candidateSha256)){throw 'Installation changed; regenerate and revalidate candidate before proceeding'}
if((Hash $candidate) -ne $manifest.candidateSha256){throw 'Candidate checksum mismatch'}
if($Action -eq 'check'){Write-Output "Current archive: $active";Write-Output "Candidate valid. Apply/restore requires all Desktop processes closed.";exit 0}
$install=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness'))
$running=@(Get-Process -ErrorAction SilentlyContinue | Where-Object {try{$_.Path -and $_.Path.StartsWith($install,[StringComparison]::OrdinalIgnoreCase)}catch{$false}})
if($running.Count -gt 0){throw 'DeepSeek Harness is running. Exit via the tray menu, then retry. This script will not terminate it.'}
if($Action -eq 'apply'){
 if($active -eq $manifest.candidateSha256){Write-Output 'Already patched';exit 0}
 New-Item -ItemType Directory -Force -Path (Split-Path $backup) | Out-Null
 if(Test-Path -LiteralPath $backup){if((Hash $backup) -ne $manifest.originalSha256){throw 'Existing backup mismatch'}}else{Copy-Item -LiteralPath $target -Destination $backup;if((Hash $backup) -ne $manifest.originalSha256){throw 'Backup verification failed'}}
 $source=$candidate;$wanted=$manifest.candidateSha256
}else{
 if($active -eq $manifest.originalSha256){Write-Output 'Already original';exit 0}
 if(!(Test-Path -LiteralPath $backup) -or (Hash $backup) -ne $manifest.originalSha256){throw 'Valid backup missing'}
 $source=$backup;$wanted=$manifest.originalSha256
}
$stage=$target+'.failover-staged'
if(Test-Path -LiteralPath $stage){
 if((Hash $stage) -ne $wanted){throw 'Existing staging checksum mismatch; preserve it for manual inspection'}
 Write-Output 'Reusing verified staging archive from previous attempt.'
}else{Copy-Item -LiteralPath $source -Destination $stage}
if((Hash $stage) -ne $wanted){throw 'Staging checksum mismatch'}
# Use an explicit backup filename: Windows PowerShell can marshal $null as an empty string.
# Keep this recovery copy if replacement or post-verification fails.
$replacementBackup=$target+'.failover-replaced-'+[guid]::NewGuid().ToString('N')
[IO.File]::Replace($stage,$target,$replacementBackup)
if((Hash $target) -ne $wanted){throw 'Post-deployment checksum mismatch'}
Write-Output "Success: $Action. Launch Desktop normally. Keep bundle disabled until patched runtime verification."
