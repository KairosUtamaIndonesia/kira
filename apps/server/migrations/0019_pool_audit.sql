CREATE TABLE "pool_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"actorLabel" text NOT NULL,
	"action" text NOT NULL,
	"provider" text,
	"credentialLabel" text,
	"outcome" text NOT NULL,
	"detail" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_audit_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "pool_audit_by_created_at" ON "pool_audit" USING btree ("createdAt");
