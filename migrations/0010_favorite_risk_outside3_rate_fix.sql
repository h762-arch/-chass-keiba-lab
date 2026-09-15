-- CHASS favorite-risk ai_outside3_rate repair.
-- Purpose: correct rows created by v2.1 when ai_place_rate is stored on the 0-100 percent scale.
-- Scope is limited to the two favorite-risk research tables. No schema/destructive operations.

UPDATE jra_favorite_risk_snapshots
SET
  ai_outside3_rate = CASE
    WHEN ai_place_rate > 1 AND ai_place_rate <= 100 THEN ROUND(100.0 - ai_place_rate, 6)
    WHEN ai_place_rate >= 0 AND ai_place_rate <= 1 THEN ROUND(1.0 - ai_place_rate, 6)
    ELSE NULL
  END,
  snapshot_json = CASE
    WHEN json_valid(snapshot_json) THEN json_set(
      snapshot_json,
      '$.favorite.aiOutside3Rate',
      CASE
        WHEN ai_place_rate > 1 AND ai_place_rate <= 100 THEN ROUND(100.0 - ai_place_rate, 6)
        WHEN ai_place_rate >= 0 AND ai_place_rate <= 1 THEN ROUND(1.0 - ai_place_rate, 6)
        ELSE NULL
      END
    )
    ELSE snapshot_json
  END
WHERE ai_place_rate >= 0
  AND ai_place_rate <= 100
  AND (
    ai_outside3_rate IS NULL
    OR ABS(
      ai_outside3_rate - CASE
        WHEN ai_place_rate > 1 THEN ROUND(100.0 - ai_place_rate, 6)
        ELSE ROUND(1.0 - ai_place_rate, 6)
      END
    ) > 0.000001
  );

UPDATE nar_favorite_risk_snapshots
SET
  ai_outside3_rate = CASE
    WHEN ai_place_rate > 1 AND ai_place_rate <= 100 THEN ROUND(100.0 - ai_place_rate, 6)
    WHEN ai_place_rate >= 0 AND ai_place_rate <= 1 THEN ROUND(1.0 - ai_place_rate, 6)
    ELSE NULL
  END,
  snapshot_json = CASE
    WHEN json_valid(snapshot_json) THEN json_set(
      snapshot_json,
      '$.favorite.aiOutside3Rate',
      CASE
        WHEN ai_place_rate > 1 AND ai_place_rate <= 100 THEN ROUND(100.0 - ai_place_rate, 6)
        WHEN ai_place_rate >= 0 AND ai_place_rate <= 1 THEN ROUND(1.0 - ai_place_rate, 6)
        ELSE NULL
      END
    )
    ELSE snapshot_json
  END
WHERE ai_place_rate >= 0
  AND ai_place_rate <= 100
  AND (
    ai_outside3_rate IS NULL
    OR ABS(
      ai_outside3_rate - CASE
        WHEN ai_place_rate > 1 THEN ROUND(100.0 - ai_place_rate, 6)
        ELSE ROUND(1.0 - ai_place_rate, 6)
      END
    ) > 0.000001
  );
