ALTER TABLE "catalogs" RENAME COLUMN "file_name" TO "artistic_file_name";--> statement-breakpoint
ALTER TABLE "catalogs" RENAME COLUMN "file_url" TO "artistic_file_url";--> statement-breakpoint
ALTER TABLE "catalogs" ALTER COLUMN "processed_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogs" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;