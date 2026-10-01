CREATE TABLE "git_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"authKind" text NOT NULL,
	"instanceUrl" text,
	"accountLogin" text NOT NULL,
	"accountType" text DEFAULT 'User' NOT NULL,
	"installationId" bigint,
	"accessTokenEncrypted" text,
	"webhookSecretEncrypted" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"defaultBranch" text DEFAULT 'main' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"repositoryId" text,
	"provider" text DEFAULT 'github' NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"url" text NOT NULL,
	"branch" text,
	"headSha" text DEFAULT '' NOT NULL,
	"authorLogin" text,
	"mergedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pull_request" ADD CONSTRAINT "ticket_pull_request_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pull_request" ADD CONSTRAINT "ticket_pull_request_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_connection_provider_instance_key" ON "git_connection" USING btree ("provider","instanceUrl");--> statement-breakpoint
CREATE INDEX "git_connection_by_installation" ON "git_connection" USING btree ("provider","installationId");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_project_remote_key" ON "repository" USING btree ("projectId","provider","owner","name");--> statement-breakpoint
CREATE INDEX "repository_by_remote" ON "repository" USING btree ("provider","owner","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_pull_request_remote_key" ON "ticket_pull_request" USING btree ("repositoryId","number");--> statement-breakpoint
CREATE INDEX "ticket_pull_request_by_ticket" ON "ticket_pull_request" USING btree ("ticketId","createdAt");