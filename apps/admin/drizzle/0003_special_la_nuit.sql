CREATE TABLE "organization_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"upstream_model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_base_url" text NOT NULL,
	"context_window" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organization_models_organization_id_idx" ON "organization_models" USING btree ("organization_id");