CREATE TABLE "skill" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"authorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_file" (
	"id" text PRIMARY KEY NOT NULL,
	"skillId" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skillId_skill_id_fk" FOREIGN KEY ("skillId") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_project_name_key" ON "skill" USING btree ("projectId","name");--> statement-breakpoint
CREATE INDEX "skill_by_project" ON "skill" USING btree ("projectId","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_file_skill_path_key" ON "skill_file" USING btree ("skillId","path");