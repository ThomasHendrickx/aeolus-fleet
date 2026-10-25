-- A send to a label (decision 0063): a message keeps the label selection it was sent to, its value ids as sent.

-- AlterEnum
ALTER TYPE "selector_kind" ADD VALUE 'label';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "selector_value_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A label selector names 1 to 20 value ids and no ship, type or meeting; every other selector names none.
ALTER TABLE "messages" DROP CONSTRAINT "messages_one_selector";
ALTER TABLE "messages" ADD CONSTRAINT "messages_one_selector" CHECK (
  ("selector_kind"::text = 'ship' AND "selector_ship_id" IS NOT NULL AND "selector_type" IS NULL AND cardinality("selector_value_ids") = 0)
  OR ("selector_kind"::text = 'type' AND "selector_type" IS NOT NULL AND "selector_ship_id" IS NULL AND cardinality("selector_value_ids") = 0)
  OR ("selector_kind"::text = 'meeting' AND "meeting_id" IS NOT NULL AND "selector_ship_id" IS NULL AND "selector_type" IS NULL AND cardinality("selector_value_ids") = 0)
  OR ("selector_kind"::text = 'label' AND cardinality("selector_value_ids") BETWEEN 1 AND 20 AND "selector_ship_id" IS NULL AND "selector_type" IS NULL AND "meeting_id" IS NULL)
);
