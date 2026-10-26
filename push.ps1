<#
  LOTTO LAB · GitHub 올리기
  ------------------------------------------------------------------
  하는 일
    1) 이 저장소만의 준비: 워크플로 사본 배치, 병합 충돌 표식 검사
    2) 올리기 엔진(옆 폴더 develop\tools\github-upload.ps1)에 넘긴다:
       공개 전 점검 → 커밋 → 원격(Actions 자동 커밋)과 합치기 → 푸시
       계정은 gh 에 로그인된 ljo0527 토큰을 이 실행에서만 쓴다(처음 한 번만 브라우저 로그인).

  실행:  [깃허브-올리기.bat] 더블클릭
  옵션:  -NoCommit  커밋된 것만 올림      -Trial  시험 가지에서 Actions 성공을 본 뒤 main
         -Wait      main 의 Actions 결과까지 기다림   -Check  점검만   -NoPause  끝에 멈추지 않음
#>
param(
    [switch]$NoCommit,
    [switch]$Trial,
    [switch]$Wait,
    [switch]$Check,
    [switch]$NoLogin,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $root

function Pause-Exit([int]$code=0){ if (-not $NoPause) { Write-Host ""; Read-Host "  Enter 를 누르면 닫힙니다" | Out-Null }; exit $code }
function Fail($m){ Write-Host "  $m" -ForegroundColor Red; Pause-Exit 1 }

Write-Host ""
Write-Host "  LOTTO LAB → GitHub" -ForegroundColor Green

try {
# ── 폴더 정리 ───────────────────────────────────────────────
if ((Test-Path 'index.html') -and (Test-Path 'lotto-lab.html')) {
    if ($Check) { Write-Host "  (점검) lotto-lab.html 은 올릴 때 지웁니다 (index.html 로 통합됨)" }
    else {
        Remove-Item 'lotto-lab.html' -Force
        Write-Host "  정리: lotto-lab.html 제거 (index.html 로 통합됨)"
    }
}

# ── GitHub Actions 워크플로 배치 ────────────────────────────
#   .github 폴더는 원격 도구가 쓸 수 없어 setup\workflows 에 담아 두었습니다.
#   내용은 setup\workflows\*.yml 을 열어 먼저 확인할 수 있습니다.
#   .github 쪽만 더 최근에 고쳐져 있으면 덮어쓰지 않고 멈춥니다(고친 내용이 옛 사본으로 되돌아가 올라가는 것을 막기 위해).
$srcWf = Join-Path $root 'setup\workflows'
$dstWf = Join-Path $root '.github\workflows'
if (Test-Path $srcWf) {
    if (-not (Test-Path $dstWf) -and -not $Check) { New-Item -ItemType Directory -Path $dstWf -Force | Out-Null }
    foreach ($src in @(Get-ChildItem $srcWf -Filter '*.yml')) {
        $dst = Join-Path $dstWf $src.Name
        $exists = Test-Path $dst
        $changed = -not $exists -or ((Get-FileHash $src.FullName).Hash -ne (Get-FileHash $dst).Hash)
        if (-not $changed) { continue }
        if ($exists -and ((Get-Item $dst).LastWriteTime -gt $src.LastWriteTime)) {
            Fail ".github\workflows\$($src.Name) 이 setup\workflows 쪽보다 최근에 고쳐져 있습니다. setup\workflows\$($src.Name) 에 같은 내용을 반영한 뒤 다시 실행하세요."
        }
        if ($Check) { Write-Host "  (점검) 올릴 때 배치: .github\workflows\$($src.Name)" -ForegroundColor DarkGray; continue }
        Copy-Item $src.FullName $dst -Force
        Write-Host "  워크플로 배치: .github\workflows\$($src.Name)" -ForegroundColor DarkGray
    }
}

# ── 병합 충돌 표식 검사 ─────────────────────────────────────
#   [2026-09-03] lotto-history.json 에 «<<<<<<< HEAD» 가 그대로 박힌 채
#   커밋·배포된 적이 있습니다. 원인은 이 파일을 두 곳에서 쓰기 때문입니다 —
#   이 PC(데이터-갱신.bat · 예약 작업)와 GitHub Actions 스냅샷 작업.
#   한 줄짜리 JSON 이라 git 이 자동 병합을 못 하고, 깨진 파일이 그대로 올라갑니다.
#   근본 대책은 「쓰는 곳을 하나로」(update-data.yml 의 자동 실행을 껐습니다) 이고,
#   여기서는 깨진 파일이 배포되지 않도록 한 번 더 막습니다.
#   파일 전체를 본다(긴 html 의 뒤쪽 충돌도 잡히게).
$conf = @()
$exts = @('.json','.html','.md','.mjs','.js','.ps1','.yml','.bat','.css','.svg','.webmanifest','.ics','.txt')
Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object {
    $exts -contains $_.Extension.ToLower() -and
    $_.FullName -notlike "*\.git\*" -and $_.FullName -notlike "*\node_modules\*" -and $_.FullName -notlike "*\.lab\*"
  } |
  ForEach-Object {
    if (Select-String -LiteralPath $_.FullName -Pattern '^(<{7}|>{7}) ' -List -ErrorAction SilentlyContinue) {
      $conf += $_.FullName.Substring($root.Length + 1)
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
} catch {
    Fail "준비 단계에서 멈췄습니다: $($_.Exception.Message)"
}

# ── 올리기 엔진 ─────────────────────────────────────────────
#   [2026-09-23] 추천·브리핑·검증 보드는 GitHub Actions(weekly.yml)가 계산해 main 에 직접 커밋합니다.
#   그래서 원격이 이 PC 보다 앞서 있는 게 정상입니다. 엔진이 먼저 당겨와 그 위에 얹고,
#   Actions 가 커밋하는 결과물 파일(weekly.yml '결과 커밋' 단계의 경로)이 충돌하면 원격 쪽을 남깁니다.
#   그 밖의 파일이 충돌하면 합치지 않고 멈춥니다.
#   이름 검사 금지어(.lab\banned-names.txt, git 제외)는 실행마다 Actions 시크릿 CHECK_NAMES_LIST 로 다시 등록됩니다.
$engine = Join-Path (Split-Path -Parent $root) 'develop\tools\github-upload.ps1'
if (-not (Test-Path -LiteralPath $engine)) {
    Fail "올리기 엔진이 없습니다: $engine`n  develop 저장소를 이 폴더 옆에 두세요(https://github.com/ljo0527/develop)."
}
$ea = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $engine, '-Repo', $root, '-NoPause',
        '-PreferRemotePaths', 'brief.html,brief/**,validate.html,lotto-history.json,lotto-order.json')
if (-not $NoCommit) { $ea += '-Commit' }
$names = Join-Path $root '.lab\banned-names.txt'
if (Test-Path -LiteralPath $names) { $ea += @('-NamesSecretFile', $names, '-RenewNamesSecret') }
elseif (-not $Check) { Write-Host "  .lab\banned-names.txt 가 없어 CI 이름 검사는 이미 등록된 시크릿을 씁니다." -ForegroundColor Yellow }
if ($Trial)   { $ea += '-Trial' }
if ($Wait)    { $ea += '-Wait' }
if ($Check)   { $ea += '-Check' }
if ($NoLogin) { $ea += '-NoLogin' }
& powershell @ea
Pause-Exit $LASTEXITCODE
