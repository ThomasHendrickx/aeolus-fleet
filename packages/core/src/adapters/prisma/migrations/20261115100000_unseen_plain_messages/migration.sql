-- NULL means the exchange still needs its after-start backfill. Reads count
-- its open plain deliveries until then; live deltas preserve NULL.
ALTER TABLE exchanges ADD COLUMN unseen_plain_messages INTEGER;
