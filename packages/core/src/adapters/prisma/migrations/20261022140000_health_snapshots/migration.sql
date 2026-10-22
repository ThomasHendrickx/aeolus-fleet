-- The stuck snapshot (docs/design/performance/performance.md, section 5): one
-- row per fleet and closed hour, and the fleet's open deliveries as of its
-- latest. The 30 second pass writes them; until a fleet's first pass the
-- health reads replay its events as before.
CREATE TABLE "health_snapshots" (
    "fleet_id" TEXT NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "seq" BIGINT NOT NULL,
    "stuck" JSONB NOT NULL,
    "acknowledged" JSONB NOT NULL,
    "turns" JSONB NOT NULL,

    CONSTRAINT "health_snapshots_pkey" PRIMARY KEY ("fleet_id", "hour")
);

CREATE TABLE "health_snapshot_deliveries" (
    "fleet_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender_ship_id" TEXT NOT NULL,
    "recipient_ship_id" TEXT,
    "recipient_type" TEXT,
    "claimed_by_ship_id" TEXT,
    "reachable_ship_ids" TEXT[],
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "state" "delivery_state",
    "since" TIMESTAMPTZ(3),
    "step_ship_id" TEXT,
    "lease_id" TEXT,

    CONSTRAINT "health_snapshot_deliveries_pkey" PRIMARY KEY ("fleet_id", "delivery_id")
);

ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "health_snapshot_deliveries" ADD CONSTRAINT "health_snapshot_deliveries_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A first snapshot reads each lease's turn at its oldest hour from the turn
-- reports alone, not every event of the fleet back to them.
CREATE INDEX "events_turn_reported_idx" ON "events"("fleet_id", "occurred_at")
  WHERE type = 'TurnReported';
