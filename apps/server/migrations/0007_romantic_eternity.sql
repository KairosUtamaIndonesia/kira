CREATE TABLE "transcript" (
	"id" text PRIMARY KEY NOT NULL,
	"runId" text NOT NULL,
	"saidBy" text NOT NULL,
	"words" text NOT NULL,
	"at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_runId_run_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_by_run" ON "transcript" USING btree ("runId","at");