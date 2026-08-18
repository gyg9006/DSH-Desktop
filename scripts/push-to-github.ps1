# One-click sync of the DSH-Desktop source to GitHub (gyg9006/DSH-Desktop)
# - Pushes main (merging remote history first with -X ours, so our v2.1.0
#   changes win over the older baseline; remote-only files are kept).
# - Pushes tag v2.1.0, which triggers the release.yml workflow on GitHub
#   Actions (typecheck + tests + pack + prepare:env + zip + SHA256SUMS +
#   GitHub Release upload).
# - Retries up to N times because github.com:443 is intermittently blocked
#   on this network.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1
# ASCII-only content (safe across PowerShell versions).

$ErrorActionPreference = 'Stop'
$Repo   = 'E:\deepseek_harness\DSH-Desktop-2.0.0'
$Remote = 'https://github.com/gyg9006/DSH-Desktop.git'
$Branch = 'main'
# Tag derived from package.json version (regex, avoids non-ASCII parse issues)
$pkgRaw = Get-Content (Join-Path $Repo 'package.json') -Raw
$Tag    = 'v' + [regex]::Match($pkgRaw, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
$MaxAttempts = 8
$WaitSec     = 20

Write-Host "=== DSH-Desktop push to GitHub (tag $Tag) ===" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $Repo '.git'))) {
  git -C $Repo init -b $Branch | Out-Null
  git -C $Repo remote add origin $Remote
  Write-Host 'Repo initialized.'
}

$ok = $false
for ($i = 1; $i -le $MaxAttempts -and -not $ok; $i++) {
  Write-Host "[$i/$MaxAttempts] fetch origin..." -ForegroundColor Yellow
  $job = Start-Job { git -C $using:Repo fetch origin 2>&1 }
  if (Wait-Job $job -Timeout 30) {
    $out = Receive-Job $job
    if (($out -join ' ') -match 'fatal|error') {
      Write-Host "  fetch failed: $($out | Select-Object -First 1)"
    } else {
      git -C $Repo rev-parse --verify -q "origin/$Branch" 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Host '  merging remote history (-X ours)...'
        git -C $Repo -c user.name='DSH Desktop' -c user.email='dsh-desktop@local' merge "origin/$Branch" --allow-unrelated-histories -X ours --no-edit 2>&1 | Select-Object -First 4
      } else {
        Write-Host '  remote has no main branch yet.'
      }
      Write-Host "  pushing $Branch..."
      $pj = Start-Job { git -C $using:Repo push -u origin $using:Branch 2>&1 }
      if (Wait-Job $pj -Timeout 60) {
        $po = Receive-Job $pj
        $po | Select-Object -First 3
        if (($po -join ' ') -notmatch 'rejected|fatal|error') {
          $ok = $true
          Write-Host "  pushing tag $Tag..."
          $tj = Start-Job { git -C $using:Repo push origin $using:Tag 2>&1 }
          if (Wait-Job $tj -Timeout 60) { Receive-Job $tj | Select-Object -First 3 } else { Stop-Job $tj; Remove-Job $tj }
        }
      } else { Stop-Job $pj; Remove-Job $pj; Write-Host '  push timeout.' }
    }
  } else { Stop-Job $job; Remove-Job $job; Write-Host '  fetch timeout.' }

  if (-not $ok) {
    Write-Host "  waiting ${WaitSec}s before retry..."
    Start-Sleep -Seconds $WaitSec
  }
}

if ($ok) {
  Write-Host '=== DONE: main + tag pushed. GitHub Actions (release.yml) will build and upload the v2.1.0 Release. ===' -ForegroundColor Green
  exit 0
}

Write-Host @'

Push did not complete (github.com:443 unreachable from this machine right now).
What is already done locally:
  - Source committed: cf39f1d (227 files, v2.1.0 changes)
  - Tag created:     v2.1.0
  - Release assets:  E:\deepseek_harness\DSH-Desktop\DSH-Desktop-v2.1.0-win.zip (228.8 MB)
                     E:\deepseek_harness\DSH-Desktop\SHA256SUMS

Next steps (pick one when network allows):
  1) Re-run this script: powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1
  2) Or push manually:
       git -C E:\deepseek_harness\DSH-Desktop-2.0.0 push -u origin main
       git -C E:\deepseek_harness\DSH-Desktop-2.0.0 push origin v2.1.0
  3) Or upload the local zip + SHA256SUMS manually via GitHub web UI
     (Create a new Release on gyg9006/DSH-Desktop, tag v2.1.0).
'@ -ForegroundColor Cyan
