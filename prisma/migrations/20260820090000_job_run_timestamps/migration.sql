-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "JobRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows need a value, but the schema declares @updatedAt, which Prisma
-- sets from the client and expects no database default for. Dropping it here
-- keeps the database identical to what `prisma migrate dev` would produce, so
-- the next migration does not report drift.
ALTER TABLE "JobRun" ALTER COLUMN "updatedAt" DROP DEFAULT;
