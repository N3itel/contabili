CREATE TABLE "period_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"action" varchar(8) NOT NULL,
	"previous_closed_through" date,
	"closed_through" date,
	"reason" varchar(300),
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_closings_action" CHECK ("period_closings"."action" IN ('close', 'reopen')),
	CONSTRAINT "period_closings_reopen_reason" CHECK ("period_closings"."action" <> 'reopen' OR "period_closings"."reason" IS NOT NULL),
	CONSTRAINT "period_closings_close_date" CHECK ("period_closings"."action" <> 'close' OR "period_closings"."closed_through" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "closed_through" date;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_closings_company_idx" ON "period_closings" USING btree ("company_id","created_at");