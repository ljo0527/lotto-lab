<#
  LOTTO LAB · GitHub 올리기 도우미  (GitHub Desktop 사용자용)
  ------------------------------------------------------------------
  하는 일
    1) 이 폴더를 git 저장소로 준비 (init / 정리 / commit)
    2) 원격 저장소가 이미 연결돼 있으면 push 까지
    3) 아직 연결 전이면, GitHub Desktop 으로 publish 하는 방법을 안내

  git 은 PATH 에 없어도 GitHub Desktop 에 들어 있는 걸 찾아 씁니다.

  실행:  [깃허브-올리기.bat] 더블클릭
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $root

function Pause-Exit([int]$code=0){ Write-Host ""; Read-Host "  Enter 를 누르면 닫힙니다" | Out-Null; exit $code }
function Fail($m){ Write-Host "  $m" -ForegroundColor Red; Pause-Exit 1 }

# ── git 찾기 ────────────────────────────────────────────────
function Find-Git {
    $c = Get-Command git -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $cands = @()
    $ghd = Join-Path $env:LOCALAPPDATA 'GitHubDesktop'
    if (Test-Path $ghd) {
        $cands += Get-ChildItem $ghd -Filter 'app-*' -Directory -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending |
                  ForEach-Object { Join-Path $_.FullName 'resources\app\git\cmd\git.exe' }
    }
    $cands += "$env:ProgramFiles\Git\cmd\git.exe"
    $cands += "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
    $cands += "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
}
$git = Find-Git
if (-not $git) {
    Fail "git 을 찾지 못했습니다.`n  GitHub Desktop 이 설치돼 있는데도 이 메시지가 나오면 Git for Windows 를 설치하세요:`n  https://git-scm.com/download/win"
}
function G { & $git @args }

Write-Host ""
Write-Host "  LOTTO LAB → GitHub" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────"
Write-Host "  git: $git" -ForegroundColor DarkGray

# ── 폴더 정리 ───────────────────────────────────────────────
if ((Test-Path 'index.html') -and (Test-Path 'lotto-lab.html')) {
    Remove-Item 'lotto-lab.html' -Force
    Write-Host "  정리: lotto-lab.html 제거 (index.html 로 통합됨)"
}

# ── GitHub Actions 워크플로 배치 ────────────────────────────
#   .github 폴더는 원격 도구가 쓸 수 없어 setup\workflows 에 담아 두었습니다.
#   내용은 setup\workflows\*.yml 을 열어 먼저 확인할 수 있습니다.
$srcWf = Join-Path $root 'setup\workflows'
$dstWf = Join-Path $root '.github\workflows'
if (Test-Path $srcWf) {
    if (-not (Test-Path $dstWf)) { New-Item -ItemType Directory -Path $dstWf -Force | Out-Null }
    Get-ChildItem $srcWf -Filter '*.yml' | ForEach-Object {
        $dst = Join-Path $dstWf $_.Name
        $changed = -not (Test-Path $dst) -or ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $dst).Hash)
        if ($changed) {
            Copy-Item $_.FullName $dst -Force
            Write-Host "  워크플로 배치: .github\workflows\$($_.Name)" -ForegroundColor DarkGray
        }
    }
}

# ── 병합 충돌 표식 검사 ─────────────────────────────────────
#   [2026-09-03] lotto-history.json 에 «<<<<<<< HEAD» 가 그대로 박힌 채
#   커밋·배포된 적이 있습니다. 원인은 이 파일을 두 곳에서 쓰기 때문입니다 —
#   이 PC(데이터-갱신.bat · 예약 작업)와 GitHub Actions 스냅샷 작업.
#   한 줄짜리 JSON 이라 git 이 자동 병합을 못 하고, 깨진 파일이 그대로 올라갑니다.
#   근본 대책은 「쓰는 곳을 하나로」(update-data.yml 의 자동 실행을 껐습니다) 이고,
#   여기서는 깨진 파일이 배포되지 않도록 한 번 더 막습니다.
$conf = @()
$exts = @('.json','.html','.md','.mjs','.js','.ps1','.yml','.bat')
Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $exts -contains $_.Extension.ToLower() -and
    $_.FullName -notlike "*\.git\*" -and $_.FullName -notlike "*\node_modules\*"
  } |
  ForEach-Object {
    $head = Get-Content -LiteralPath $_.FullName -TotalCount 400 -ErrorAction SilentlyContinue
    foreach ($ln in $head) {
      if ($ln -like '<<<<<<< *' -or $ln -like '>>>>>>> *') {
        $conf += $_.FullName.Substring($root.Length + 1); break
      }
    }
  }
if ($conf.Count -gt 0) {
    Write-Host ""
    Write-Host "  병합 충돌이 해결되지 않은 파일이 있습니다 — 올리지 않고 멈춥니다." -ForegroundColor Red
    $conf | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  고치는 법: 해당 파일을 열어 <<<<<<< / ======= / >>>>>>> 줄을 지우고" -ForegroundColor Yellow
    Write-Host "  남길 쪽 내용만 남기세요. lotto-history.json 이라면 «회차 수가 많은 쪽»이 맞습니다." -ForegroundColor Yellow
    Pause-Exit 1
}

# ── 저장소 준비 ─────────────────────────────────────────────
if (-not (Test-Path '.git')) {
    G init -q
    G branch -M main
    Write-Host "  저장소를 새로 만들었습니다."
}
$un = G config user.name  2>$null
$ue = G config user.email 2>$null
if (-not $un) { G config user.name  "lotto-lab" }
if (-not $ue) { G config user.email "lotto-lab@users.noreply.github.com" }

G add -A
$staged = G diff --cached --name-only
if ($staged) {
    G commit -q -m ("update: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    Write-Host "  커밋 완료 ($(($staged | Measure-Object).Count) 파일)"
} else {
    Write-Host "  변경 없음."
}

# ── 원격 ────────────────────────────────────────────────────
$remote = G remote get-url origin 2>$null
if (-not $remote) {
    Write-Host ""
    Write-Host "  아직 GitHub 저장소와 연결되지 않았습니다." -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────"
    Write-Host "  GitHub Desktop 을 열고:"
    Write-Host "    1. File → Add local repository"
    Write-Host "    2. 이 폴더 선택 →  $root"
    Write-Host "    3. 파란 [Publish repository] 버튼 클릭"
    Write-Host "    4. " -NoNewline; Write-Host "[Keep this code private] 체크를 해제" -ForegroundColor Cyan -NoNewline; Write-Host "  ← 중요 (Pages 무료 조건)"
    Write-Host "    5. Publish"
    Write-Host ""
    Write-Host "  그다음 GitHub 저장소 페이지에서:"
    Write-Host "    Settings → Pages → Build and deployment → Source 를 " -NoNewline
    Write-Host "[GitHub Actions]" -ForegroundColor Cyan -NoNewline; Write-Host " 로 변경"
    Write-Host ""
    Write-Host "  1~2분 뒤 https://<사용자명>.github.io/<저장소명>/ 에서 열립니다."
    Write-Host "  이후에는 이 배치파일만 다시 누르면 자동으로 반영됩니다."
    Pause-Exit
}

Write-Host "  원격: $remote"
# ── 원격 먼저 당겨오기 ──────────────────────────────────────
#   [2026-09-23] 추천·브리핑·검증 보드는 이제 GitHub Actions(weekly.yml)가 계산해 main 에 직접 커밋합니다.
#   그래서 원격이 이 PC 보다 앞서 있는 게 정상입니다. 먼저 당겨와 그 위에 얹습니다.
#   결과물 파일이 충돌하면 원격(=Actions 가 계산한 값)을 남깁니다(-X ours: rebase 에서 ours = 원격).
Write-Host "  원격 변경 당겨오는 중…"
G pull -q --rebase --autostash -X ours origin main
if ($LASTEXITCODE -ne 0) {
    G rebase --abort 2>$null
    Write-Host "  원격과 합치지 못했습니다. GitHub Desktop 에서 [Fetch origin] → [Pull] 후 다시 실행하세요." -ForegroundColor Yellow
    Pause-Exit 1
}
Write-Host "  푸시 중…"
G push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  푸시에 실패했습니다. GitHub Desktop 을 열어 [Push origin] 을 눌러 주세요." -ForegroundColor Yellow
    Pause-Exit 1
}
if ($remote -match 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') {
    Write-Host ""
    Write-Host "  완료." -ForegroundColor Green
    Write-Host "  ─────────────────────────────────────────────"
    Write-Host "  저장소   https://github.com/$($Matches[1])/$($Matches[2])"
    Write-Host "  웹 주소  https://$($Matches[1]).github.io/$($Matches[2])/" -ForegroundColor Cyan
    Write-Host "  배포는 1~2분 걸립니다. Actions 탭에서 진행 상황을 볼 수 있습니다."
}
Pause-Exit
