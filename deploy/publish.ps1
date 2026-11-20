$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Run($program, [string[]]$arguments) {
  & $program @arguments
  if ($LASTEXITCODE -ne 0) { throw "$program failed (exit $LASTEXITCODE)" }
}
try {
  Write-Host 'Checking tools, branch and server...'
  foreach ($program in @('git','corepack','ssh','scp','tar','curl.exe')) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Missing command: $program" }
  }
  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Switch to main before publishing.' }
  Run git @('fetch','git@github.com:fancrystal/cym.git','main')
  Run git @('merge-base','--is-ancestor','FETCH_HEAD','HEAD')
  Run ssh @('-o','BatchMode=yes','-o','ConnectTimeout=8','root@47.93.185.61','true')
  Write-Host 'Testing and building...'
  Run corepack @('pnpm','test')
  Run corepack @('pnpm','--filter','@cym/h5','build')
  Run corepack @('pnpm','--filter','@cym/admin','build')
  $unsafe = & git diff FETCH_HEAD --name-only -- packages/backend/schema.sql packages/backend/src/init-db.js packages/backend/package.json packages/h5/package.json packages/admin/package.json pnpm-lock.yaml deploy/cym-backend.service deploy/cym-web.nginx.conf deploy/cym-admin.nginx.conf
  if ($LASTEXITCODE -ne 0) { throw 'Unable to check deployment prerequisites.' }
  if ($unsafe) { throw 'Database schema, dependencies or service configuration changed. Handle migration/dependencies separately before deployment.' }
  Write-Host 'Staging project files (ignored secrets and tmp are excluded)...'
  Run git @('add','-A','--','packages','docs','deploy','deploy.bat','AGENTS.md','README.md','.gitignore')
  $staged = @(& git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect staged files.' }
  if ($staged | Where-Object { $_ -match '(^|/)(\.env($|\.)|signing\.properties$|local\.properties$|keystore/|uploads/|node_modules/)' -and $_ -notmatch '\.env\.example$' }) { throw 'Sensitive or generated file staged. Remove it from the index before retrying.' }
  Run git @('diff','--cached','--check')
  if ($staged.Count -gt 0) { Run git @('commit','-m',('Deploy update '+(Get-Date -Format 'yyyy-MM-dd-HHmmss'))) }
  $commit = (& git rev-parse --short=12 HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot identify commit.' }
  Write-Host "Pushing commit $commit..."
  Run git @('push','git@github.com:fancrystal/cym.git','main')
  $release = 'manual-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $commit
  $archive = Join-Path $env:TEMP ("cym-$release.tgz")
  try {
    Run tar @('-czf',$archive,'packages/h5/dist','packages/admin/dist','packages/backend/src')
    Run scp @('-o','BatchMode=yes',$archive,"root@47.93.185.61:/srv/cym/shared/cym-$release.tgz")
    # Upload the deployment helper separately so first use does not depend on the current release.
    Run scp @('-o','BatchMode=yes','deploy/publish-remote.sh',"root@47.93.185.61:/srv/cym/shared/cym-publish-$release.sh")
    Run ssh @('-o','BatchMode=yes','root@47.93.185.61',"sh /srv/cym/shared/cym-publish-$release.sh $release")
  } finally { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
  Run curl.exe @('-fsS','--max-time','15','https://cym.green/api/health')
  Run curl.exe @('-fsS','--max-time','15','-o','NUL','https://admin.cym.green/')
  Write-Host "Published $release. GitHub and server updated."
} catch {
  Write-Host "Publish stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Check whether GitHub was already pushed; server rollback is automatic only if activation or health check failed.'
  exit 1
}
