CREATE TYPE "public"."account_nature" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."tax_regime" AS ENUM('nrus', 'rer', 'rmt', 'general');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(200) NOT NULL,
	"nature" "account_nature" NOT NULL,
	"parent_id" uuid,
	"allows_posting" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_company_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "accounts_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "accounts_code_format" CHECK ("accounts"."code" ~ '^[1-9][0-9]{1,7}$')
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruc" varchar(11) NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"tax_regime" "tax_regime" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_ruc_uq" UNIQUE("ruc"),
	CONSTRAINT "companies_ruc_format" CHECK ("companies"."ruc" ~ '^(10|15|16|17|20)[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"description" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_number_uq" UNIQUE("company_id","fiscal_year","number"),
	CONSTRAINT "journal_entries_id_company_uq" UNIQUE("id","company_id"),
	CONSTRAINT "journal_entries_number_positive" CHECK ("journal_entries"."number" > 0),
	CONSTRAINT "journal_entries_fiscal_year" CHECK ("journal_entries"."fiscal_year" = extract(year from "journal_entries"."entry_date"))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "journal_lines_line_no_uq" UNIQUE("entry_id","line_no"),
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit_cents" > 0 AND "journal_lines"."credit_cents" = 0) OR ("journal_lines"."credit_cents" > 0 AND "journal_lines"."debit_cents" = 0)),
	CONSTRAINT "journal_lines_line_no" CHECK ("journal_lines"."line_no" BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("parent_id","company_id") REFERENCES "public"."accounts"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("entry_id","company_id") REFERENCES "public"."journal_entries"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("account_id","company_id") REFERENCES "public"."accounts"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");