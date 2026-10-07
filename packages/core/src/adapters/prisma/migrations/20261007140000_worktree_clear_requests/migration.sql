-- A pending request that a trierarch clear a worktree it kept (decision 0032),
-- one per trierarch, ship and repository. Every foreign key leads an index.
-- CreateTable
CREATE TABLE "worktree_clear_requests" (
    "fleet_id" TEXT NOT NULL,
    "trierarch_ship_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "requested_by_ship_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worktree_clear_requests_pkey" PRIMARY KEY ("fleet_id","trierarch_ship_id","ship_id","repository")
);

-- CreateIndex
CREATE INDEX "worktree_clear_requests_fleet_id_ship_id_idx" ON "worktree_clear_requests"("fleet_id", "ship_id");

-- CreateIndex
CREATE INDEX "worktree_clear_requests_fleet_id_requested_by_ship_id_idx" ON "worktree_clear_requests"("fleet_id", "requested_by_ship_id");

-- AddForeignKey
ALTER TABLE "worktree_clear_requests" ADD CONSTRAINT "worktree_clear_requests_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worktree_clear_requests" ADD CONSTRAINT "worktree_clear_requests_fleet_id_trierarch_ship_id_fkey" FOREIGN KEY ("fleet_id", "trierarch_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worktree_clear_requests" ADD CONSTRAINT "worktree_clear_requests_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worktree_clear_requests" ADD CONSTRAINT "worktree_clear_requests_fleet_id_requested_by_ship_id_fkey" FOREIGN KEY ("fleet_id", "requested_by_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

