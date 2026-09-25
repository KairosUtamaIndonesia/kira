CREATE TABLE "memory" (
	"userId" text PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"reflectingModel" text
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;