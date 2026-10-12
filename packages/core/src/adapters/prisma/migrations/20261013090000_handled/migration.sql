-- A pushed crew reports how the turn that took a confirmed message ended:
-- handled, or not handled after it was handed once more (decision 0040).
ALTER TYPE "delivery_state" ADD VALUE 'handled' AFTER 'acknowledged';
ALTER TYPE "delivery_state" ADD VALUE 'notHandled' AFTER 'handled';

ALTER TABLE "deliveries" ADD COLUMN "handed_once_more_at" TIMESTAMPTZ(3);
