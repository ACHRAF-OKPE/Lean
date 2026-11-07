CREATE TABLE "purchase_order_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text NOT NULL,
	"file_name" text,
	"file_mime" text,
	"file_size" integer,
	"file_data" "bytea",
	"notified_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_signatures_sequence_check" CHECK ("purchase_order_signatures"."sequence" between 1 and 5),
	CONSTRAINT "purchase_order_signatures_status_check" CHECK ("purchase_order_signatures"."status" in ('awaiting_upload', 'awaiting_confirmation', 'confirmed')),
	CONSTRAINT "purchase_order_signatures_file_check" CHECK (("purchase_order_signatures"."file_name" is null) = ("purchase_order_signatures"."file_mime" is null) and ("purchase_order_signatures"."file_name" is null) = ("purchase_order_signatures"."file_size" is null) and ("purchase_order_signatures"."file_name" is null) = ("purchase_order_signatures"."file_data" is null) and ("purchase_order_signatures"."file_name" is null or (char_length("purchase_order_signatures"."file_name") between 1 and 200 and "purchase_order_signatures"."file_name" !~ '[/\\]'))),
	CONSTRAINT "purchase_order_signatures_file_mime_check" CHECK ("purchase_order_signatures"."file_mime" is null or "purchase_order_signatures"."file_mime" = 'application/pdf'),
	CONSTRAINT "purchase_order_signatures_file_size_check" CHECK ("purchase_order_signatures"."file_size" is null or "purchase_order_signatures"."file_size" between 1 and 1048576),
	CONSTRAINT "purchase_order_signatures_state_file_check" CHECK (("purchase_order_signatures"."status" = 'awaiting_upload' and "purchase_order_signatures"."file_data" is null and "purchase_order_signatures"."uploaded_at" is null and "purchase_order_signatures"."confirmed_at" is null) or ("purchase_order_signatures"."status" = 'awaiting_confirmation' and "purchase_order_signatures"."file_data" is not null and "purchase_order_signatures"."uploaded_at" is not null and "purchase_order_signatures"."confirmed_at" is null) or ("purchase_order_signatures"."status" = 'confirmed' and "purchase_order_signatures"."file_data" is not null and "purchase_order_signatures"."uploaded_at" is not null and "purchase_order_signatures"."confirmed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "purchase_settings" ADD COLUMN "signer_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_signatures" ADD CONSTRAINT "purchase_order_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_signatures" ADD CONSTRAINT "purchase_order_signatures_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_signatures" ADD CONSTRAINT "purchase_order_signatures_signer_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_signatures_tenant_id_idx" ON "purchase_order_signatures" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_signatures_tenant_sequence_idx" ON "purchase_order_signatures" USING btree ("tenant_id","order_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_signatures_tenant_signer_idx" ON "purchase_order_signatures" USING btree ("tenant_id","order_id","signer_user_id");--> statement-breakpoint
CREATE INDEX "purchase_order_signatures_tenant_status_idx" ON "purchase_order_signatures" USING btree ("tenant_id","order_id","status","sequence");