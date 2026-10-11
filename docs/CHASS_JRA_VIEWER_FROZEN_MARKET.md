# Frozen MARKET in the JRA viewer

Phase117 composes existing EARLY DATA with a separate read-only MARKET reader
at the Worker public-view boundary. The formal DATA-only viewer/research
readers and their SQL remain unchanged. JRA day/race GET responses may include
verified frozen win odds and popularity; summaries and NAR remain unchanged.

One joined SELECT per race (at most 12 per day request) selects the first MARKET
revision, its immediate DATA parent and the EARLY revision already selected by
the DATA reader. It checks exact race/version identity, identical DATA and
SOURCE bytes, parent linkage, parent and MARKET snapshot hashes, official
source/parser, complete active field and acquisition/freeze before post time.
The MARKET's DATA must equal the selected earliest DATA. A differing later
DATA is not silently substituted. A bad first MARKET never falls forward.
Snapshot hashes are integrity checks, not independent source authentication.

Historical pre-race MARKET remains readable after post time: current odds
freshness rules do not apply to a correctly frozen historical snapshot.
No live odds acquisition, app-saved `races` fallback, schema creation, save,
DATA recalculation or scheduler/config change occurs on read.

Public race metadata includes `marketFreeze.status/reason`, acquisition/freeze
timestamps, source and coverage. READY attaches only odds/popularity; HOLD
preserves ability horses. The UI distinguishes fixed market, market not saved
and validation hold, and displays timestamps in JST. Missing MARKET does not
mean official odds acquisition failed.

`marketEvaluation=disabled` continues to suppress live overlays. The frozen
horse marker prevents the viewer's existing client EV calculation. This phase
does not generate EV, diamonds, warnings or formal Signal/KPI approval.

Tests cover real SQLite first-revision selection, Worker composition, intact
ability output, historical read, scope/time/completeness/hash failures and
continued ability availability when the market is missing or unreadable.
After deploy, inspect day API marketFreeze reason counts and verify the UI.
Actual production MARKET coverage and query latency remain to be measured.
