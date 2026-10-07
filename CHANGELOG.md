# Changelog

## Unreleased

- Add Docker packaging with a non-root container, persistent posting history, resource limits and no published ports.
- Document fresh setup, migration, automatic restart and manual recovery after uncertain delivery or a stale lock.

## 1.0.0 — 2026-09-25

- Clean announcement messages with a role mention, linked excerpt, image and date.
- Remove temporary Discord test-send commands and technical IDs from embed footers.
- Keep idle polling quiet; retain delivery links, errors and shutdown logs.
- Preserve posting history, validate stored IDs and retain the latest delivery receipt.
- Stop before sending another announcement when shutdown is requested.
- Support Windows PowerShell 5.1 in setup.

Automatic delivery of a newly published announcement and the role notification were confirmed locally on 2026-09-24. All 15 offline tests passed. Source and initial Git history were reviewed for security and private data before the release commit.

## 0.1.0 — Initial preview

- Monitor official Counter-Strike 2 community announcements, including patches and news.
- Post linked Discord embeds with short excerpts, Steam preview images and timestamps.
- Restrict role notifications to one configured role.
- Keep a quiet first-run baseline and persistent posting history.
- Catch up after downtime and stop for review after uncertain deliveries.
- Include Windows setup/launch scripts and offline behavior tests.

At the initial preview, live Discord delivery, appearance and role notifications had not yet been verified. Those checks were completed for 1.0.0.
