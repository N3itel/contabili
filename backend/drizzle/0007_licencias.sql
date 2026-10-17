CREATE TYPE "public"."order_status" AS ENUM('pending', 'charging', 'paid', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "company_licenses" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"plan" varchar(16) NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"paid_through" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_licenses_plan" CHECK ("company_licenses"."plan" IN ('emprendedor', 'negocio'))
);
--> statement-breakpoint
CREATE TABLE "license_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan" varchar(16) NOT NULL,
	"cycle" varchar(8) NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" varchar(8) NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider_charge_id" varchar(64),
	"failure_code" varchar(40),
	"failure_message" varchar(200),
	"expires_at" timestamp with time zone NOT NULL,
	"charging_since" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_orders_plan" CHECK ("license_orders"."plan" IN ('emprendedor', 'negocio')),
	CONSTRAINT "license_orders_cycle" CHECK ("license_orders"."cycle" IN ('monthly', 'annual')),
	CONSTRAINT "license_orders_provider" CHECK ("license_orders"."provider" IN ('culqi', 'fake')),
	CONSTRAINT "license_orders_amount" CHECK ("license_orders"."amount_cents" BETWEEN 100 AND 500000 AND "license_orders"."amount_cents" % 100 = 0),
	CONSTRAINT "license_orders_attempts" CHECK ("license_orders"."attempts" BETWEEN 0 AND 4),
	CONSTRAINT "license_orders_paid_fields" CHECK (("license_orders"."status" = 'paid') = ("license_orders"."paid_at" IS NOT NULL AND "license_orders"."provider_charge_id" IS NOT NULL AND "license_orders"."period_end" IS NOT NULL)),
	CONSTRAINT "license_orders_charging_since" CHECK ("license_orders"."status" <> 'charging' OR "license_orders"."charging_since" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "company_licenses" ADD CONSTRAINT "company_licenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_orders" ADD CONSTRAINT "license_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_orders" ADD CONSTRAINT "license_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_orders_company_idx" ON "license_orders" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "license_orders_open_idx" ON "license_orders" USING btree ("status","created_at") WHERE "license_orders"."status" IN ('pending', 'charging');--> statement-breakpoint
CREATE UNIQUE INDEX "license_orders_charge_uq" ON "license_orders" USING btree ("provider_charge_id");