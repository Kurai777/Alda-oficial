ALTER TABLE "users" RENAME COLUMN "firebase_id" TO "company_logo_url";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_firebase_id_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_cnpj" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quote_payment_terms" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quote_validity_days" integer;