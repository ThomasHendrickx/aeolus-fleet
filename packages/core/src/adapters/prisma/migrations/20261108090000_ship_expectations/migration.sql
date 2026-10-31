-- The expectations on ships (decision 0071): one row per ship while any holds, removed when the ship retires.
-- CreateTable
CREATE TABLE "ship_expectations" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "report_changes_within_minutes" INTEGER,
    "report_changes_within_set_by" JSONB,
    "report_changes_within_set_at" TIMESTAMPTZ(3),
    "task_done_by_task" JSONB,
    "task_done_by" TIMESTAMPTZ(3),
    "task_done_by_set_by" JSONB,
    "task_done_by_set_at" TIMESTAMPTZ(3),

    CONSTRAINT "ship_expectations_pkey" PRIMARY KEY ("fleet_id","ship_id")
);

-- AddForeignKey
ALTER TABLE "ship_expectations" ADD CONSTRAINT "ship_expectations_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_expectations" ADD CONSTRAINT "ship_expectations_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

