# 05 Precomputed Architecture

`SOURCE → DATA → MARKET → FINAL → RESULT` is implemented as a versioned snapshot contract with stable SHA-256 source/input hashes. DATA is market-independent; an existing FINAL cannot be overwritten.

Migration `0012_precomputed_snapshots.sql` adds an append-only revision table and unique input-hash idempotency guard. Race-level background jobs isolate failures. Viewer status is explicit: `NOT_CALCULATED`, `PARTIAL`, `STALE`, `READY`.

Both new runtime flags default OFF. No cron was changed, no live polling was restored, and no production route was activated.
