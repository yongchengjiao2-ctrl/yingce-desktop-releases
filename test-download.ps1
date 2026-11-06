param([string]$Installer=(Join-Path $PSScriptRoot 'install.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Installer syntax is invalid'}
foreach($name in @('Set-InstallProgress','Receive-ReleaseFile','Get-ReleaseFileHash')){
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $node.Extent.Text
}
$fixture=Join-Path $env:TEMP ('yingce-download-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$fake=Join-Path $fixture 'curl.ps1'
@'
$global:downloadTestCalls++
$out=$args[[Array]::IndexOf($args,'--output')+1]
if($global:downloadTestScenario -eq 'interrupt' -and $global:downloadTestCalls -eq 1){
    [IO.File]::WriteAllText($out,'par');$global:LASTEXITCODE=18;return
}
if($global:downloadTestScenario -eq 'interrupt' -and !($args -contains '--continue-at')){throw 'Partial archive was not resumed'}
if($global:downloadTestScenario -eq 'range' -and $global:downloadTestCalls -eq 1){$global:LASTEXITCODE=33;return}
if($global:downloadTestScenario -eq 'range' -and $global:downloadTestCalls -gt 1 -and ($args -contains '--continue-at')){throw 'Unsupported range was not reset'}
if($global:downloadTestScenario -eq 'corrupt' -and $global:downloadTestCalls -eq 1){[IO.File]::WriteAllText($out,'bad');$global:LASTEXITCODE=0;return}
if($global:downloadTestScenario -eq 'offline'){$global:LASTEXITCODE=7;return}
[IO.File]::WriteAllText($out,'complete');$global:LASTEXITCODE=0
'@ | Set-Content -LiteralPath $fake -Encoding UTF8
function Get-Command {param($Name,$ErrorAction) [pscustomobject]@{Source=$fake}}
function Start-Sleep {param($Seconds)}
$online=$true;$FeedRoot='https://example.invalid/releases'
$complete=Join-Path $fixture 'expected'
[IO.File]::WriteAllText($complete,'complete')
$hash=(Get-ReleaseFileHash $complete).Hash
foreach($scenario in @('interrupt','range','corrupt','offline')){
    $global:downloadTestScenario=$scenario;$global:downloadTestCalls=0
    $destination=Join-Path $fixture ($scenario+'.partial')
    if($scenario -in @('interrupt','range')){[IO.File]::WriteAllText($destination,'par')}
    $failed=$false
    try{Receive-ReleaseFile 'release.zip' $destination $hash}catch{
        if($scenario -ne 'offline'){throw}
        $failed=$true
    }
    if($scenario -eq 'offline'){
        if(!$failed -or $global:downloadTestCalls -ne 5){throw 'Retries were not bounded'}
    }elseif((Get-ReleaseFileHash $destination).Hash -ne $hash -or $global:downloadTestCalls -ne 2){throw "Download recovery failed: $scenario"}
}
Write-Host 'PASS: interrupted transfer resumes, unsupported Range restarts, corrupt bytes retry, offline retries are bounded.'
$global:LASTEXITCODE=0
