-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('High', 'Medium', 'Low');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('Critical', 'Major', 'Minor');

-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API');

-- CreateEnum
CREATE TYPE "RunResult" AS ENUM ('NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('Active', 'Completed', 'Archived');

-- CreateEnum
CREATE TYPE "CycleScopeType" AS ENUM ('All', 'Module', 'Feature', 'Custom');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "googleId" TEXT,
    "microsoftId" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'Tester',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL,
    "caseNum" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "sub" TEXT NOT NULL DEFAULT '',
    "desc" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "expected" TEXT NOT NULL DEFAULT '',
    "priority" "Priority" NOT NULL,
    "severity" "Severity" NOT NULL,
    "type" "TestType" NOT NULL,
    "featureId" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CycleStatus" NOT NULL DEFAULT 'Active',
    "scopeType" "CycleScopeType" NOT NULL DEFAULT 'All',
    "scopeId" TEXT,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "result" "RunResult" NOT NULL DEFAULT 'NotRun',
    "notes" TEXT NOT NULL DEFAULT '',
    "executedAt" TIMESTAMP(3),
    "executedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_microsoftId_key" ON "users"("microsoftId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "modules_name_key" ON "modules"("name");

-- CreateIndex
CREATE INDEX "features_moduleId_idx" ON "features"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "features_moduleId_name_key" ON "features"("moduleId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_caseNum_key" ON "test_cases"("caseNum");

-- CreateIndex
CREATE INDEX "test_cases_featureId_idx" ON "test_cases"("featureId");

-- CreateIndex
CREATE INDEX "test_cases_priority_idx" ON "test_cases"("priority");

-- CreateIndex
CREATE INDEX "test_cases_severity_idx" ON "test_cases"("severity");

-- CreateIndex
CREATE INDEX "test_cases_type_idx" ON "test_cases"("type");

-- CreateIndex
CREATE INDEX "test_cycles_status_idx" ON "test_cycles"("status");

-- CreateIndex
CREATE INDEX "test_runs_cycleId_idx" ON "test_runs"("cycleId");

-- CreateIndex
CREATE INDEX "test_runs_result_idx" ON "test_runs"("result");

-- CreateIndex
CREATE UNIQUE INDEX "test_runs_cycleId_testCaseId_key" ON "test_runs"("cycleId", "testCaseId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "test_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

