CREATE TABLE "partner_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_categories_title_check" CHECK (char_length("partner_categories"."title") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "partner_category_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "latitude" numeric(8, 5);--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "longitude" numeric(9, 5);--> statement-breakpoint
-- Une clé étrangère composée ne se pose qu'après l'index unique (tenant_id, id) de sa table cible.
CREATE UNIQUE INDEX "partner_categories_tenant_id_idx" ON "partner_categories" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "partner_categories" ADD CONSTRAINT "partner_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_category_links" ADD CONSTRAINT "partner_category_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_category_links" ADD CONSTRAINT "partner_category_links_tenant_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_category_links" ADD CONSTRAINT "partner_category_links_tenant_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."partner_categories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_categories_tenant_title_idx" ON "partner_categories" USING btree ("tenant_id",lower("title"));--> statement-breakpoint
CREATE INDEX "partner_categories_tenant_active_idx" ON "partner_categories" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_category_links_tenant_partner_category_idx" ON "partner_category_links" USING btree ("tenant_id","partner_id","category_id");--> statement-breakpoint
CREATE INDEX "partner_category_links_tenant_category_idx" ON "partner_category_links" USING btree ("tenant_id","category_id");--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_latitude_check" CHECK ("partners"."latitude" is null or "partners"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_longitude_check" CHECK ("partners"."longitude" is null or "partners"."longitude" between -180 and 180);