CREATE TABLE "license_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'queued' NOT NULL,
	"provider" varchar(16) NOT NULL,
	"series" varchar(4),
	"number" integer,
	"issue_date" date,
	"customer_ruc" varchar(11) NOT NULL,
	"customer_name" varchar(200) NOT NULL,
	"description" varchar(250) NOT NULL,
	"base_cents" bigint NOT NULL,
	"igv_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"status_message" varchar(500),
	"pdf_url" varchar(500),
	"hash" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_receipts_status" CHECK ("license_receipts"."status" IN ('queued', 'pending', 'accepted', 'rejected', 'test')),
	CONSTRAINT "license_receipts_provider" CHECK ("license_receipts"."provider" IN ('test', 'nubefact')),
	CONSTRAINT "license_receipts_number" CHECK (("license_receipts"."status" = 'queued') = ("license_receipts"."number" IS NULL) AND ("license_receipts"."number" IS NULL) = ("license_receipts"."series" IS NULL) AND ("license_receipts"."number" IS NULL) = ("license_receipts"."issue_date" IS NULL) AND ("license_receipts"."series" IS NULL OR "license_receipts"."series" ~ '^F[A-Z0-9]{3}$') AND ("license_receipts"."number" IS NULL OR "license_receipts"."number" BETWEEN 1 AND 99999999)),
	CONSTRAINT "license_receipts_ruc" CHECK ("license_receipts"."customer_ruc" ~ '^(10|15|16|17|20)[0-9]{9}$'),
	CONSTRAINT "license_receipts_amounts" CHECK ("license_receipts"."base_cents" >= 0 AND "license_receipts"."igv_cents" >= 0 AND "license_receipts"."base_cents" + "license_receipts"."igv_cents" = "license_receipts"."total_cents" AND "license_receipts"."total_cents" > 0),
	CONSTRAINT "license_receipts_attempts" CHECK ("license_receipts"."attempts" BETWEEN 0 AND 50)
);
--> statement-breakpoint
ALTER TABLE "license_receipts" ADD CONSTRAINT "license_receipts_order_id_license_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."license_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_receipts" ADD CONSTRAINT "license_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "license_receipts_order_uq" ON "license_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_receipts_number_uq" ON "license_receipts" USING btree ("series","number");--> statement-breakpoint
CREATE INDEX "license_receipts_company_idx" ON "license_receipts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "license_receipts_open_idx" ON "license_receipts" USING btree ("status","created_at") WHERE "license_receipts"."status" IN ('queued', 'pending');