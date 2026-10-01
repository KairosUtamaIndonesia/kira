CREATE TABLE "pull_request_check" (
	"id" text PRIMARY KEY NOT NULL,
	"pullRequestId" text NOT NULL,
	"context" text NOT NULL,
	"state" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_request_check" ADD CONSTRAINT "pull_request_check_pullRequestId_ticket_pull_request_id_fk" FOREIGN KEY ("pullRequestId") REFERENCES "public"."ticket_pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_check_context_key" ON "pull_request_check" USING btree ("pullRequestId","context");--> statement-breakpoint
CREATE INDEX "pull_request_check_by_pull_request" ON "pull_request_check" USING btree ("pullRequestId");