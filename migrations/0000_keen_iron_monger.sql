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
CREATE TABLE "design_project_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"design_project_id" integer NOT NULL,
	"detected_object_name" text,
	"detected_object_description" text,
	"detected_object_bounding_box" jsonb,
	"suggested_product_id_1" integer,
	"match_score_1" real,
	"suggested_product_id_2" integer,
	"match_score_2" real,
	"suggested_product_id_3" integer,
	"match_score_3" real,
	"selected_product_id" integer,
	"user_feedback" text,
	"generated_inpainted_image_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"client_render_image_url" text,
	"client_floor_plan_image_url" text,
	"generated_render_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_plan_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_plan_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"area_name" text NOT NULL,
	"coordinates" json,
	"desired_product_type" text,
	"suggested_product_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ai_design_project_id" integer,
	"name" text NOT NULL,
	"original_image_url" text NOT NULL,
	"processed_image_url" text,
	"ia_prompt" text,
	"ia_status" text DEFAULT 'pending_upload' NOT NULL,
	"processing_errors" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"created_at" timestamp DEFAULT now(),
	"description" text,
	"style" text,
	"color_palette" json,
	"generated_image_url" text,
	"ia_prompt" text,
	"status" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"embedding" vector(512),
	"search_tsv" "tsvector",
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
CREATE TABLE "session" (
	"sid" varchar(255) PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text,
	"company_name" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"company_logo_url" text,
	"company_address" text,
	"company_phone" text,
	"company_cnpj" text,
	"quote_payment_terms" text,
	"quote_validity_days" integer,
	"cash_discount_percentage" integer,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_design_chat_messages" ADD CONSTRAINT "ai_design_chat_messages_project_id_design_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."design_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_design_projects" ADD CONSTRAINT "ai_design_projects_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_design_projects" ADD CONSTRAINT "ai_design_projects_moodboard_id_moodboards_id_fk" FOREIGN KEY ("moodboard_id") REFERENCES "public"."moodboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_design_project_id_design_projects_id_fk" FOREIGN KEY ("design_project_id") REFERENCES "public"."design_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_1_products_id_fk" FOREIGN KEY ("suggested_product_id_1") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_2_products_id_fk" FOREIGN KEY ("suggested_product_id_2") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_3_products_id_fk" FOREIGN KEY ("suggested_product_id_3") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_selected_product_id_products_id_fk" FOREIGN KEY ("selected_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "public"."floor_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_suggested_product_id_products_id_fk" FOREIGN KEY ("suggested_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_ai_design_project_id_ai_design_projects_id_fk" FOREIGN KEY ("ai_design_project_id") REFERENCES "public"."ai_design_projects"("id") ON DELETE set null ON UPDATE no action;