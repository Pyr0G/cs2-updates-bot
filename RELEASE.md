# Release validation

## Version 1.1.1 — 2026-11-11

All 34 Node tests pass locally and in the rebuilt server image. All 21 firmware tests pass in a temporary Linux container using g++ and Python, including 12 tests of the actual C++ formatter and nine history-migration tests. Windows application control blocked locally compiled test executables; Linux validation completed without changing that policy.

The November 4 announcement shown in the reported screenshot retains all 23 paragraphs (two section labels and 21 list entries), separated by blank lines. The October 14 reference fixture verifies spacing around introductory paragraphs and section boundaries. Existing complete October 23 coverage, nested indentation, Unicode, restricted mentions, continuation splitting and oversize rejection remain covered.

The server update is running with its previous delivery history intact, no pending delivery and a successful quiet startup/Discord permission check. Existing container restrictions remain in place. A recovery image and previous source were retained privately.

The previous ESP32 source was recovered from saved work history and is now included in `firmware/`, with pinned build settings, TLS trust roots and USB management tools. The firmware builds successfully and was uploaded with flash hash verification, retaining the existing NVS configuration and checkpoint. The embedded trust store contains five roots present in Certifi 2026.7.22; provenance and licensing are included. A private settings backup was retained before upload. No historical Discord announcement was replayed or edited for this update.

The actual device's non-posting November 4 preview exactly matches the server formatter: 1,442 UTF-8 description bytes, 23 separated blocks and 21 bullets. Wi-Fi, clock synchronization and Discord identity/destination/role permissions passed. The checkpoint remained unchanged, with no pending delivery. At deployment, ESP was left in current-session standby with automatic posting armed for the next power-up while the server ran.

On 2026-11-18, the operator confirmed that both the Docker deployment and ESP32 microcontroller implementation successfully sent correctly formatted messages to the Discord channel. The operator also confirmed that both the Docker host and ESP32 microcontroller were fully power-cycled and their bots started automatically afterward. Live Discord delivery, message formatting and automatic startup after a full power cycle are therefore validated for both implementations based on operator confirmation.

## Version 1.1.0 — 2026-10-27

All 31 offline Node tests pass in this source checkout. The complete October 23 fixture retains all 54 paragraphs and 53 bullets, including its final entry. Coverage includes nested lists, headings, entities, Unicode/escape-safe continuation splits, distinct continuation URLs, Discord title/description/aggregate budgets and restricted role mentions. Oversized input is rejected before delivery intent, transmission or checkpoint advancement.

Four startup tests cover quiet baselining with existing history, subsequent new items, unresolved pending delivery, empty/failed startup reads, destination validation and shutdown. Quiet startup now occurs on every process start and deliberately skips announcements published while stopped; this replaces the previous restart catch-up behavior.

The same runtime source was deployed to a Linux Docker host. All 28 tests available in that guest checkout passed inside the rebuilt image without network access, credentials or production history. Discord access and quiet startup were verified without sending a test message or replaying a historical announcement. Existing non-root/read-only operation, capability restrictions and resource limits were retained. A pre-existing stale state lock was archived only after confirming no owner process or pending delivery; automatic lock deletion is not part of this release.

A genuine newly published announcement using this renderer and a complete host power-cycle recovery have not been newly validated. The earlier release security-review results below apply to those historical snapshots; no new repository-wide security scan is claimed for 1.1.0.

## Version 1.0.1 — 2026-10-10

The Steam feed and article fetches now validate every redirect destination before
requesting it. A local-only redirect reproduction reached an internal endpoint
before the fix and made no internal request afterward. Tests cover unsafe first
and intermediate hops, the redirect limit, and the normal two-hop Steam article
chain. All 18 offline tests pass. A live read of the latest public Steam feed
and article completed with a canonical `steamcommunity.com` URL. No Discord
message was sent as part of this validation. Deployment and future live delivery
of 1.0.1 on a host are separate checks.

Host-specific egress rules remain outside this public repository. The Docker
guide explains why a private-network host needs a bot-scoped outbound firewall.

## Version 1.0.0 — 2026-09-25

Validated for 1.0.0 on 2026-09-25.

## Live local test

- Official Steam source and canonical announcement links verified.
- Discord identity, destination channel and role permission checks passed.
- Embed appearance and role notification confirmed by the operator.
- Quiet first-run baseline and continuous polling verified.
- A newly published [Counter-Strike 2 Update](https://steamcommunity.com/games/CSGO/announcements/detail/674006995886409096) was automatically posted on 2026-09-24 at 21:58:53.995 UTC.
- The saved delivery receipt matches that announcement, its ID is in posting history, and no pending delivery remains.
- A transient source fetch failure was followed by successful delivery; graceful shutdown completed.

## Offline validation

All 15 tests passed in an isolated copy without Discord credentials. Coverage includes restricted mentions, source validation, pagination, permissions, quiet baselines, disk-backed restart duplicate suppression, malformed-state refusal, uncertain delivery handling and graceful shutdown. Both PowerShell launch/setup scripts passed syntax parsing.

Restart duplicate suppression was tested offline; a separate live restart test is not claimed.

## Security and publication review

Codex Security reviewed all 14 public release files with independent baseline and focused boundary reviews and found no reportable security findings. The initial published commit and current release files were also inspected for credentials and private personal data, including exact comparisons against local configuration without exposing its values. No such data was found. Git attribution uses a public GitHub handle and no-reply address.

Private credentials, server/channel/role configuration, posting history and local previews remain excluded from Git. The security review covers the source snapshot before the final version/documentation updates; those final updates were separately inspected before committing. No runtime code changed after that review.

Hosting and expanded announcement rendering are future work. This release uses the existing short embed format and requires the local process to keep running.
