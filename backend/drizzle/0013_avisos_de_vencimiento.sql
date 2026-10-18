CREATE TABLE "license_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recipients" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_reminders_kind" CHECK ("license_reminders"."kind" IN ('ending', 'ended')),
	CONSTRAINT "license_reminders_recipients" CHECK ("license_reminders"."recipients" BETWEEN 0 AND 3)
);
--> statement-breakpoint
ALTER TABLE "license_reminders" ADD CONSTRAINT "license_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "license_reminders_once_uq" ON "license_reminders" USING btree ("company_id","kind","ends_at");