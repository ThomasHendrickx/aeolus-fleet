BEGIN;

ALTER TABLE ships ADD COLUMN last_crew_settings_version INTEGER NOT NULL DEFAULT 0;

-- CrewRequested survives removal. Preserve even versions issued before a legacy request reset.
WITH issued_versions AS (
  SELECT fleet_id, ship_id, (details->>'settingsVersion')::integer AS settings_version
  FROM events
  WHERE type = 'CrewRequested' AND details->>'settingsVersion' IS NOT NULL
  UNION ALL
  SELECT fleet_id, ship_id, settings_version
  FROM crew_requests
), last_versions AS (
  SELECT fleet_id, ship_id, max(settings_version) AS settings_version
  FROM issued_versions
  GROUP BY fleet_id, ship_id
)
UPDATE ships
SET last_crew_settings_version = last_versions.settings_version
FROM last_versions
WHERE ships.fleet_id = last_versions.fleet_id AND ships.id = last_versions.ship_id;

COMMIT;
