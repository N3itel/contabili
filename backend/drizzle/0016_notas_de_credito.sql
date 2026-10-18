ALTER TABLE "documents" DROP CONSTRAINT "documents_doc_type";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_ruc_required";--> statement-breakpoint
ALTER TABLE "einvoices" DROP CONSTRAINT "einvoices_doc_type";--> statement-breakpoint
ALTER TABLE "einvoices" DROP CONSTRAINT "einvoices_series";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "modified_doc_type" varchar(2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "modified_series" varchar(20);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "modified_number" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "modified_issue_date" date;--> statement-breakpoint
ALTER TABLE "einvoice_settings" ADD COLUMN "factura_note_series" varchar(4) DEFAULT 'FC01' NOT NULL;--> statement-breakpoint
ALTER TABLE "einvoice_settings" ADD COLUMN "boleta_note_series" varchar(4) DEFAULT 'BC01' NOT NULL;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN "modifies_id" uuid;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN "credit_reason" varchar(2);--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_id_company_uq" UNIQUE("id","company_id");--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_modifies_fk" FOREIGN KEY ("modifies_id","company_id") REFERENCES "public"."einvoices"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "einvoices_one_note_uq" ON "einvoices" USING btree ("modifies_id") WHERE "einvoices"."modifies_id" IS NOT NULL AND "einvoices"."status" <> 'rejected';--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_credit_note" CHECK (("documents"."doc_type" = '07') = ("documents"."modified_doc_type" IS NOT NULL) AND ("documents"."doc_type" <> '07' OR ("documents"."direction" = 'sale' AND "documents"."modified_doc_type" IN ('01', '03') AND "documents"."modified_series" IS NOT NULL AND "documents"."modified_number" IS NOT NULL AND "documents"."modified_issue_date" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_doc_type" CHECK ("documents"."doc_type" IN ('01', '02', '03', '12', '00', '07'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_ruc_required" CHECK (("documents"."doc_type" NOT IN ('01', '02') AND "documents"."modified_doc_type" IS DISTINCT FROM '01') OR "documents"."counterparty_ruc" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "einvoice_settings" ADD CONSTRAINT "einvoice_settings_note_series" CHECK ("einvoice_settings"."factura_note_series" ~ '^F[A-Z0-9]{3}$' AND "einvoice_settings"."boleta_note_series" ~ '^B[A-Z0-9]{3}$');--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_credit_note" CHECK (("einvoices"."doc_type" = '07') = ("einvoices"."modifies_id" IS NOT NULL) AND ("einvoices"."doc_type" = '07') = ("einvoices"."credit_reason" IS NOT NULL) AND ("einvoices"."credit_reason" IS NULL OR "einvoices"."credit_reason" IN ('01', '02', '06')));--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_doc_type" CHECK ("einvoices"."doc_type" IN ('01', '03', '07'));--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_series" CHECK (("einvoices"."doc_type" = '01' AND "einvoices"."series" ~ '^F[A-Z0-9]{3}$') OR ("einvoices"."doc_type" = '03' AND "einvoices"."series" ~ '^B[A-Z0-9]{3}$') OR ("einvoices"."doc_type" = '07' AND "einvoices"."series" ~ '^[FB][A-Z0-9]{3}$'));