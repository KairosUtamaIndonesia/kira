CREATE TABLE "decision" (
  "id" text PRIMARY KEY NOT NULL,
  "projectId" text NOT NULL,
  "context" text NOT NULL,
  "choice" text NOT NULL,
  "rejectedOptions" text[] NOT NULL,
  "consequences" text NOT NULL,
  "authorId" text,
  "sourceChatId" text,
  "supersededById" text,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "decision_by_project" ON "decision" USING btree ("projectId","createdAt");
--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
