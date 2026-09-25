CREATE TABLE "glossary_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"term" text NOT NULL,
	"meaning" text NOT NULL,
	"wordsToAvoid" text[] NOT NULL,
	"authorId" text,
	"chatId" text NOT NULL,
	"version" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "glossary_entry_project_term_key" UNIQUE("projectId","term")
);
--> statement-breakpoint
CREATE TABLE "glossary_history" (
	"id" text PRIMARY KEY NOT NULL,
	"entryId" text NOT NULL,
	"version" integer NOT NULL,
	"term" text NOT NULL,
	"meaning" text NOT NULL,
	"wordsToAvoid" text[] NOT NULL,
	"authorId" text,
	"chatId" text NOT NULL,
	"changedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "glossary_history_entry_version_key" UNIQUE("entryId","version")
);
--> statement-breakpoint
ALTER TABLE "glossary_entry" ADD CONSTRAINT "glossary_entry_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "glossary_entry" ADD CONSTRAINT "glossary_entry_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "glossary_history" ADD CONSTRAINT "glossary_history_entryId_glossary_entry_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."glossary_entry"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "glossary_history" ADD CONSTRAINT "glossary_history_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "glossary_entry_by_project" ON "glossary_entry" USING btree ("projectId","updatedAt");
--> statement-breakpoint
CREATE INDEX "glossary_history_by_entry" ON "glossary_history" USING btree ("entryId","version");
