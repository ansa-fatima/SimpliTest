-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('Active', 'Completed', 'Archived');

-- CreateTable
CREATE TABLE "test_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "PlanStatus" NOT NULL DEFAULT 'Active',
    "milestone" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_plans_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "test_cycles" ADD COLUMN "planId" TEXT;

-- CreateIndex
CREATE INDEX "test_plans_projectId_idx" ON "test_plans"("projectId");

-- CreateIndex
CREATE INDEX "test_plans_status_idx" ON "test_plans"("status");

-- CreateIndex
CREATE INDEX "test_cycles_planId_idx" ON "test_cycles"("planId");

-- AddForeignKey
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cycles" ADD CONSTRAINT "test_cycles_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
