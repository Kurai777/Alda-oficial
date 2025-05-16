CREATE TABLE "floor_plan_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_plan_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"area_name" text,
	"coordinates" json NOT NULL,
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
	"ai_design_project_id" integer NOT NULL,
	"name" text DEFAULT 'Minha Planta Baixa' NOT NULL,
	"original_image_url" text NOT NULL,
	"processed_image_url" text,
	"ia_prompt" text,
	"ia_status" text DEFAULT 'pending_upload',
	"processing_errors" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "embedding" SET DATA TYPE vector(512);--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "public"."floor_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_suggested_product_id_products_id_fk" FOREIGN KEY ("suggested_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_ai_design_project_id_ai_design_projects_id_fk" FOREIGN KEY ("ai_design_project_id") REFERENCES "public"."ai_design_projects"("id") ON DELETE cascade ON UPDATE no action;