[CmdletBinding()]
param(
    [switch]$BuildOnly,
    [switch]$CheckOnly,
    [switch]$SkipDependencies,
    [switch]$DebugBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        $rendered = $Arguments -join ' '
        throw "$Executable $rendered failed (exit $LASTEXITCODE). Installation was not started."
    }
}

function Find-Command {
    param([string]$Name)
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$command) { throw "Required command not found: $Name. See docs/local-build.md." }
    return $command.Source
}

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$locationPushed = $false
try {
    if ($env:OS -ne 'Windows_NT') { throw 'This script builds and installs the Windows edition only.' }
    Push-Location -LiteralPath $root
    $locationPushed = $true
    $node = Find-Command 'node.exe'
    $pnpm = Find-Command 'pnpm.cmd'
    $cargo = Find-Command 'cargo.exe'
    $rustc = Find-Command 'rustc.exe'

    Write-Host "`n[1/4] Checking build environment..." -ForegroundColor Cyan
    $nodeVersion = (& $node --version).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'24.0.0') {
        throw "Node.js 24 or newer is required. Found: $nodeVersion"
    }
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $expectedPnpm = $package.packageManager -replace '^pnpm@', ''
    $actualPnpm = (& $pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualPnpm -ne $expectedPnpm) {
        throw "Expected pnpm $expectedPnpm, found $actualPnpm. Run: npm install -g pnpm@$expectedPnpm"
    }
    $rustInfo = & $rustc -vV
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Rust toolchain.' }
    $hostLine = $rustInfo | Where-Object { $_ -like 'host: *' } | Select-Object -First 1
    $target = $hostLine -replace '^host: ', ''
    if ($target -notin @('x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc')) {
        throw "A Windows MSVC Rust toolchain is required. Found: $target"
    }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ Build Tools were not found. See docs/local-build.md.' }
    $vcComponent = if ($target -eq 'aarch64-pc-windows-msvc') { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
    $visualStudio = & $vswhere -latest -products '*' -requires $vcComponent -property installationPath
    if ($LASTEXITCODE -ne 0 -or !$visualStudio) { throw "Missing Visual Studio component: $vcComponent. Install Desktop development with C++ and a Windows SDK." }
    Invoke-Checked $node @('scripts/release/version.mjs')
    Write-Host "Environment OK: Node $nodeVersion; pnpm $actualPnpm; $target"
    if ($CheckOnly) {
        Write-Host 'CheckOnly: no dependencies installed, no build or installation performed.' -ForegroundColor Green
        exit 0
    }

    Write-Host "`n[2/4] Installing locked dependencies..." -ForegroundColor Cyan
    if ($SkipDependencies) {
        if (!(Test-Path -LiteralPath 'node_modules')) { throw 'node_modules is missing. Run without -SkipDependencies.' }
        Write-Host 'Skipped dependency installation by request.'
    } else {
        Invoke-Checked $pnpm @('install', '--frozen-lockfile')
    }
    Invoke-Checked $pnpm @('check')

    Write-Host "`n[3/4] Building the Windows NSIS installer..." -ForegroundColor Cyan
    $config = Get-Content -LiteralPath 'apps/desktop/src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $metadataText = & $cargo metadata --no-deps --format-version 1 --manifest-path apps/desktop/src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the Cargo target directory.' }
    $metadata = $metadataText | ConvertFrom-Json
    $profile = if ($DebugBuild) { 'debug' } else { 'release' }
    $bundleDirectory = Join-Path $metadata.target_directory "$target\$profile\bundle\nsis"
    $buildArguments = @('--filter', '@xtools/desktop', 'tauri', 'build', '--ci', '--target', $target, '--bundles', 'nsis')
    if ($DebugBuild) { $buildArguments += '--debug' }
    $buildArguments += @('--', '--locked')
    $started = [DateTime]::UtcNow
    Invoke-Checked $pnpm $buildArguments

    $arch = if ($target -eq 'aarch64-pc-windows-msvc') { 'arm64' } else { 'x64' }
    $installerName = '{0}_{1}_{2}-setup.exe' -f $config.productName, $config.version, $arch
    $installerPath = Join-Path $bundleDirectory $installerName
    if (!(Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Build did not produce the expected installer: $installerPath"
    }
    $installer = Get-Item -LiteralPath $installerPath
    if ($installer.Length -lt 1000 -or $installer.LastWriteTimeUtc -lt $started.AddSeconds(-2)) {
        throw "Installer is empty or stale. Refusing to launch: $installerPath"
    }
    $stream = [System.IO.File]::OpenRead($installer.FullName)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
    Write-Host "`nInstaller: $($installer.FullName)" -ForegroundColor Green
    Write-Host "SHA-256:   $hash"
    if ($BuildOnly) {
        Write-Host 'BuildOnly: installer was created but not launched.' -ForegroundColor Green
        exit 0
    }

    Write-Host "`n[4/4] Opening the installation wizard..." -ForegroundColor Cyan
    Write-Host 'Save your work in XTools before proceeding. Windows may show a warning for this unsigned preview.'
    # Installation remains interactive; no silent flags, forced app termination or automatic elevation.
    $installProcess = Start-Process -FilePath $installer.FullName -WorkingDirectory $installer.DirectoryName -WindowStyle Normal -Wait -PassThru
    if ($installProcess.ExitCode -ne 0) {
        throw "The installer was cancelled or failed (exit $($installProcess.ExitCode))."
    }
    Write-Host 'Installation wizard completed successfully.' -ForegroundColor Green
    exit 0
} catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($locationPushed) { Pop-Location }
}
