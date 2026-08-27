<#
  LOTTO LAB · 모바일 접속 서버
  ------------------------------------------------------------------
  이 PC에서 lotto-lab.html 을 HTTP 로 띄웁니다.
  Tailscale 이 켜져 있으면 폰에서 http://<Tailscale IP>:8765 로 접속됩니다.

  왜 이게 필요한가
    - file:// 로 열면 브라우저가 외부 요청(동행복권 API)을 막습니다.
    - HttpListener 는 관리자 권한이 필요하지만 TcpListener 는 필요 없습니다.
      그래서 여기서는 TcpListener 로 직접 HTTP 를 구현했습니다.

  실행:  powershell -ExecutionPolicy Bypass -File serve.ps1
        또는 [모바일서버-켜기.bat] 더블클릭
#>
param([int]$Port = 8765)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-TailscaleIP {
    try {
        $o = & tailscale ip -4 2>$null
        if ($o) { return ($o | Select-Object -First 1).Trim() }
    } catch {}
    try {
        $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Where-Object { $_.IPAddress -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' } |
             Select-Object -First 1
        if ($a) { return $a.IPAddress }
    } catch {}
    return $null
}
function Get-LanIP {
    try {
        $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } |
             Select-Object -First 1
        if ($a) { return $a.IPAddress }
    } catch {}
    return $null
}
function Get-Mime([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLower()) {
        '.html' { 'text/html; charset=utf-8' }
        '.htm'  { 'text/html; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg'  { 'image/svg+xml' }
        '.png'  { 'image/png' }
        '.ico'  { 'image/x-icon' }
        default { 'application/octet-stream' }
    }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try { $listener.Start() }
catch { Write-Host "포트 $Port 를 열 수 없습니다: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

$ts  = Get-TailscaleIP
$lan = Get-LanIP
Write-Host ""
Write-Host "  LOTTO LAB 서버 시작" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────"
Write-Host "  이 PC     http://localhost:$Port/"
if ($lan) { Write-Host "  같은 와이파이  http://${lan}:$Port/" }
if ($ts)  { Write-Host "  Tailscale  http://${ts}:$Port/" -ForegroundColor Cyan }
else      { Write-Host "  Tailscale IP 를 찾지 못했습니다 (tailscale up 확인)" -ForegroundColor Yellow }
Write-Host "  ─────────────────────────────────────────────"
Write-Host "  중지: Ctrl+C"
Write-Host ""

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()
      $buf = New-Object byte[] 8192
      $sb  = New-Object System.Text.StringBuilder
      do {
        $n = $stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
      } while ($stream.DataAvailable -and $sb.ToString() -notmatch "`r`n`r`n")

      $req = $sb.ToString()
      if ($req -notmatch '^(GET|HEAD)\s+(\S+)') { $client.Close(); continue }
      $rawPath = $Matches[2]
      $urlPath = ($rawPath -split '\?')[0]
      if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/index.html' }
      $urlPath = [System.Uri]::UnescapeDataString($urlPath)

      $safe = $urlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $root $safe))

      $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      } else {
        $body = [IO.File]::ReadAllBytes($full)
        $mime = Get-Mime $full
        $head = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        Write-Host ("  {0}  {1}  {2:N0}B" -f (Get-Date -Format 'HH:mm:ss'), $urlPath, $body.Length) -ForegroundColor DarkGray
      }
      $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($hb, 0, $hb.Length)
      if ($req -notmatch '^HEAD') { $stream.Write($body, 0, $body.Length) }
      $stream.Flush()
    } catch {
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  Write-Host "  서버를 중지했습니다."
}
