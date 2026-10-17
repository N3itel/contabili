ALTER TABLE "companies" DROP CONSTRAINT "companies_ruc_uq";--> statement-breakpoint
CREATE INDEX "companies_ruc_idx" ON "companies" USING btree ("ruc");