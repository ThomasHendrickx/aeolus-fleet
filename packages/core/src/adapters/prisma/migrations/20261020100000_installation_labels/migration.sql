-- A label belongs to the actor that defined it: a ship, or the installation (decision 0031), which defines
-- the label group in each fleet (decision 0052). An installation's label names no owner ship.
CREATE TYPE "label_owner_kind" AS ENUM ('ship', 'installation');

ALTER TABLE "labels" ADD COLUMN "owner_kind" "label_owner_kind" NOT NULL DEFAULT 'ship';
ALTER TABLE "labels" ALTER COLUMN "owner_ship_id" DROP NOT NULL;
ALTER TABLE "labels" ADD CONSTRAINT "labels_owner_named" CHECK (("owner_ship_id" IS NOT NULL) = ("owner_kind" = 'ship'));
