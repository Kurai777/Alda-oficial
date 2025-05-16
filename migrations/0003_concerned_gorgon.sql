-- CREATE TABLE "design_project_items" (
-- 	"id" serial PRIMARY KEY NOT NULL,
-- 	"design_project_id" integer NOT NULL,
-- 	"detected_object_description" text,
-- 	"detected_object_bounding_box" json,
-- 	"suggested_product_id_1" integer,
-- 	"match_score_1" real,
-- 	"suggested_product_id_2" integer,
-- 	"match_score_2" real,
-- 	"suggested_product_id_3" integer,
-- 	"match_score_3" real,
-- 	"selected_product_id" integer,
-- 	"user_feedback" text,
-- 	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
-- 	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
-- );
--> statement-breakpoint
-- CREATE TABLE "design_projects" (
-- 	"id" serial PRIMARY KEY NOT NULL,
-- 	"user_id" integer NOT NULL,
-- 	"name" text NOT NULL,
-- 	"status" text DEFAULT 'new' NOT NULL,
-- 	"client_render_image_url" text,
-- 	"client_floor_plan_image_url" text,
-- 	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
-- 	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
-- );
--> statement-breakpoint
-- ALTER TABLE "ai_design_chat_messages" DROP CONSTRAINT "ai_design_chat_messages_project_id_ai_design_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "moodboards" ALTER COLUMN "product_ids" SET DEFAULT '[]'::json;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "description" text;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "style" text;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "color_palette" json DEFAULT '[]'::json;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "generated_image_url" text;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "ia_prompt" text;
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "status" text DEFAULT 'pending_generation';
--> statement-breakpoint
ALTER TABLE "moodboards" ADD COLUMN "updated_at" timestamp DEFAULT now();
--> statement-breakpoint
-- ALTER TABLE "products" ADD COLUMN "embedding" vector(768);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cash_discount_percentage" integer;
--> statement-breakpoint
-- ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_design_project_id_design_projects_id_fk" FOREIGN KEY ("design_project_id") REFERENCES "public"."design_projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_1_products_id_fk" FOREIGN KEY ("suggested_product_id_1") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_2_products_id_fk" FOREIGN KEY ("suggested_product_id_2") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_suggested_product_id_3_products_id_fk" FOREIGN KEY ("suggested_product_id_3") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- ALTER TABLE "design_project_items" ADD CONSTRAINT "design_project_items_selected_product_id_products_id_fk" FOREIGN KEY ("selected_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
-- ALTER TABLE "ai_design_chat_messages" ADD CONSTRAINT "ai_design_chat_messages_project_id_design_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."design_projects"("id") ON DELETE cascade ON UPDATE no action;