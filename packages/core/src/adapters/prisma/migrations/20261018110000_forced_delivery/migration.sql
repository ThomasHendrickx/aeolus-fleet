-- A delivery keeps whether its message was forced (decision 0040): forced
-- deliveries come first in receive and push receive. Every delivery so far
-- was a plain one.
ALTER TABLE "deliveries" ADD COLUMN "is_forced" BOOLEAN NOT NULL DEFAULT false;
