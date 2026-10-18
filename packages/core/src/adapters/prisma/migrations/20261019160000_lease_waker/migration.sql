-- What wakes a pushed ship, as its first push receive states it (interop 5.1).
CREATE TYPE "lease_waker" AS ENUM ('trierarch', 'pluginWatcher', 'personApp', 'gateway', 'adapter');

ALTER TABLE "leases" ADD COLUMN "waker" "lease_waker";
