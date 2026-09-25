CREATE TABLE "execution_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"repository" text NOT NULL,
	"baseBranch" text NOT NULL,
	"branch" text NOT NULL,
	"agentConfig" text NOT NULL,
	"creatorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "execution_workspace_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE cascade,
	CONSTRAINT "execution_workspace_creatorId_user_id_fk" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "execution_workspace_by_ticket" ON "execution_workspace" USING btree ("ticketId","createdAt");
