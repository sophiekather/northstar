-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "taskId" TEXT;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the first admin. Everyone else defaults to MEMBER.
-- Matches whichever domain the prod account uses (civicnorth.com / civicnorthconsulting.com).
UPDATE "User" SET "role" = 'ADMIN' WHERE lower("email") LIKE 'sophie@%';
