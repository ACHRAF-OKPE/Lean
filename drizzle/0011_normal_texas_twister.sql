ALTER TABLE "tasks" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "elapsed_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "tasks" SET "started_at" = "updated_at" WHERE "status" = 'in_progress';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_started_check" CHECK (("tasks"."status" = 'in_progress') = ("tasks"."started_at" is not null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_elapsed_check" CHECK ("tasks"."elapsed_seconds" >= 0);