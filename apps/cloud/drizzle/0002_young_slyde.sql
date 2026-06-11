CREATE TABLE "ssoProvider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false,
	CONSTRAINT "ssoProvider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssoProvider_userId_idx" ON "ssoProvider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssoProvider_organizationId_idx" ON "ssoProvider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ssoProvider_domain_idx" ON "ssoProvider" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "ssoProvider_providerId_uidx" ON "ssoProvider" USING btree ("provider_id");