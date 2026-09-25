CREATE TABLE "allowance" (
	"userId" text PRIMARY KEY NOT NULL,
	"tokensPerMonth" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "allowance" ADD CONSTRAINT "allowance_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;