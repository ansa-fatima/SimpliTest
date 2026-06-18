-- Quick-log cycles (Manual mode) now record the portal alongside module + feature.
ALTER TABLE "test_cycles" ADD COLUMN "portalName" TEXT;
