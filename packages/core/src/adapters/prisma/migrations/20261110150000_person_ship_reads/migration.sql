-- Display and search share one immutable crew-summary projection.
CREATE FUNCTION crew_description(doc jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH trimmed AS (
    SELECT regexp_replace(COALESCE(doc->>'summary', ''),
             '^[[:space:]]+|[[:space:]]+$', '', 'g') AS summary
  )
  SELECT NULLIF(regexp_replace(
           COALESCE(substring(summary FROM '^.*?[.!?](?:[[:space:]]|$)'), summary),
           '[[:space:]]+$', '', 'g'), '')
  FROM trimmed
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX ships_person_page_idx
  ON ships (fleet_id, (lower(name)) COLLATE "C", id COLLATE "C")
  WHERE retired_at IS NULL AND removed_at IS NULL;
CREATE INDEX ships_person_name_search_idx
  ON ships USING gin ((lower(name)) gin_trgm_ops)
  WHERE retired_at IS NULL AND removed_at IS NULL;
CREATE INDEX leases_crew_description_search_idx
  ON leases USING gin ((lower(crew_description(statement))) gin_trgm_ops)
  WHERE ended_at IS NULL;
CREATE INDEX leases_person_open_idx
  ON leases (fleet_id, ship_id) WHERE ended_at IS NULL;
CREATE INDEX ship_labels_person_match_idx
  ON ship_labels (fleet_id, ship_id, label_id, value_id);
CREATE INDEX events_person_activity_idx
  ON events (fleet_id, actor_ship_id, seq DESC) INCLUDE (occurred_at)
  WHERE type IN ('MessageAccepted', 'DeliveryAcknowledged');
