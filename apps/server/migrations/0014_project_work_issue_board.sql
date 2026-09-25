ALTER TABLE "ticket" ADD COLUMN "status" text DEFAULT 'backlog' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "assigneeId" text;
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assigneeId_user_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "ticket_relationship" (
	"issueId" text NOT NULL,
	"relatedIssueId" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "ticket_relationship_issueId_relatedIssueId_type_pk" PRIMARY KEY("issueId","relatedIssueId","type")
);
--> statement-breakpoint
ALTER TABLE "ticket_relationship" ADD CONSTRAINT "ticket_relationship_issueId_ticket_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_relationship" ADD CONSTRAINT "ticket_relationship_relatedIssueId_ticket_id_fk" FOREIGN KEY ("relatedIssueId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_relationship_by_related" ON "ticket_relationship" USING btree ("relatedIssueId");
