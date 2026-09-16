# 01 NAR × JRA Exchange Hotfix

Root cause: both NAR payload builders selected DebaTableSmall exclusively once it returned two horses. Partial parser loss could therefore discard RaceMarkTable/Odds identities. Trainer affiliation and historical-run organization were not retained.

Fix:
- race host remains `NAR`;
- origin is classified per horse from the trainer cell, never jockey affiliation;
- `UNKNOWN` stays unknown;
- historical `Ｊ京都`/`Ｊ阪神`/`Ｊ東京` retains `rawVenue` and becomes `runOrganization=JRA`;
- cards merge by horse number: DebaTableSmall → RaceMarkTable → Odds identity only;
- odds never enter ability calculation;
- no JRA-origin bonus or class-strength coefficient was added.

Official fixture conflict: the handoff says “2026/06/16 川崎11R”, while the earlier concrete Kanto Oaks specification and official page identify 2026/06/17 川崎11R. This branch uses the verified 2026/06/16 川崎6R fixture and leaves the conflicting 11R date for review rather than inventing data.

Dedicated tests: 5/5 pass. Existing NAR/JRA full suite also passes.
