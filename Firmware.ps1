param(
    [ValidateSet('build','upload','test','status','check','preview','poll','pause','standby','enable','configure','import-history','resolve-sent','resolve-retry')]
    [string]$Action = 'status',
    [string]$Port = 'COM5',
    [string]$StateFile,
    [string]$AnnouncementId
)
$ErrorActionPreference = 'Stop'
$taskFirmware = Join-Path $PSScriptRoot 'firmware'
$taskPio = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\platformio.exe'
$taskPython = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $taskPio) -or !(Test-Path -LiteralPath $taskPython)) {
    throw 'Install PlatformIO Core first. See firmware/README.md.'
}
switch ($Action) {
    'build' { & $taskPio run --project-dir $taskFirmware }
    'upload' { & $taskPio run --project-dir $taskFirmware --target upload --upload-port $Port }
    'test' { & $taskPython -m unittest discover -s (Join-Path $taskFirmware 'tests') -v }
    default {
        $taskArguments = @((Join-Path $taskFirmware 'tools\device.py'), '--port', $Port, '--seconds', '45', $Action)
        if ($Action -eq 'import-history') {
            if (!$StateFile) { throw 'Supply -StateFile with the latest desktop/server state.json path.' }
            $taskArguments += @('--state', $StateFile)
        }
        if ($Action -in @('resolve-sent','resolve-retry')) {
            if (!$AnnouncementId) { throw 'Supply the exact pending Steam ID using -AnnouncementId.' }
            $taskArguments += $AnnouncementId
        }
        & $taskPython @taskArguments
    }
}
if ($LASTEXITCODE -ne 0) { throw "Firmware operation failed with exit code $LASTEXITCODE" }
