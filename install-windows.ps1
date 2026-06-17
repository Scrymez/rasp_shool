$ErrorActionPreference = "Stop"

$repo = "Scrymez/rasp_shool"
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"
$downloadDir = Join-Path $env:TEMP "AmanatRaspisanieInstall"
$headers = @{
  "User-Agent" = "Amanat-Raspisanie-Installer"
}

Write-Host "Amanat Raspisanie installer"
Write-Host "Checking latest GitHub Release..."

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
$asset = $release.assets |
  Where-Object { $_.name -match "^amanat-raspisanie-setup-.*\.exe$" } |
  Select-Object -First 1

if (-not $asset) {
  throw "Installer .exe not found in latest GitHub Release."
}

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
$installerPath = Join-Path $downloadDir $asset.name

Write-Host "Latest version: $($release.tag_name)"
Write-Host "Downloading: $($asset.name)"
Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $installerPath

if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
  Unblock-File -Path $installerPath
}

Write-Host "Starting installer..."
Start-Process -FilePath $installerPath -Wait
Write-Host "Done."
