-- CreateTable
CREATE TABLE "template_repositories" (
    "fleet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "token" TEXT,
    "added_at" TIMESTAMPTZ(3) NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(3),
    "last_fetch_error" TEXT,

    CONSTRAINT "template_repositories_pkey" PRIMARY KEY ("fleet_id","name")
);
