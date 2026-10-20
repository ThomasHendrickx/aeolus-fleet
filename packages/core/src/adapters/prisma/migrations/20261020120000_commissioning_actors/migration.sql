-- A ship is commissioned by an actor (decisions 0053, 0057): a ship, an account by its id only, or the installation,
-- which commissions person ships. commissioned_by names it: the ship's id, the account's id, or 'installation'.
-- Every commission so far was a ship's. An idempotency key is used once per commissioning actor.
CREATE TYPE "commissioner_kind" AS ENUM ('ship', 'account', 'installation');

ALTER TABLE "ships" ADD COLUMN "commissioned_by_kind" "commissioner_kind";
UPDATE "ships" SET "commissioned_by_kind" = 'ship' WHERE "commissioned_by" IS NOT NULL;
ALTER TABLE "ships" ADD CONSTRAINT "ships_commissioner_named" CHECK (
  ("commissioned_by" IS NULL) = ("commissioned_by_kind" IS NULL)
  AND ("commissioned_by_kind" <> 'installation' OR "commissioned_by" = 'installation')
);

DROP INDEX "ships_fleet_id_commissioned_by_commission_key_key";
CREATE UNIQUE INDEX "ships_commission_key_key" ON "ships"("fleet_id", "commissioned_by_kind", "commissioned_by", "commission_key");
