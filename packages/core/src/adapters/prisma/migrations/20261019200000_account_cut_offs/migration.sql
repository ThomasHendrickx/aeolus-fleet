-- The accounts pagasae cut off, kept until their last token has ended (decision 0058).
CREATE TABLE "account_cut_offs" (
    "account_id" TEXT NOT NULL,
    "cut_off_at" TIMESTAMPTZ(3) NOT NULL,
    "forget_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_cut_offs_pkey" PRIMARY KEY ("account_id")
);

CREATE INDEX "account_cut_offs_forget_at_idx" ON "account_cut_offs"("forget_at");
