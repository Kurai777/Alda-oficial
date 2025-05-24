ALTER TABLE "products" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "clip_embedding" vector(512);