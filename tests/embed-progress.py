"""Embed the progress UI so the public installer remains a single PS1 download."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
path=root/'install.ps1'
text=path.read_text(encoding='utf-8-sig')
ui=(root/'installer-progress-ui.ps1').read_text(encoding='utf-8-sig').rstrip()
start='# BEGIN EMBEDDED INSTALLATION PROGRESS'
end='# END EMBEDDED INSTALLATION PROGRESS'
block='''# BEGIN EMBEDDED INSTALLATION PROGRESS
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
UI_CONTENT
'@
        [IO.File]::WriteAllText($uiPath,$ui,[Text.UTF8Encoding]::new($true))
        Set-InstallProgress '正在读取版本信息' '正在连接更新服务器，请稍候。'
        $arguments='-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$uiPath+'" -StatePath "'+$script:progressState+'" -InstallerProcessId '+$PID
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    }catch{Write-Warning 'Progress window unavailable. See the installation console for progress.'}
}
# END EMBEDDED INSTALLATION PROGRESS'''.replace('UI_CONTENT',ui)
if start in text:
    a=text.index(start);b=text.index(end,a)+len(end)
    text=text[:a]+block+text[b:]
else:
    pos=text.index('function Receive-ReleaseFile')
    text=text[:pos]+block+'\n'+text[pos:]
path.write_text(text,encoding='utf-8-sig',newline='\r\n')
