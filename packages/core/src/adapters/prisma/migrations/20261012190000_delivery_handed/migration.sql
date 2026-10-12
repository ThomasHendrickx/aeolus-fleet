-- A delivery a receive took is handed, not delivered (#756): the state and its
-- event take the new name, stored rows and events included (decision 0013).
ALTER TYPE "delivery_state" RENAME VALUE 'delivered' TO 'handed';

-- Events are append-only; this one-time rename is an exception, so the guard
-- is off for this statement alone.
ALTER TABLE "events" DISABLE TRIGGER "events_append_only";

UPDATE "events" SET "type" = 'DeliveryHanded' WHERE "type" = 'DeliveryClaimed';

ALTER TABLE "events" ENABLE TRIGGER "events_append_only";
