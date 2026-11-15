-- NULL means the exchange still needs its fill after start. Reads count
-- its open plain deliveries until then; live deltas keep NULL as NULL.
ALTER TABLE exchanges ADD COLUMN unseen_plain_messages INTEGER;
