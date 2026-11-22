$ErrorActionPreference = 'Stop'
$gitRoot = "src-tauri/resources/windows/git"
if (Test-Path $gitRoot) {
  Get-ChildItem -Force $gitRoot | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $gitRoot | Out-Null

$release = Invoke-RestMethod -Headers @{ "User-Agent" = "gnosis-tms-release" } -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest"
$asset = $release.assets | Where-Object {
  $_.name -match '^MinGit-.*-64-bit\.zip$' -and $_.name -notmatch 'busybox'
} | Select-Object -First 1
if (-not $asset) {
  throw "Could not find the latest MinGit 64-bit release asset."
}

$archivePath = Join-Path $env:RUNNER_TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath
Expand-Archive -Path $archivePath -DestinationPath $gitRoot -Force
