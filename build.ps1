[CmdletBinding()]
param(
    [switch]$SkipClean,
    [switch]$SkipInstall,
    [switch]$SkipBundle,
    [switch]$RemoveLockFiles,
    [switch]$Dev
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Cyan
}

function Remove-PathIfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Write-Step "Removing $Path"
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Invoke-CommandChecked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Command $($Arguments -join ' ')"
    }
}

$repoRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    $repoRoot = (Get-Location).Path
}

Push-Location $repoRoot
try {
    Write-Step "Starting clean build in $repoRoot"

    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        throw "Bun is required but was not found in PATH. Install Bun and try again."
    }

    if (-not $SkipClean) {
        Write-Step "Cleaning dependency and build artifacts"

        $pathsToDelete = @(
            (Join-Path $repoRoot "node_modules"),
            (Join-Path $repoRoot ".cache"),
            (Join-Path $repoRoot "coverage"),
            (Join-Path $repoRoot "stats.json"),
            (Join-Path $repoRoot "npm-debug.log"),
            (Join-Path $repoRoot "out.txt"),
            (Join-Path $repoRoot "full-build.log"),
            (Join-Path $repoRoot "docker-build.log"),
            (Join-Path $repoRoot "docker-final-build.log")
        )

        foreach ($path in $pathsToDelete) {
            Remove-PathIfExists -Path $path
        }

        if ($RemoveLockFiles) {
            Remove-PathIfExists -Path (Join-Path $repoRoot "bun.lock")
            Remove-PathIfExists -Path (Join-Path $repoRoot "package-lock.json")
        }
    }

    if (-not $SkipInstall) {
        # --ignore-scripts prevents postinstall from running webpack so it only runs once below
        Write-Step "Installing dependencies (bun install --frozen-lockfile --ignore-scripts)"
        Invoke-CommandChecked -Command "bun" -Arguments @("install", "--frozen-lockfile", "--ignore-scripts")
    }

    if (-not $SkipBundle) {
        $bundleScript = if ($Dev) { "bundle-dev" } else { "bundle" }
        Write-Step "Building frontend bundles (bun run $bundleScript)"
        Invoke-CommandChecked -Command "bun" -Arguments @("run", $bundleScript)
    }

    Write-Step "Clean build completed successfully."
}
finally {
    Pop-Location
}