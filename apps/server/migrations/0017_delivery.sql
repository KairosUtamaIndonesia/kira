CREATE TABLE "delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"path" text NOT NULL,
	"outcome" text NOT NULL,
	"reference" text,
	"url" text,
	"details" text,
	"actorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "delivery_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE cascade,
	CONSTRAINT "delivery_workspaceId_execution_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "execution_workspace"("id") ON DELETE cascade,
	CONSTRAINT "delivery_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "delivery_by_ticket" ON "delivery" USING btree ("ticketId","createdAt");
