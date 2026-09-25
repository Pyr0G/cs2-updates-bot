# Version 1.0 validation

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
