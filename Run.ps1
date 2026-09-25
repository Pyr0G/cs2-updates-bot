param(
    [ValidateSet('preview', 'check', 'run', 'test', 'resolve-sent', 'resolve-retry')]
    [string]$Action = 'preview',
    [string]$AnnouncementId
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
} else {
    $nodeExecutable = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Install Node.js 24 or newer from https://nodejs.org and reopen PowerShell.' }
}
if ($Action -eq 'test') {
    & $nodeExecutable --test
} else {
    & $nodeExecutable --env-file-if-exists=.env src/main.js $Action $AnnouncementId
}
exit $LASTEXITCODE
