UPDATE "ticket" AS item
SET "status" = CASE
  WHEN item."closedAt" IS NOT NULL AND item."closure" = 'wontfix' THEN 'wont-do'
  WHEN item."closedAt" IS NOT NULL THEN 'done'
  WHEN item."status" = 'cancelled' THEN 'wont-do'
  WHEN item."status" = 'todo' THEN 'ready'
  WHEN item."status" = 'in-progress' THEN 'running'
  WHEN item."status" = 'in-review' THEN 'needs-review'
  WHEN EXISTS (SELECT 1 FROM "claim" WHERE "ticketId" = item."id") THEN 'running'
  WHEN EXISTS (
    SELECT 1
    FROM "run" AS latest
    WHERE latest."ticketId" = item."id"
      AND latest."endedAt" IS NOT NULL
      AND latest."verdict" IS NULL
      AND latest."startedAt" = (
        SELECT max(previous."startedAt") FROM "run" AS previous WHERE previous."ticketId" = item."id"
      )
  ) THEN 'needs-review'
  WHEN item."kind" = 'question' AND item."sourceChatId" IS NOT NULL THEN 'needs-review'
  WHEN item."gate" = 'ready-for-human' THEN 'needs-review'
  WHEN item."gate" = 'draft' THEN 'draft'
  ELSE 'ready'
END;
--> statement-breakpoint
DROP TABLE "review_comment";
--> statement-breakpoint
DROP TABLE "review_feedback";
--> statement-breakpoint
DROP TABLE "delivery";
--> statement-breakpoint
DROP TABLE "execution_workspace";
--> statement-breakpoint
DROP TABLE "transcript";
--> statement-breakpoint
DROP TABLE "run";
--> statement-breakpoint
DROP TABLE "claim";
--> statement-breakpoint
DROP TABLE "worker";
--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "gate";
--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "closedAt";
--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "closure";
