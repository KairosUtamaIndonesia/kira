CREATE TABLE "claim" (
	"ticketId" text PRIMARY KEY NOT NULL,
	"holderId" text NOT NULL,
	"workerId" text,
	"startedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"heardAt" timestamp with time zone,
	"leaseUntil" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_holderId_user_id_fk" FOREIGN KEY ("holderId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;