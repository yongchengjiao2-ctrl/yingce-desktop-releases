param([string]$FeedRoot=$PSScriptRoot,[string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'YingceCanvas'),[switch]$NoShortcut,[switch]$NoLaunch)
$ErrorActionPreference='Stop'
$online=$FeedRoot -match '^https://'
if($FeedRoot -match '^https?://' -and !$online){throw 'Online updates require HTTPS'}
# BEGIN EMBEDDED INSTALLATION PROGRESS
$script:progressState=''
function Set-InstallProgress([string]$Stage,[string]$Detail='',[int]$Percent=-1,[string]$File='',[string]$Headers='',[bool]$Done=$false){
    if(!$script:progressState){return}
    try{
        $value=@{Stage=$Stage;Detail=$Detail;Percent=$Percent;File=$File;Headers=$Headers;Done=$Done} | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($script:progressState,$value,[Text.UTF8Encoding]::new($true))
    }catch{Write-Verbose 'Progress display unavailable; installation continues in console.'}
}
function Start-InstallationProgress {
    try{
        $progressRoot=Join-Path ([IO.Path]::GetTempPath()) ('yingce-install-'+[guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $progressRoot -Force | Out-Null
        $script:progressState=Join-Path $progressRoot 'state.json'
        $uiPath=Join-Path $progressRoot 'progress.ps1'
        $ui=@'
param([string]$StatePath,[int]$InstallerProcessId)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form
$form.Text='影策 · 安装进度'
$form.ClientSize=New-Object Drawing.Size(560,260)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.BackColor=[Drawing.Color]::FromArgb(248,248,250)
$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$title=New-Object Windows.Forms.Label
$title.SetBounds(24,22,510,30)
$title.Font=New-Object Drawing.Font('Microsoft YaHei UI',13,[Drawing.FontStyle]::Bold)
$title.Text='正在准备安装'
$bar=New-Object Windows.Forms.ProgressBar
$bar.SetBounds(24,72,512,16)
$detail=New-Object Windows.Forms.Label
$detail.SetBounds(24,104,512,90)
$note=New-Object Windows.Forms.Label
$note.SetBounds(24,208,512,44)
$note.ForeColor=[Drawing.Color]::DimGray
$note.Text='关闭此窗口不影响安装。详细日志仍在原安装窗口显示。'
$form.Controls.AddRange(@($title,$bar,$detail,$note))
$script:samples=New-Object 'System.Collections.Generic.List[object]'
$script:lastFile=''
function Update-ProgressView($state){
    $title.Text=$state.Stage
    $detail.Text=$state.Detail
    $bar.Style='Marquee'
    if($null -ne $state.Percent -and $state.Percent -ge 0){$bar.Style='Continuous';$bar.Value=[Math]::Min(100,[Math]::Max(0,[int]$state.Percent))}
    if($state.File){
        if($script:lastFile -ne $state.File){$script:samples.Clear();$script:lastFile=$state.File}
        $file=Get-Item -LiteralPath $state.File -ErrorAction SilentlyContinue
        $bytes=if($file){$file.Length}else{0}
        $total=0L
        if($state.Headers -and (Test-Path -LiteralPath $state.Headers)){
            $headers=[IO.File]::ReadAllText($state.Headers)
            $ranges=[regex]::Matches($headers,'(?im)^content-range:\s*bytes\s+\d+-\d+/(\d+)')
            $lengths=[regex]::Matches($headers,'(?im)^content-length:\s*(\d+)')
            if($ranges.Count){$total=[long]$ranges[$ranges.Count-1].Groups[1].Value}
            elseif($lengths.Count){$total=[long]$lengths[$lengths.Count-1].Groups[1].Value}
        }
        $now=Get-Date
        $script:samples.Add(@{Time=$now;Bytes=$bytes})
        while($script:samples.Count -gt 12){$script:samples.RemoveAt(0)}
        $seconds=($now-$script:samples[0].Time).TotalSeconds
        $speed=if($seconds -gt 0){[Math]::Max(0,($bytes-$script:samples[0].Bytes)/$seconds)}else{0}
        $amount='{0:N2} MB' -f ($bytes/1MB)
        if($total -gt 0){
            $percent=[Math]::Min(100,100*$bytes/$total)
            $bar.Style='Continuous';$bar.Value=[int]$percent
            $amount='{0:N1}%  ·  {1:N2} / {2:N2} MB' -f $percent,($bytes/1MB),($total/1MB)
        }
        $rate=if($speed -gt 0){'{0:N1} KB/s' -f ($speed/1KB)}else{'等待数据'}
        $eta=if($speed -gt 0 -and $total -gt $bytes){'预计剩余 {0:N0} 秒' -f (($total-$bytes)/$speed)}else{'正在连接或等待服务器响应'}
        $detail.Text="$($state.Detail)`r`n$amount  ·  $rate`r`n$eta"
    }
    if($state.Done){$timer.Stop()}
}
$timer=New-Object Windows.Forms.Timer
$timer.Interval=1000
$timer.Add_Tick({
    try{
        $state=Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        Update-ProgressView $state
        if(!$state.Done -and !(Get-Process -Id $InstallerProcessId -ErrorAction SilentlyContinue)){
            $title.Text='安装进程已结束'
            $detail.Text='未收到完成确认，请查看原安装窗口的结果。'
            $timer.Stop()
        }
    }catch{ # A status file may be replaced while the timer reads it; retry next tick.
    }
})
$form.Add_Shown({$timer.Start()})
$form.Add_FormClosed({$timer.Stop();$timer.Dispose()})
[void]$form.ShowDialog()
$form.Dispose()
'@
        [IO.File]::WriteAllText($uiPath,$ui,[Text.UTF8Encoding]::new($true))
        Set-InstallProgress '正在读取版本信息' '正在连接更新服务器，请稍候。'
        $arguments='-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$uiPath+'" -StatePath "'+$script:progressState+'" -InstallerProcessId '+$PID
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    }catch{Write-Warning 'Progress window unavailable. See the installation console for progress.'}
}
# END EMBEDDED INSTALLATION PROGRESS
function Receive-ReleaseFile([string]$Name,[string]$Destination,[string]$ExpectedHash=''){
    if($online){
        $url=$FeedRoot.TrimEnd('/')+'/'+[Uri]::EscapeDataString($Name)
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        $curl=Get-Command curl.exe -ErrorAction SilentlyContinue
        for($attempt=1;$attempt -le 5;$attempt++){
            try{
                if($curl){
                    $headers=$Destination+'.headers'
                    [IO.File]::WriteAllText($headers,'')
                    Set-InstallProgress '正在下载更新文件' ("{0} · 第 {1}/5 次尝试" -f $Name,$attempt) -File $Destination -Headers $headers
                    $downloadArgs=@('--fail','--location','--show-error','--dump-header',$headers,'--proto','=https','--proto-redir','=https','--connect-timeout','30','--max-time','1800','--speed-limit','1024','--speed-time','60','--output',$Destination)
                    # curl does not automatically inherit the Windows Internet proxy.
                    # Honor explicit curl environment settings first; otherwise use the
                    # user's enabled static system proxy for the official GitHub feed.
                    if($url -match '^https://github\.com/' -and !$env:HTTPS_PROXY -and !$env:ALL_PROXY){
                        $settings=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
                        if($settings.ProxyEnable -eq 1 -and $settings.ProxyServer){
                            $proxy=[string]$settings.ProxyServer
                            if($proxy -match '(?:^|;)https=([^;]+)'){$proxy=$Matches[1]}
                            elseif($proxy -match '(?:^|;)http=([^;]+)'){$proxy=$Matches[1]}
                            if($proxy -match '^(?:https?://)?[a-zA-Z0-9.\-]+:\d+$'){
                                if($proxy -notmatch '^https?://'){$proxy='http://'+$proxy}
                                $downloadArgs+=@('--proxy',$proxy)
                                Write-Host 'Using the enabled Windows system proxy for GitHub download.'
                            }
                        }
                    }
                    if($ExpectedHash -and (Test-Path -LiteralPath $Destination)){$downloadArgs+=@('--continue-at','-')}
                    & $curl.Source @downloadArgs $url
                    $downloadExit=$LASTEXITCODE
                    # Servers without Range support require a fresh transfer.
                    if($downloadExit -in @(33,36) -and (Test-Path -LiteralPath $Destination)){Remove-Item -LiteralPath $Destination -Force}
                    if($downloadExit -ne 0){throw "Download transport failed ($downloadExit)"}
                }else{
                    Set-InstallProgress '正在下载更新文件' $Name -File $Destination
                    Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing -TimeoutSec 1800
                }
                Set-InstallProgress '正在校验下载文件' $Name
                if($ExpectedHash -and (Get-ReleaseFileHash $Destination).Hash -ne $ExpectedHash){
                    Remove-Item -LiteralPath $Destination -Force
                    throw 'Downloaded archive checksum mismatch'
                }
                return
            }catch{
                if($attempt -eq 5){throw "Unable to download $Name after 5 attempts. Previous installation is unchanged. Check the network and run the updater again; partial archives resume automatically."}
                Write-Host "Download interrupted; retrying $Name ($attempt/5)..."
                Set-InstallProgress '下载中断，准备重试' ("第 {0}/5 次尝试失败；已下载的有效数据会继续使用。" -f $attempt)
                Start-Sleep -Seconds ([Math]::Min($attempt*2,10))
            }
        }
    }else{Copy-Item -LiteralPath (Join-Path $FeedRoot $Name) -Destination $Destination -Force}
}
function Get-ReleaseFileHash([string]$LiteralPath){
    $stream=[IO.File]::OpenRead($LiteralPath)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return @{Hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}}
    finally{$sha.Dispose();$stream.Dispose()}
}
Start-InstallationProgress
trap {Set-InstallProgress '更新未完成' $_.Exception.Message -Done $true;throw $_}
Write-Host 'Reading release information. First installation may take several minutes...'
if($online){
    $manifestTemp=[IO.Path]::GetTempFileName()
    try{Receive-ReleaseFile 'latest.json' $manifestTemp;$releaseInfo=Get-Content -LiteralPath $manifestTemp -Raw -Encoding UTF8 | ConvertFrom-Json}
    finally{Remove-Item -LiteralPath $manifestTemp -Force}
}else{$releaseInfo=Get-Content -LiteralPath (Join-Path $FeedRoot 'latest.json') -Raw -Encoding UTF8 | ConvertFrom-Json}
if ($releaseInfo.version -notmatch '^\d+\.\d+\.\d+$') {throw 'Invalid release version'}
if ($releaseInfo.version -eq '1.3.17') {throw 'Version 1.3.17 is disabled. Use 1.3.18 or a later verified release.'}
if(!$releaseInfo.files -or $releaseInfo.files.Count -eq 0){throw 'Empty release manifest'}
if($online -and !$releaseInfo.archive){throw 'Online release must contain an archive'}
if($online){$sourceRoot=''}else{$sourceRoot=[IO.Path]::GetFullPath((Join-Path $FeedRoot ('releases\'+$releaseInfo.version)))}
if(!$online -and (Test-Path -LiteralPath (Join-Path $FeedRoot 'release.json')) -and !$releaseInfo.archive){
    $localRelease=Get-Content -LiteralPath (Join-Path $FeedRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if($localRelease.version -ne $releaseInfo.version){throw 'Local release version mismatch'}
    $sourceRoot=[IO.Path]::GetFullPath($FeedRoot)
}
$portablePython=''
$portableInstaller=''
$deltaBase=''
$deltaMode=$false
if($releaseInfo.delta -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'current.txt'))){
    $installed=(Get-Content -LiteralPath (Join-Path $InstallRoot 'current.txt') -Raw).Trim()
    if($installed -match '^\d+\.\d+\.\d+$'){
        $deltaBase=Join-Path $InstallRoot ('versions\'+$installed)
        $deltaMode=$true
        Set-InstallProgress '正在检查现有版本' '检查能否使用差量更新。'
        $baseChecked=0
        foreach($item in $releaseInfo.files){
            $baseChecked++
            if($baseChecked % 100 -eq 0){Set-InstallProgress '正在检查现有版本' ("{0} / {1} 个文件" -f $baseChecked,$releaseInfo.files.Count) -Percent ([int](100*$baseChecked/$releaseInfo.files.Count))}
            if($item.path -in $releaseInfo.delta.paths){continue}
            $existing=[IO.Path]::GetFullPath((Join-Path $deltaBase $item.path))
            if(!$existing.StartsWith($deltaBase+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid delta path'}
            if(!(Test-Path -LiteralPath $existing) -or (Get-ReleaseFileHash $existing).Hash -ne $item.sha256){$deltaMode=$false;break}
        }
    }
}
if($deltaMode){
    if($releaseInfo.delta.archive -ne ('Yingce-'+$releaseInfo.version+'-from-'+$releaseInfo.delta.baseVersion+'-delta.zip')){throw 'Invalid delta archive'}
    $releaseInfo.archive=$releaseInfo.delta.archive
    $releaseInfo.archiveSha256=$releaseInfo.delta.sha256
    Write-Host 'Verified installed files; downloading incremental update.'
}
if($releaseInfo.archive){
    if(!$deltaMode -and $releaseInfo.archive -ne ('Yingce-'+$releaseInfo.version+'-win-x64.zip')){throw 'Invalid archive name'}
    if($releaseInfo.archiveSha256 -notmatch '^[A-Fa-f0-9]{64}$'){throw 'Invalid archive checksum'}
    $cache=Join-Path $InstallRoot ('cache\'+$releaseInfo.version)
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $archivePath=Join-Path $cache $releaseInfo.archive
    if(!(Test-Path -LiteralPath $archivePath) -or (Get-ReleaseFileHash -LiteralPath $archivePath).Hash -ne $releaseInfo.archiveSha256){
        Write-Host 'Downloading the release archive...'
        Receive-ReleaseFile $releaseInfo.archive ($archivePath+'.partial') $releaseInfo.archiveSha256
        if((Get-ReleaseFileHash -LiteralPath ($archivePath+'.partial')).Hash -ne $releaseInfo.archiveSha256){throw 'Archive checksum mismatch. Previous installation was preserved.'}
        Move-Item -LiteralPath ($archivePath+'.partial') -Destination $archivePath -Force
    }
    Write-Host 'Extracting and verifying the release locally...'
    Set-InstallProgress '正在解压更新包' '下载已完成，正在处理本地文件。'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $sourceRoot=Join-Path $cache ('unpack-'+[guid]::NewGuid().ToString('N'))
    $zip=[IO.Compression.ZipFile]::OpenRead($archivePath)
    try{
        foreach($entry in $zip.Entries){
            if([version]$releaseInfo.version -ge [version]'1.3.19'){
                if($entry.FullName -match '^[/\\]|(^|[/\\])\.\.($|[/\\])|:'){throw 'Invalid archive entry'}
            }else{
                $entryPath=[IO.Path]::GetFullPath((Join-Path $sourceRoot $entry.FullName))
                if(!$entryPath.StartsWith($sourceRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid archive entry'}
            }
        }
        if([version]$releaseInfo.version -ge [version]'1.3.19'){
            $bootstrap=Join-Path $cache 'installer-runtime'
            New-Item -ItemType Directory -Force -Path $bootstrap | Out-Null
            foreach($entry in $zip.Entries){
                if($entry.FullName -match '^runtime/python/[^/]+$' -and $entry.FullName -match '\.(exe|dll|pyd|zip|_pth)$'){
                    $bootFile=Join-Path $bootstrap ([IO.Path]::GetFileName($entry.FullName))
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$bootFile,$true)
                }
                if($entry.FullName -eq 'backend/desktop-state/portable-install.py'){
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $bootstrap 'portable-install.py'),$true)
                }
            }
            $portablePython=Join-Path $bootstrap 'python.exe'
            $portableInstaller=Join-Path $bootstrap 'portable-install.py'
            if(!(Test-Path -LiteralPath $portablePython) -or !(Test-Path -LiteralPath $portableInstaller)){throw 'Portable installer runtime missing'}
        }
    }finally{$zip.Dispose()}
    if($portablePython){
        & $portablePython -I -S $portableInstaller extract --archive $archivePath --root $sourceRoot
        if($LASTEXITCODE -ne 0){throw 'Release extraction failed. Previous installation preserved.'}
    }else{[IO.Compression.ZipFile]::ExtractToDirectory($archivePath,$sourceRoot)}
    if($deltaMode){
        $reconstructed=0
        foreach($item in $releaseInfo.files){
            $reconstructed++
            if($reconstructed % 100 -eq 0){Set-InstallProgress '正在合并差量文件' ("{0} / {1} 个文件" -f $reconstructed,$releaseInfo.files.Count) -Percent ([int](100*$reconstructed/$releaseInfo.files.Count))}
            if($item.path -in $releaseInfo.delta.paths){continue}
            $target=[IO.Path]::GetFullPath((Join-Path $sourceRoot $item.path))
            if(!$target.StartsWith($sourceRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid delta destination'}
            New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
            Copy-Item -LiteralPath (Join-Path $deltaBase $item.path) -Destination $target
        }
    }
}
$versionRoot=[IO.Path]::GetFullPath((Join-Path $InstallRoot ('versions\'+$releaseInfo.version)))
New-Item -ItemType Directory -Force -Path $versionRoot | Out-Null
if(!$portablePython -and [version]$releaseInfo.version -ge [version]'1.3.19'){
    $localPython=Join-Path $sourceRoot 'runtime/python/python.exe'
    $localInstaller=Join-Path $sourceRoot 'backend/desktop-state/portable-install.py'
    if((Test-Path -LiteralPath $localPython) -and (Test-Path -LiteralPath $localInstaller)){$portablePython=$localPython;$portableInstaller=$localInstaller}
}
Set-InstallProgress '正在校验程序文件' '逐个核对文件完整性，请稍候。'
if($portablePython){
    & $portablePython -I -S $portableInstaller verify --root $sourceRoot
    if($LASTEXITCODE -ne 0){throw 'Release validation failed. Previous installation preserved.'}
}else{
$validated=0
foreach($item in $releaseInfo.files){
    if($item.path -notmatch '^(app|runtime|web|backend|plugin-packages)[\\/]' -and $item.path -notin @('release.json','install.ps1','安装或更新.cmd','使用说明.md','update.cmd')){throw 'Release contains a disallowed path'}
    $source=[IO.Path]::GetFullPath((Join-Path $sourceRoot $item.path))
    $target=[IO.Path]::GetFullPath((Join-Path $versionRoot $item.path))
    if(!$source.StartsWith($sourceRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or !$target.StartsWith($versionRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid release path'}
    if((Get-ReleaseFileHash -LiteralPath $source).Hash -ne $item.sha256){throw ('Release file checksum mismatch: '+$item.path)}
    $validated++
    if($validated % 100 -eq 0){Write-Progress -Activity 'Verifying release files' -Status "$validated / $($releaseInfo.files.Count)" -PercentComplete ($validated*100/$releaseInfo.files.Count)}
}
Write-Progress -Activity 'Verifying release files' -Completed
}
Set-InstallProgress '正在准备安装' '如影策正在运行，将等待窗口正常关闭。'
# Close only this per-user installed application. Existing project deployments
# outside this installation are never selected, and an unclosed window aborts.
$running=@(Get-Process Yingce -ErrorAction SilentlyContinue | Where-Object {$_.Path -and $_.Path.StartsWith((Join-Path $InstallRoot 'versions')+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0})
foreach($process in $running){$null=$process.CloseMainWindow();if(!$process.WaitForExit(15000)){throw 'Please save your work and close Yingce before updating.'}}
Set-InstallProgress '正在安装程序文件' '正在写入新版本，个人数据会保留。'
if($portablePython){
    & $portablePython -I -S $portableInstaller install --root $sourceRoot --destination $versionRoot
    if($LASTEXITCODE -ne 0){throw 'Portable installation failed. Previous version remains selected.'}
}else{
$copied=0
foreach($item in $releaseInfo.files){
    $copied++
    if($copied % 100 -eq 0){Write-Progress -Activity 'Installing release files' -Status "$copied / $($releaseInfo.files.Count)" -PercentComplete ($copied*100/$releaseInfo.files.Count)}
    $source=Join-Path $sourceRoot $item.path;$target=Join-Path $versionRoot $item.path
    if((Test-Path -LiteralPath $target) -and (Get-ReleaseFileHash -LiteralPath $target).Hash -eq $item.sha256){continue}
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    if((Get-ReleaseFileHash -LiteralPath $target).Hash -ne $item.sha256){throw 'Installed file checksum mismatch'}
}
Write-Progress -Activity 'Installing release files' -Completed
}
Set-InstallProgress '正在完成更新' '正在保存启动配置。'
# Restore the captured prompt templates and protocols before activating this version.
if ($releaseInfo.portableState) {
    if ($releaseInfo.portableState -ne 'backend/desktop-state/apply-state.mjs') {throw 'Invalid state migration entry'}
    & (Join-Path $versionRoot 'runtime/node/node.exe') (Join-Path $versionRoot $releaseInfo.portableState) --install-root $InstallRoot
    if ($LASTEXITCODE -ne 0) {throw 'Desktop prompt/protocol migration failed. Previous version remains selected.'}
}
# Keep the installer locally, including its embedded progress window.
$installerPath=Join-Path $InstallRoot 'install.ps1'
if([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($installerPath)){Copy-Item -LiteralPath $PSCommandPath -Destination $installerPath -Force}
$nextFeed=if($online){$FeedRoot}else{'https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/latest/download'}
$nextFeed | Set-Content -LiteralPath (Join-Path $InstallRoot 'update-source.txt') -Encoding UTF8
$updater=@'
$ErrorActionPreference='Stop'
$feed=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update-source.txt') -Raw -Encoding UTF8).Trim()
$installer=Join-Path $PSScriptRoot 'install.ps1'
# Refresh only from the configured official repository, with GitHub's asset digest.
if($feed -eq 'https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/latest/download'){
    $pending=$installer+'.pending'
    try{
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        Write-Host 'Checking installer updates...'
        $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/yongchengjiao2-ctrl/yingce-desktop-releases/releases/latest' -TimeoutSec 20
        $asset=$release.assets | Where-Object {$_.name -eq 'install.ps1'} | Select-Object -First 1
        if(!$asset -or $asset.digest -notmatch '^sha256:([a-fA-F0-9]{64})$'){throw 'Installer digest unavailable'}
        $expected=$Matches[1]
        Invoke-WebRequest -Uri ($feed+'/install.ps1') -OutFile $pending -UseBasicParsing -TimeoutSec 30
        if((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash -ne $expected){throw 'Installer checksum mismatch'}
        $tokens=$null;$errors=$null
        [void][Management.Automation.Language.Parser]::ParseFile($pending,[ref]$tokens,[ref]$errors)
        if($errors.Count){throw 'Invalid installer script'}
        Move-Item -LiteralPath $pending -Destination $installer -Force
    }catch{Write-Warning 'Installer refresh unavailable; continuing with the existing local installer.'}
    finally{if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending -Force}}
}
& (Join-Path $PSScriptRoot 'install.ps1') -FeedRoot $feed -InstallRoot $PSScriptRoot
'@
$updater | Set-Content -LiteralPath (Join-Path $InstallRoot 'update.ps1') -Encoding UTF8
$updateCommand="@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0update.ps1`"`r`nif errorlevel 1 pause`r`n"
[IO.File]::WriteAllText((Join-Path $InstallRoot 'update.cmd'),$updateCommand,[Text.UTF8Encoding]::new($false))
$releaseInfo.version | Set-Content -LiteralPath (Join-Path $InstallRoot 'current.txt') -Encoding ASCII
$launch=@'
$ErrorActionPreference='Stop'
$version=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.txt') -Raw).Trim()
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid installed version'}
$env:YINGCE_DESKTOP_DATA_DIR=$PSScriptRoot
Start-Process -FilePath (Join-Path $PSScriptRoot "versions\$version\app\Yingce.exe") -WorkingDirectory (Join-Path $PSScriptRoot "versions\$version") -WindowStyle Normal
'@
$launch | Set-Content -LiteralPath (Join-Path $InstallRoot 'launch.ps1') -Encoding UTF8
if(!$NoShortcut){
    $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '影策个人版.lnk'))
    $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $InstallRoot 'launch.ps1')+'"'
    $shortcut.WorkingDirectory=$InstallRoot
    $shortcut.IconLocation=Join-Path $versionRoot 'app\Yingce.exe'
    $shortcut.Save()
}
Write-Host ('Installed Yingce '+$releaseInfo.version+'. Personal data and API keys were preserved.')
Set-InstallProgress '更新完成' ('影策 v'+$releaseInfo.version+' 已安装，个人数据已保留。') -Percent 100 -Done $true
if(!$NoLaunch){& (Join-Path $InstallRoot 'launch.ps1')}
