CREATE TABLE "review_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"runId" text,
	"path" text NOT NULL,
	"line" integer NOT NULL,
	"side" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"authorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"addressedAt" timestamp with time zone,
	CONSTRAINT "review_comment_workspaceId_execution_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "execution_workspace"("id") ON DELETE cascade,
	CONSTRAINT "review_comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "review_comment_by_workspace" ON "review_comment" USING btree ("workspaceId","createdAt");
--> statement-breakpoint
CREATE TABLE "review_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"runId" text,
	"body" text NOT NULL,
	"authorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "review_feedback_workspaceId_execution_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "execution_workspace"("id") ON DELETE cascade,
	CONSTRAINT "review_feedback_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "review_feedback_by_workspace" ON "review_feedback" USING btree ("workspaceId","createdAt");
