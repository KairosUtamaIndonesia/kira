CREATE TABLE "desktop_signin_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handoff_code_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"organization_name" text NOT NULL,
	"api_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_signin_handoffs_handoff_code_hash_uidx" ON "desktop_signin_handoffs" USING btree ("handoff_code_hash");