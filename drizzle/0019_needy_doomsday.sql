CREATE TABLE "module_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"level" text NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_grants_module_check" CHECK ("module_grants"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting')),
	CONSTRAINT "module_grants_level_check" CHECK ("module_grants"."level" in ('none', 'read', 'write', 'manage'))
);
--> statement-breakpoint
CREATE TABLE "module_responsibles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_responsibles_module_check" CHECK ("module_responsibles"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting'))
);
--> statement-breakpoint
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_responsibles" ADD CONSTRAINT "module_responsibles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_responsibles" ADD CONSTRAINT "module_responsibles_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_responsibles" ADD CONSTRAINT "module_responsibles_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_grants_tenant_user_module_idx" ON "module_grants" USING btree ("tenant_id","user_id","module");--> statement-breakpoint
CREATE INDEX "module_grants_tenant_module_idx" ON "module_grants" USING btree ("tenant_id","module");--> statement-breakpoint
CREATE UNIQUE INDEX "module_responsibles_tenant_module_idx" ON "module_responsibles" USING btree ("tenant_id","module");--> statement-breakpoint
CREATE INDEX "module_responsibles_tenant_user_idx" ON "module_responsibles" USING btree ("tenant_id","user_id");