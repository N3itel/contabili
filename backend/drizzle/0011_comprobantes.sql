CREATE TYPE "public"."document_direction" AS ENUM('sale', 'purchase');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"direction" "document_direction" NOT NULL,
	"doc_type" varchar(2) NOT NULL,
	"series" varchar(20) NOT NULL,
	"number" integer NOT NULL,
	"issue_date" date NOT NULL,
	"counterparty_ruc" varchar(11),
	"counterparty_name" varchar(120),
	"base_cents" bigint NOT NULL,
	"igv_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_entry_uq" UNIQUE("entry_id"),
	CONSTRAINT "documents_doc_type" CHECK ("documents"."doc_type" IN ('01', '02', '03', '12', '00')),
	CONSTRAINT "documents_recibo_purchase" CHECK ("documents"."doc_type" <> '02' OR "documents"."direction" = 'purchase'),
	CONSTRAINT "documents_ruc_required" CHECK ("documents"."doc_type" NOT IN ('01', '02') OR "documents"."counterparty_ruc" IS NOT NULL),
	CONSTRAINT "documents_ruc_format" CHECK ("documents"."counterparty_ruc" IS NULL OR "documents"."counterparty_ruc" ~ '^(10|15|16|17|20)[0-9]{9}$'),
	CONSTRAINT "documents_series_format" CHECK ("documents"."series" ~ '^[A-Z0-9-]{1,20}$'),
	CONSTRAINT "documents_number_range" CHECK ("documents"."number" BETWEEN 1 AND 99999999),
	CONSTRAINT "documents_amounts" CHECK ("documents"."base_cents" >= 0 AND "documents"."igv_cents" >= 0 AND "documents"."base_cents" + "documents"."igv_cents" = "documents"."total_cents" AND "documents"."total_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entry_fk" FOREIGN KEY ("entry_id","company_id") REFERENCES "public"."journal_entries"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sale_uq" ON "documents" USING btree ("company_id","doc_type","series","number") WHERE "documents"."direction" = 'sale';--> statement-breakpoint
CREATE UNIQUE INDEX "documents_purchase_uq" ON "documents" USING btree ("company_id","doc_type","series","number","counterparty_ruc") WHERE "documents"."direction" = 'purchase';--> statement-breakpoint
CREATE INDEX "documents_register_idx" ON "documents" USING btree ("company_id","direction","issue_date");