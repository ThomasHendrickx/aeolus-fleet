-- List owner-selector rules for one fleet, including a row when none match.
-- Release runs this for each fleet when shipping the commission default (0045).
-- Uses the normal psql connection environment; prints no credentials.
-- psql --set=ON_ERROR_STOP=1 --set=fleet_id=flt_... --file=docs/owner-selector-rules.sql
BEGIN TRANSACTION READ ONLY;

WITH sources AS (
  SELECT fleet_id, 'applied' AS source, NULL::text AS declarer, rules FROM network_settings WHERE fleet_id = :'fleet_id'
  UNION ALL
  SELECT fleet_id, 'draft', NULL::text, rules FROM network_rules_drafts WHERE fleet_id = :'fleet_id'
  UNION ALL
  SELECT fleet_id, 'ship', ship_id, rules FROM declared_network_rules WHERE fleet_id = :'fleet_id'
  UNION ALL
  SELECT fleet_id, 'installation', NULL::text, rules FROM installation_declared_network_rules WHERE fleet_id = :'fleet_id'
), owner_rules AS (
  SELECT fleet_id, source, declarer, position, rule
  FROM sources
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(rules, '[]'::jsonb))
    WITH ORDINALITY AS items(rule, position)
  WHERE jsonb_path_exists(rule, '$.from[*].owner')
     OR jsonb_path_exists(rule, '$.to[*].owner')
)
SELECT f.id AS fleet_id, f.name AS fleet_name, r.source,
       s.name AS declarer_name, r.declarer AS declarer_ship_id,
       r.position, r.rule->>'verb' AS verb,
       r.rule->'from' AS from_selector, r.rule->'to' AS to_selector
FROM (SELECT id, name FROM fleets WHERE id = :'fleet_id') f
LEFT JOIN owner_rules r ON r.fleet_id = f.id
LEFT JOIN ships s ON s.fleet_id = f.id AND s.id = r.declarer
ORDER BY f.id, r.source, r.declarer, r.position;

COMMIT;
