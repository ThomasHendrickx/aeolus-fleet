-- NULL means the exchange still needs its after-start backfill. Reads count
-- its open plain deliveries until then; live deltas preserve NULL.
ALTER TABLE exchanges ADD COLUMN unseen_plain_messages INTEGER;

-- Partial reads and the fill recount only the open part of an exchange.
CREATE INDEX deliveries_open_exchange_idx ON deliveries (fleet_id, reached_ship_id, sender_ship_id, id)
WHERE is_in_exchange AND state IN ('pending', 'received', 'handed');
