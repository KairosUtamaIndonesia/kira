CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"actorLabel" text NOT NULL,
	"action" text NOT NULL,
	"targetId" text,
	"targetLabel" text,
	"outcome" text NOT NULL,
	"detail" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_targetId_user_id_fk" FOREIGN KEY ("targetId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_by_created_at" ON "admin_audit" USING btree ("createdAt");