CREATE TABLE IF NOT EXISTS "outcome" (
  "id" text PRIMARY KEY NOT NULL,
  "ticketId" text NOT NULL,
  "answer" text NOT NULL,
  "sources" text[] NOT NULL,
  "decisionProposal" jsonb,
  "authorId" text,
  "sourceChatId" text,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_ticket_key" ON "outcome" USING btree ("ticketId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_by_ticket" ON "outcome" USING btree ("ticketId","createdAt");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outcome_ticketId_ticket_id_fk') THEN
    ALTER TABLE "outcome" ADD CONSTRAINT "outcome_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outcome_authorId_user_id_fk') THEN
    ALTER TABLE "outcome" ADD CONSTRAINT "outcome_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "ticket" SET "kind" = 'question' WHERE "kind" = 'decision';
