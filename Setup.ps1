$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (Test-Path -LiteralPath '.env') {
    throw '.env already exists. Edit it locally if you need to change the token; this setup does not overwrite credentials.'
}
$localDefaults = @{}
if (Test-Path -LiteralPath 'settings.local.json') {
    $savedDefaults = Get-Content -LiteralPath 'settings.local.json' -Raw | ConvertFrom-Json
    foreach ($property in $savedDefaults.PSObject.Properties) {
        $localDefaults[$property.Name] = $property.Value
    }
}
$configuration = @{}
foreach ($settingName in @('DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID', 'DISCORD_ROLE_ID')) {
    $settingValue = $localDefaults[$settingName]
    if (-not $settingValue) { $settingValue = Read-Host $settingName }
    if ($settingValue -notmatch '^\d{17,20}$') { throw "Invalid ID for $settingName" }
    $configuration[$settingName] = $settingValue
}
$botSecret = Read-Host 'Paste the Discord BOT token (hidden; do not paste it into chat)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($botSecret)
try {
    $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($botToken -notmatch '^[A-Za-z0-9_.-]{30,}$') { throw 'That does not look like a Discord bot token.' }
    $settings = @(
        "DISCORD_BOT_TOKEN=$botToken"
        "DISCORD_CHANNEL_ID=$($configuration.DISCORD_CHANNEL_ID)"
        "DISCORD_GUILD_ID=$($configuration.DISCORD_GUILD_ID)"
        "DISCORD_ROLE_ID=$($configuration.DISCORD_ROLE_ID)"
        "DISCORD_APPLICATION_ID=$($configuration.DISCORD_APPLICATION_ID)"
        'POLL_SECONDS=120'
        'STATE_FILE=./data/state.json'
    )
    [IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), $settings, [Text.UTF8Encoding]::new($false))
    Write-Host 'Token saved locally in .env. No Discord messages have been sent. You can now run ./Run.ps1 check.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $botToken = $null
    $settings = $null
    $botSecret.Dispose()
}
