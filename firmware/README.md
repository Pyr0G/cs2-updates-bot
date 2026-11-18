# ESP32 notifier

The `firmware` folder contains the native C++ version for a classic ESP32 with 4 MB flash and 2.4 GHz Wi-Fi. It uses the same Discord bot application, channel and role as the server version. Run only one reporter at a time.

Version 1.1.1 adds blank lines between section labels, paragraphs and list entries, retaining nested bullet indentation and complete notes. Both implementations share the announcement fixtures in `test/fixtures`.

Live Discord delivery, message formatting and automatic startup after a power cycle were confirmed for the microcontroller implementation on 2026-11-18. See [release validation](../RELEASE.md) for details.

## Build and upload

Install PlatformIO Core. `Firmware.ps1` uses its standard Windows installation at `%USERPROFILE%\.platformio\penv`. The project pins Espressif32 6.12.0 and ArduinoJson 7.4.2. The trust roots are already included; uploading does not require regenerating them.

From the repository folder:

```powershell
.\Firmware.ps1 build
.\Firmware.ps1 upload -Port COM5
.\Firmware.ps1 status -Port COM5
```

Normal uploads preserve NVS settings and posting history. Do not erase flash during updates. Keep any full-flash recovery copy private: it contains Wi-Fi and Discord credentials.

## Configuration

Configuration remains in the board's NVS across normal uploads. For a new board, create an ignored `firmware/config.local.json` containing `ssid`, `password`, `token`, `application`, `guild`, `channel` and `role` as strings. `ssid` and `password` are the Wi-Fi credentials; the remaining fields correspond to the existing server configuration.

```powershell
.\Firmware.ps1 configure -Port COM5
.\Firmware.ps1 check -Port COM5
.\Firmware.ps1 preview -Port COM5
```

`check` verifies Discord identity, destination and permissions. `preview` only prints an outgoing payload through USB; it sends nothing to Discord and permits no role mentions. Credentials are never printed by the configuration helper. NVS is not encrypted, so physical access to the board can expose them.

## Manual switching

`pause` stops posting and persists paused mode across restarts. `standby` pauses the current session while arming automatic posting on the next power-up. `enable` starts posting after a permission check. Every boot quietly baselines the current feed, skipping existing announcements, including those published while the board was off.

While the server is running, use `standby` and unplug the board after maintenance. To switch to ESP, stop the server bot before powering up the board. To switch back, disconnect or pause ESP before starting the server. There is no automatic server-reachability guard.

```powershell
.\Firmware.ps1 standby -Port COM5
```

Pending deliveries block posting and startup baselining until reviewed against Discord. The `resolve-sent` and `resolve-retry` commands require a paused device and an exact pending announcement ID; do not resolve an uncertain delivery without checking the channel. `import-history` can migrate a server history file, preserving pending delivery and skipped IDs, but routine updates need no import.

## Limits and TLS

Full articles are fetched separately with `maxlength=0` and checked against the selected ID, date, feed and app. The formatter accepts at most 32,000 source bytes, 16 list levels and 5,200 UTF-8 description bytes, split at 3,500 bytes per embed. Oversized notes stop before recording delivery intent and are never silently truncated. One message carries at most one configured role mention and the image appears on the final embed.

The ESP uses a static Steam header image, a 48 KB retained network-JSON allocation budget, up to 64 unseen items per poll and 32 IDs at a timestamp boundary. HTTPS validates hostname, signature and certificate dates against the bundled Mozilla/Certifi roots; a synchronized clock is required. Redirects are disabled. See `certs/PROVENANCE.md` for root provenance and `certs/LICENSE.certifi` for licensing.

## Tests

Install the optional native C++ test compiler into the ignored local directory, using the PlatformIO Python installation:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m pip install --target firmware/.local/test-tools ziglang==0.13.0
.\Firmware.ps1 test
```

Tests run the actual firmware formatter against the shared real announcement fixtures and cover spacing, nested lists, Unicode, mention safety, splitting, size rejection and history migration. Without the native compiler, formatting tests explicitly report skipped. The normal `node --test` suite verifies the server separately.

The native suite also runs on Linux with `g++` and Python 3; set `CXX=g++` and run `python3 -m unittest discover -s firmware/tests -v`. This provides validation on systems whose application-control policy blocks locally built Windows test executables.
