CREATE TABLE "article_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_categories_title_check" CHECK (char_length("article_categories"."title") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "article_category_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Une clé étrangère composée ne se pose qu'après l'index unique (tenant_id, id) de sa table cible.
CREATE UNIQUE INDEX "article_categories_tenant_id_idx" ON "article_categories" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "article_categories" ADD CONSTRAINT "article_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_category_links" ADD CONSTRAINT "article_category_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_category_links" ADD CONSTRAINT "article_category_links_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_category_links" ADD CONSTRAINT "article_category_links_tenant_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."article_categories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_categories_tenant_title_idx" ON "article_categories" USING btree ("tenant_id",lower("title"));--> statement-breakpoint
CREATE INDEX "article_categories_tenant_active_idx" ON "article_categories" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "article_category_links_tenant_article_category_idx" ON "article_category_links" USING btree ("tenant_id","article_id","category_id");--> statement-breakpoint
CREATE INDEX "article_category_links_tenant_category_idx" ON "article_category_links" USING btree ("tenant_id","category_id");
