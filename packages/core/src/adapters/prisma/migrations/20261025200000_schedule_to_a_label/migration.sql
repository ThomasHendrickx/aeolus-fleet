-- A schedule to a label (decision 0065, D6): a schedule keeps the label selection it sends to, its value ids as given.

-- AlterTable
ALTER TABLE "schedules" ADD COLUMN "selector_value_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The selector as the creator gave it: a ship by id, a ship by name, a type, or a label selection of 1 to 20 value ids; never a meeting.
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_one_selector";
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_one_selector" CHECK (
  ("selector_kind" = 'ship' AND "selector_type" IS NULL AND (("selector_ship_id" IS NULL) <> ("selector_ship_name" IS NULL)) AND cardinality("selector_value_ids") = 0)
  OR ("selector_kind" = 'type' AND "selector_type" IS NOT NULL AND "selector_ship_id" IS NULL AND "selector_ship_name" IS NULL AND cardinality("selector_value_ids") = 0)
  OR ("selector_kind" = 'label' AND cardinality("selector_value_ids") BETWEEN 1 AND 20 AND "selector_type" IS NULL AND "selector_ship_id" IS NULL AND "selector_ship_name" IS NULL)
);
