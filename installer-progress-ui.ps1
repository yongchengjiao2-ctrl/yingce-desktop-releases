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
