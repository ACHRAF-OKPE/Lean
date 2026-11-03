CREATE TABLE "stock_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_internal_location_id" uuid,
	"default_min_stock_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"adjustment_reason_required" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_settings_min_stock_check" CHECK ("stock_settings"."default_min_stock_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_locations" DROP CONSTRAINT "stock_locations_type_check";--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT "stock_moves_type_check";--> statement-breakpoint
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_tenant_default_location_fk" FOREIGN KEY ("tenant_id","default_internal_location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_settings_tenant_idx" ON "stock_settings" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_type_check" CHECK ("stock_locations"."type" in ('internal', 'supplier', 'customer', 'inventory'));--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_type_check" CHECK ("stock_moves"."type" in ('incoming', 'outgoing', 'transfer'));