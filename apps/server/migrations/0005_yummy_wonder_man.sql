CREATE TABLE "run" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"driverId" text,
	"workerId" text,
	"startedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"contract" text[] NOT NULL,
	"branch" text,
	"endedAt" timestamp with time zone,
	"stoppedBecause" text,
	"changed" text,
	"checks" text[],
	"made" text,
	"verdict" text,
	"verdictAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_driverId_user_id_fk" FOREIGN KEY ("driverId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_by_ticket" ON "run" USING btree ("ticketId","startedAt");