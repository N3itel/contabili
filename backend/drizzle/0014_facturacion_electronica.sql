CREATE TABLE "einvoice_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(16) NOT NULL,
	"factura_series" varchar(4) NOT NULL,
	"boleta_series" varchar(4) NOT NULL,
	"endpoint" varchar(300),
	"token_encrypted" varchar(500),
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_settings_provider" CHECK ("einvoice_settings"."provider" IN ('test', 'nubefact')),
	CONSTRAINT "einvoice_settings_factura_series" CHECK ("einvoice_settings"."factura_series" ~ '^F[A-Z0-9]{3}$'),
	CONSTRAINT "einvoice_settings_boleta_series" CHECK ("einvoice_settings"."boleta_series" ~ '^B[A-Z0-9]{3}$'),
	CONSTRAINT "einvoice_settings_nubefact_credentials" CHECK ("einvoice_settings"."provider" <> 'nubefact' OR ("einvoice_settings"."endpoint" IS NOT NULL AND "einvoice_settings"."token_encrypted" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "einvoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" varchar(2) NOT NULL,
	"series" varchar(4) NOT NULL,
	"number" integer NOT NULL,
	"issue_date" date NOT NULL,
	"provider" varchar(16) NOT NULL,
	"sale_kind" varchar(8) NOT NULL,
	"paid_with" varchar(8) NOT NULL,
	"contact_id" uuid,
	"customer_doc_type" varchar(4) NOT NULL,
	"customer_doc_number" varchar(11),
	"customer_name" varchar(120),
	"description" varchar(250) NOT NULL,
	"base_cents" bigint NOT NULL,
	"igv_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" varchar(10) NOT NULL,
	"status_message" varchar(500),
	"pdf_url" varchar(500),
	"xml_url" varchar(500),
	"cdr_url" varchar(500),
	"hash" varchar(120),
	"entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoices_number_uq" UNIQUE("company_id","doc_type","series","number"),
	CONSTRAINT "einvoices_entry_uq" UNIQUE("entry_id"),
	CONSTRAINT "einvoices_doc_type" CHECK ("einvoices"."doc_type" IN ('01', '03')),
	CONSTRAINT "einvoices_series" CHECK (("einvoices"."doc_type" = '01' AND "einvoices"."series" ~ '^F[A-Z0-9]{3}$') OR ("einvoices"."doc_type" = '03' AND "einvoices"."series" ~ '^B[A-Z0-9]{3}$')),
	CONSTRAINT "einvoices_number_range" CHECK ("einvoices"."number" BETWEEN 1 AND 99999999),
	CONSTRAINT "einvoices_provider" CHECK ("einvoices"."provider" IN ('test', 'nubefact')),
	CONSTRAINT "einvoices_status" CHECK ("einvoices"."status" IN ('pending', 'accepted', 'rejected', 'test')),
	CONSTRAINT "einvoices_sale_kind" CHECK ("einvoices"."sale_kind" IN ('goods', 'services')),
	CONSTRAINT "einvoices_paid_with" CHECK ("einvoices"."paid_with" IN ('cash', 'bank', 'credit')),
	CONSTRAINT "einvoices_customer_doc_type" CHECK ("einvoices"."customer_doc_type" IN ('ruc', 'dni', 'none')),
	CONSTRAINT "einvoices_customer" CHECK (("einvoices"."doc_type" <> '01' OR "einvoices"."customer_doc_type" = 'ruc') AND ("einvoices"."customer_doc_type" = 'none' OR ("einvoices"."customer_doc_number" IS NOT NULL AND "einvoices"."customer_name" IS NOT NULL)) AND ("einvoices"."doc_type" <> '03' OR "einvoices"."customer_doc_type" <> 'none' OR "einvoices"."total_cents" <= 70000)),
	CONSTRAINT "einvoices_amounts" CHECK ("einvoices"."base_cents" >= 0 AND "einvoices"."igv_cents" >= 0 AND "einvoices"."base_cents" + "einvoices"."igv_cents" = "einvoices"."total_cents" AND "einvoices"."total_cents" > 0),
	CONSTRAINT "einvoices_entry_status" CHECK ("einvoices"."entry_id" IS NULL OR "einvoices"."status" IN ('accepted', 'test'))
);
--> statement-breakpoint
ALTER TABLE "einvoice_settings" ADD CONSTRAINT "einvoice_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_settings" ADD CONSTRAINT "einvoice_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_entry_fk" FOREIGN KEY ("entry_id","company_id") REFERENCES "public"."journal_entries"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "einvoices_company_date_idx" ON "einvoices" USING btree ("company_id","issue_date");