CREATE TABLE "ai_design_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"role" text NOT NULL,
	"content" text NOT NULL,
	"attachment_url" text
);
--> statement-breakpoint
CREATE TABLE "ai_design_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"floor_plan_image_url" text,
	"render_image_url" text,
	"generated_floor_plan_url" text,
	"generated_render_url" text,
	"quote_id" integer,
	"moodboard_id" integer
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"processed_status" text DEFAULT 'pending',
	"firestore_catalog_id" text,
	"firebase_user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moodboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"quote_id" integer,
	"project_name" text NOT NULL,
	"client_name" text,
	"architect_name" text,
	"file_url" text,
	"product_ids" json NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"catalog_id" integer,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"category" text,
	"manufacturer" text,
	"image_url" text,
	"colors" json DEFAULT '[]'::json,
	"materials" json DEFAULT '[]'::json,
	"sizes" json DEFAULT '[]'::json,
	"location" text,
	"stock" integer,
	"excel_row_number" integer,
	"created_at" timestamp DEFAULT now(),
	"firestore_id" text,
	"firebase_user_id" text,
	"is_edited" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"architect_name" text,
	"notes" text,
	"items" json NOT NULL,
	"total_price" integer NOT NULL,
	"file_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"company_name" text NOT NULL,
	"firebase_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_firebase_id_unique" UNIQUE("firebase_id")
);
--> statement-breakpoint
ALTER TABLE "ai_design_chat_messages" ADD CONSTRAINT "ai_design_chat_messages_project_id_ai_design_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_design_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_design_projects" ADD CONSTRAINT "ai_design_projects_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_design_projects" ADD CONSTRAINT "ai_design_projects_moodboard_id_moodboards_id_fk" FOREIGN KEY ("moodboard_id") REFERENCES "public"."moodboards"("id") ON DELETE no action ON UPDATE no action;