# CHASS Chat Mirror

Machine-generated, read-only mirror for ChatGPT/GitHub connector access.

- Source of truth: CHASS Cloudflare D1
- Branch: `chass-data`
- App code is not stored on this branch.
- Status captures/failures update timestamps even if the payload is unchanged.
- Read `chat-snapshot/status/latest-attempt.json` before using status snapshots.
- Failed captures retain the previous validated status snapshot.
- `day.json` is for whole-day screening.
- `race-XX.json` is for focused race analysis.
