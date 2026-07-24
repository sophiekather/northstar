-- Per-user, per-project billable presets (UserProjectBillableDefault)
-- Apply in Railway → Postgres → Database → Data SQL box BEFORE/WITH the code deploy.
-- The box is single-statement: paste each statement below one at a time.
-- All statements are additive — no existing data is touched.

-- 1
CREATE TABLE "UserProjectBillableDefault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "isBillable" BOOLEAN NOT NULL,

    CONSTRAINT "UserProjectBillableDefault_pkey" PRIMARY KEY ("id")
);

-- 2
CREATE UNIQUE INDEX "UserProjectBillableDefault_userId_projectId_key" ON "UserProjectBillableDefault"("userId", "projectId");

-- 3
ALTER TABLE "UserProjectBillableDefault" ADD CONSTRAINT "UserProjectBillableDefault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4
ALTER TABLE "UserProjectBillableDefault" ADD CONSTRAINT "UserProjectBillableDefault_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
