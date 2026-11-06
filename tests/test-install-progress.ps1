$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$fixture=Join-Path $env:TEMP ('yingce-progress-tests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$ui=Get-Content (Join-Path $root 'installer-progress-ui.ps1') -Raw -Encoding UTF8
$ui=$ui.Replace('[void]$form.ShowDialog()', @'
Update-ProgressView $global:progressTestState
[PSCustomObject]@{Title=$title.Text;Detail=$detail.Text;Value=$bar.Value;Style=$bar.Style.ToString()}
'@)
$script=[scriptblock]::Create($ui)
$headers=Join-Path $fixture 'headers'
$partial=Join-Path $fixture 'archive.partial'
$stream=[IO.File]::Create($partial);$stream.SetLength(50MB);$stream.Dispose()
"HTTP/1.1 302 Found`r`nContent-Length: 0`r`nHTTP/1.1 200 OK`r`nContent-Length: 104857600`r`n" | Set-Content $headers
$global:progressTestState=@{Stage='下载';File=$partial;Headers=$headers;Percent=-1;Done=$false}
$view=& $script -StatePath 'unused' -InstallerProcessId $PID
if($view.Value -ne 50 -or $view.Detail -notmatch '100.00'){throw 'Fresh download percent failed'}
"HTTP/1.1 206 Partial Content`r`nContent-Length: 52428800`r`nContent-Range: bytes 52428800-104857599/104857600`r`n" | Set-Content $headers
$view=& $script -StatePath 'unused' -InstallerProcessId $PID
if($view.Value -ne 50){throw 'Resumed download total incorrect'}
$global:progressTestState=@{Stage='校验';Percent=-1;Done=$false}
$view=& $script -StatePath 'unused' -InstallerProcessId $PID
if($view.Style -ne 'Marquee'){throw 'Unknown stage progress should be indeterminate'}
$global:progressTestState=@{Stage='完成';Percent=100;Done=$true}
$view=& $script -StatePath 'unused' -InstallerProcessId $PID
if($view.Value -ne 100 -or $view.Title -ne '完成'){throw 'Completion failed'}
$installer=Get-Content (Join-Path $root 'install.ps1') -Raw -Encoding UTF8
# Run the real offline installer with only its window launch replaced by a status sink.
$installer=$installer.Replace("`nStart-InstallationProgress`n", "`n`$script:progressState=Join-Path `$InstallRoot 'test-state.json'`n")
$installer=$installer.Replace("`r`nStart-InstallationProgress`r`n", "`r`n`$script:progressState=Join-Path `$InstallRoot 'test-state.json'`r`n")
$testInstaller=Join-Path $fixture 'install.ps1'
[IO.File]::WriteAllText($testInstaller,$installer,[Text.UTF8Encoding]::new($true))
$feed=Join-Path $fixture 'feed'
$source=Join-Path $feed 'releases\1.3.18\app'
New-Item -ItemType Directory -Path $source -Force | Out-Null
$payload=Join-Path $source 'test.txt';'fixture' | Set-Content $payload
$manifest=@{version='1.3.18';files=@(@{path='app/test.txt';sha256=(Get-FileHash $payload).Hash})}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $feed 'latest.json')
$target=Join-Path $fixture '新电脑 安装';New-Item -ItemType Directory -Path $target | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $testInstaller -FeedRoot $feed -InstallRoot $target -NoShortcut -NoLaunch | Out-Null
if($LASTEXITCODE -ne 0){throw 'Offline install failed'}
$state=Get-Content (Join-Path $target 'test-state.json') -Raw | ConvertFrom-Json
if(!$state.Done -or $state.Percent -ne 100 -or (Get-Content (Join-Path $target 'current.txt')).Trim() -ne '1.3.18'){throw 'Installation completion state missing'}
if((Get-FileHash (Join-Path $target 'install.ps1')).Hash -ne (Get-FileHash $testInstaller).Hash){throw 'Embedded installer not preserved for future updates'}
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $target 'update.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Generated updater syntax invalid'}
'changed' | Set-Content $payload
$failedTarget=Join-Path $fixture 'failed';New-Item -ItemType Directory -Path $failedTarget | Out-Null
$ErrorActionPreference='Continue'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $testInstaller -FeedRoot $feed -InstallRoot $failedTarget -NoShortcut -NoLaunch 2>$null | Out-Null
$ErrorActionPreference='Stop'
if($LASTEXITCODE -eq 0 -or (Test-Path (Join-Path $failedTarget 'current.txt'))){throw 'Corrupt install unexpectedly activated'}
$state=Get-Content (Join-Path $failedTarget 'test-state.json') -Raw | ConvertFrom-Json
if(!$state.Done -or $state.Stage -ne '更新未完成'){throw 'Error state missing'}
$bootstrap=Join-Path $fixture 'bootstrap'
New-Item -ItemType Directory -Path $bootstrap | Out-Null
Copy-Item (Join-Path $target 'update.ps1') (Join-Path $bootstrap 'update.ps1')
'https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/latest/download' | Set-Content (Join-Path $bootstrap 'update-source.txt')
$remote=Join-Path $fixture 'remote-installer.ps1'
'param($FeedRoot,$InstallRoot); "remote" | Set-Content (Join-Path $InstallRoot "ran.txt")' | Set-Content $remote
$global:testAssetHash=(Get-FileHash $remote).Hash
function Invoke-RestMethod {param($Uri,$TimeoutSec) @{assets=@(@{name='install.ps1';digest=('sha256:'+$global:testAssetHash)})}}
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Copy-Item $remote $OutFile}
& (Join-Path $bootstrap 'update.ps1')
if((Get-Content (Join-Path $bootstrap 'ran.txt')).Trim() -ne 'remote'){throw 'Verified installer refresh failed'}
$global:testAssetHash='0'*64
'param($FeedRoot,$InstallRoot); "local" | Set-Content (Join-Path $InstallRoot "ran.txt")' | Set-Content (Join-Path $bootstrap 'install.ps1')
& (Join-Path $bootstrap 'update.ps1')
if((Get-Content (Join-Path $bootstrap 'ran.txt')).Trim() -ne 'local'){throw 'Bad installer digest replaced trusted local installer'}
Write-Host 'PASS: fresh/resumed download totals, indeterminate stages, completed UI, offline installation, persistent updater, corrupt installation failure.'
Write-Host 'PASS: verified installer refresh and checksum mismatch fallback.'
$global:LASTEXITCODE=0
