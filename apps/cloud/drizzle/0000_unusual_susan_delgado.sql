CREATE TYPE "public"."desktop_access_check_decision" AS ENUM('allowed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."desktop_access_policy_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "desktop_access_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"desktop_client_id" text NOT NULL,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"decision" "desktop_access_check_decision" NOT NULL,
	"denial_reason" text,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"minimum_desktop_version" text NOT NULL,
	"status" "desktop_access_policy_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "desktop_access_checks_organization_id_idx" ON "desktop_access_checks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "desktop_access_checks_checked_at_idx" ON "desktop_access_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "desktop_access_policies_organization_id_idx" ON "desktop_access_policies" USING btree ("organization_id");