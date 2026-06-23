CREATE TABLE "organization_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_base_url" text NOT NULL,
	"api_key" text,
	"models_endpoint" text DEFAULT '/models',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_models" ADD COLUMN "provider_config_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_models" ADD COLUMN "max_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "organization_models" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
CREATE INDEX "organization_providers_organization_id_idx" ON "organization_providers" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_models" ADD CONSTRAINT "organization_models_provider_config_id_organization_providers_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."organization_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_models_provider_config_id_idx" ON "organization_models" USING btree ("provider_config_id");