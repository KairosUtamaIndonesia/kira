CREATE TABLE "gate" (
	"ticketId" text NOT NULL,
	"gatedById" text NOT NULL,
	CONSTRAINT "gate_ticketId_gatedById_pk" PRIMARY KEY("ticketId","gatedById")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"authorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "project_prefix_key" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"criteria" text[] NOT NULL,
	"gate" text NOT NULL,
	"rank" integer NOT NULL,
	"authorId" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closedAt" timestamp with time zone,
	"closure" text
);
--> statement-breakpoint
ALTER TABLE "gate" ADD CONSTRAINT "gate_ticketId_ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate" ADD CONSTRAINT "gate_gatedById_ticket_id_fk" FOREIGN KEY ("gatedById") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gate_by_gated_by" ON "gate" USING btree ("gatedById");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_number_key" ON "ticket" USING btree ("projectId","number");--> statement-breakpoint
CREATE INDEX "ticket_by_project" ON "ticket" USING btree ("projectId","rank");