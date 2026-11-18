# Release validation

Validation records are specific to the release and environment tested. Automated test results and operator-confirmed live checks are listed separately.

## Version 1.1.1 — 2026-11-11

### Live validation

The following checks were confirmed by the operator on 2026-11-18:

| Check | Docker deployment | ESP32 microcontroller |
| --- | --- | --- |
| Successful message delivery to Discord | Validated | Validated |
| Correct patch-note formatting in Discord | Validated | Validated |
| Automatic bot startup after a full power cycle | Validated | Validated |

These results validate the tested installations. Configure and verify automatic startup for each new installation using the [Docker deployment guide](DOCKER.md) or [microcontroller guide](firmware/README.md).

### Automated tests and build checks

- All 34 Node.js tests passed locally and in the rebuilt Docker image.
- All 21 firmware tests passed on Linux with g++ and Python: 12 C++ formatter tests and nine history-migration tests.
- The firmware built successfully and was uploaded with flash hash verification, preserving NVS configuration and posting history.
- Discord identity, destination and role-permission checks passed for both implementations. The microcontroller also passed Wi-Fi connectivity and clock-synchronization checks.

### Formatting coverage

The November 4 announcement fixture retains all 23 paragraphs (two section labels and 21 list entries), separated by blank lines. The October 14 fixture verifies spacing around introductory paragraphs and section boundaries. Coverage also includes the complete October 23 fixture, nested indentation, Unicode, restricted mentions, continuation splitting and oversize rejection.

A non-posting preview on the microcontroller matched the server formatter: 1,442 UTF-8 description bytes, 23 separated blocks and 21 bullets. The preview left the posting checkpoint unchanged.

## Version 1.1.0 — 2026-10-27

All 31 offline Node.js tests passed in the source checkout. All 28 tests available in the Docker deployment checkout passed inside the rebuilt image without network access or Discord credentials.

The October 23 fixture retains all 54 paragraphs and 53 bullets, including the final entry. Coverage includes headings, entities, Unicode, nested lists, continuation links, Discord size limits and restricted role mentions. Oversized input is rejected before recording a delivery attempt, transmitting a message or advancing the checkpoint.

Startup tests cover existing history, subsequent announcements, unresolved pending delivery, empty or failed feed reads, destination validation and shutdown. Every process start quietly baselines the feed and skips announcements published while the bot was stopped.

Docker checks verified Discord access, quiet startup and the existing container restrictions without sending test messages or replaying announcements. Live delivery with this renderer and full power-cycle recovery were not yet validated at this release; see version 1.1.1 for subsequent confirmation. No new repository-wide security scan was recorded for version 1.1.0.

## Version 1.0.1 — 2026-10-10

All 18 offline Node.js tests passed. Redirect tests cover unsafe first and intermediate destinations, redirect limits and a normal two-hop Steam article chain. A local reproduction verified that the fix blocked a redirect to an unapproved destination before requesting it.

A live Steam feed and article read completed with a canonical `steamcommunity.com` URL. No Discord message was sent during validation. Deployment and future live delivery were separate checks for this release.

## Version 1.0.0 — 2026-09-25

### Live validation

- Official Steam sources and canonical announcement links were verified.
- Discord identity, destination channel and role permission checks passed.
- Message appearance and role notification were confirmed by the operator.
- Quiet first-run baselining, continuous polling and automatic delivery of a newly published announcement were verified.
- The delivery receipt and posting history matched the announcement, with no pending delivery remaining.
- Recovery from a transient source-fetch failure and graceful shutdown were verified.

### Offline validation

All 15 tests passed without Discord credentials. Coverage includes restricted mentions, source validation, pagination, permissions, quiet baselines, disk-backed restart duplicate suppression, malformed-state refusal, uncertain delivery handling and graceful shutdown. Both PowerShell setup and launch scripts passed syntax checks.

Restart duplicate suppression was tested offline; a separate live restart test was not recorded for this release.

### Historical security review

The version 1.0.0 release record reports a Codex Security review of the 14 public release files with no reportable findings, plus a check for credentials and private data before publication. This record applies to that historical source snapshot and does not establish security coverage for later releases.
