<#
  LOTTO LAB · 데이터 갱신 (백업 경로)
  ------------------------------------------------------------------
  동행복권 공식 엔드포인트에서 1회~최신회차 전량을 받아
  lotto-history.json 으로 저장합니다.

  HTML 툴은 평소 스스로 API 를 부르므로 이 스크립트는 없어도 됩니다.
  브라우저가 외부 요청을 막거나 사이트 구조가 바뀌었을 때의 안전망입니다.

  실행:  powershell -ExecutionPolicy Bypass -File update.ps1
        또는 [데이터-갱신.bat] 더블클릭
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$out  = Join-Path $root 'lotto-history.json'
$api  = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd='

function Get-Page([int]$center) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            $r = Invoke-RestMethod -Uri ($api + $center) -UseBasicParsing -TimeoutSec 20
            if ($r.data -and $r.data.list) { return $r.data.list }
            return @()
        } catch { Start-Sleep -Milliseconds (400 * $try) }
    }
    return @()
}

Write-Host ""
Write-Host "  최신 회차 확인 중…" -ForegroundColor Cyan
$latest = 1238
for ($step = 0; $step -lt 40; $step++) {
    $l = Get-Page ($latest + 5)
    if (-not $l -or $l.Count -eq 0) { break }
    $m = ($l | Measure-Object -Property ltEpsd -Maximum).Maximum
    if ($m -gt $latest) { $latest = $m } else { break }
}
Write-Host "  최신 회차: $latest" -ForegroundColor Green

$rows = @{}
$centers = @()
for ($e = $latest; $e -ge 8; $e -= 10) { $centers += $e }
$centers += 1
$i = 0
foreach ($c in $centers) {
    $i++
    Write-Progress -Activity "동행복권 수집" -Status "$i / $($centers.Count)" -PercentComplete ($i * 100 / $centers.Count)
    foreach ($o in (Get-Page $c)) { $rows[[int]$o.ltEpsd] = $o }
}
Write-Progress -Activity "동행복권 수집" -Completed

$missing = @()
for ($e = 1; $e -le $latest; $e++) { if (-not $rows.ContainsKey($e)) { $missing += $e } }
if ($missing.Count -gt 0) {
    Write-Host "  누락 $($missing.Count) 회차 재시도…" -ForegroundColor Yellow
    foreach ($e in $missing) { foreach ($o in (Get-Page $e)) { $rows[[int]$o.ltEpsd] = $o } }
    $missing = @()
    for ($e = 1; $e -le $latest; $e++) { if (-not $rows.ContainsKey($e)) { $missing += $e } }
}

$draws = @()
for ($e = 1; $e -le $latest; $e++) {
    if (-not $rows.ContainsKey($e)) { continue }
    $o = $rows[$e]
    $draws += [ordered]@{
        round   = [int]$o.ltEpsd
        date    = [string]$o.ltRflYmd
        numbers = @([int]$o.tm1WnNo, [int]$o.tm2WnNo, [int]$o.tm3WnNo, [int]$o.tm4WnNo, [int]$o.tm5WnNo, [int]$o.tm6WnNo)
        bonus   = [int]$o.bnsWnNo
        winners = [ordered]@{ first=[int]$o.rnk1WnNope; second=[int]$o.rnk2WnNope; third=[int]$o.rnk3WnNope; fourth=[int]$o.rnk4WnNope; fifth=[int]$o.rnk5WnNope }
        prize   = [ordered]@{ first=[double]$o.rnk1WnAmt; second=[double]$o.rnk2WnAmt; third=[double]$o.rnk3WnAmt; fourth=[double]$o.rnk4WnAmt; fifth=[double]$o.rnk5WnAmt }
        sales   = [double]$o.wholEpsdSumNtslAmt
        firstType = [ordered]@{ auto=[int]$o.winType1; manual=[int]$o.winType2; semi=[int]$o.winType3 }
    }
}

$doc = [ordered]@{
    meta = [ordered]@{
        generated = (Get-Date).ToString('o')
        latest    = $latest
        count     = $draws.Count
        source    = 'dhlottery.co.kr /lt645/selectPstLt645InfoNew.do'
    }
    draws = $draws
}
$doc | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $out -Encoding UTF8

Write-Host ""
Write-Host "  저장 완료: $out" -ForegroundColor Green
Write-Host "  회차 $($draws.Count) 건 (1 ~ $latest)"
if ($missing.Count -gt 0) { Write-Host "  누락: $($missing -join ', ')" -ForegroundColor Red }
Write-Host ""
if ($Host.Name -eq 'ConsoleHost') { Write-Host "  아무 키나 누르면 닫힙니다…"; [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }
