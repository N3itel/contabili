CREATE TYPE "public"."contact_kind" AS ENUM('customer', 'supplier');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"name" varchar(120) NOT NULL,
	"ruc" varchar(11),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "contacts_ruc_format" CHECK ("contacts"."ruc" IS NULL OR "contacts"."ruc" ~ '^(10|15|16|17|20)[0-9]{9}$'),
	CONSTRAINT "contacts_name_length" CHECK (char_length("contacts"."name") >= 2)
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_ruc_uq" ON "contacts" USING btree ("company_id","kind","ruc") WHERE "contacts"."ruc" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id","kind","name");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_contact_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_contact_idx" ON "journal_lines" USING btree ("contact_id");