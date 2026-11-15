-- One theme per browser (docs/design/header-across-apps.md, T2): argo's theme is no longer kept on its account.
ALTER TABLE "operators" DROP COLUMN "theme";

DROP TYPE "theme";
