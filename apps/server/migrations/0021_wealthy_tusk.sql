CREATE TABLE "ticket_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"actorId" text,
	"actorKind" text DEFAULT 'member' NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"parentId" text,
	"authorId" text,
	"authorKind" text DEFAULT 'member' NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_parentId_ticket_comment_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."ticket_comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_activity_by_ticket" ON "ticket_activity" USING btree ("ticketId","createdAt");--> statement-breakpoint
CREATE INDEX "ticket_comment_by_ticket" ON "ticket_comment" USING btree ("ticketId","createdAt");--> statement-breakpoint
CREATE INDEX "ticket_comment_by_parent" ON "ticket_comment" USING btree ("parentId");