CREATE TABLE "supplier_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"exchange_message_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"availability" text NOT NULL,
	"comment" text,
	"lead_time_days" integer,
	"proposed_total_xof" integer,
	"attachment_name" text,
	"attachment_mime" text,
	"attachment_size" integer,
	"attachment_data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_replies_availability_check" CHECK ("supplier_replies"."availability" in ('available', 'partial', 'unavailable')),
	CONSTRAINT "supplier_replies_author_name_check" CHECK (char_length("supplier_replies"."author_name") between 1 and 120),
	CONSTRAINT "supplier_replies_author_email_check" CHECK ("supplier_replies"."author_email" is null or char_length("supplier_replies"."author_email") <= 160),
	CONSTRAINT "supplier_replies_comment_check" CHECK ("supplier_replies"."comment" is null or char_length("supplier_replies"."comment") <= 2000),
	CONSTRAINT "supplier_replies_lead_time_check" CHECK ("supplier_replies"."lead_time_days" is null or "supplier_replies"."lead_time_days" between 0 and 365),
	CONSTRAINT "supplier_replies_total_check" CHECK ("supplier_replies"."proposed_total_xof" is null or "supplier_replies"."proposed_total_xof" between 0 and 2000000000),
	CONSTRAINT "supplier_replies_attachment_check" CHECK (("supplier_replies"."attachment_name" is null) = ("supplier_replies"."attachment_mime" is null) and ("supplier_replies"."attachment_name" is null) = ("supplier_replies"."attachment_size" is null) and ("supplier_replies"."attachment_name" is null) = ("supplier_replies"."attachment_data" is null) and ("supplier_replies"."attachment_name" is null or (char_length("supplier_replies"."attachment_name") between 1 and 200 and "supplier_replies"."attachment_name" !~ '[/\\]'))),
	CONSTRAINT "supplier_replies_attachment_mime_check" CHECK ("supplier_replies"."attachment_mime" is null or "supplier_replies"."attachment_mime" in ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
	CONSTRAINT "supplier_replies_attachment_size_check" CHECK ("supplier_replies"."attachment_size" is null or "supplier_replies"."attachment_size" between 1 and 5242880),
	CONSTRAINT "supplier_replies_attachment_data_check" CHECK ("supplier_replies"."attachment_data" is null or octet_length("supplier_replies"."attachment_data") = "supplier_replies"."attachment_size")
);
--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD COLUMN "reply_token_hash" text;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD COLUMN "reply_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_replies" ADD CONSTRAINT "supplier_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_replies" ADD CONSTRAINT "supplier_replies_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_replies" ADD CONSTRAINT "supplier_replies_tenant_message_fk" FOREIGN KEY ("tenant_id","exchange_message_id") REFERENCES "public"."exchange_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_replies_tenant_id_idx" ON "supplier_replies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "supplier_replies_tenant_order_idx" ON "supplier_replies" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_replies_tenant_message_idx" ON "supplier_replies" USING btree ("tenant_id","exchange_message_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_messages_reply_token_idx" ON "exchange_messages" USING btree ("reply_token_hash") WHERE "exchange_messages"."reply_token_hash" is not null;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_reply_token_check" CHECK (("exchange_messages"."reply_token_hash" is null) = ("exchange_messages"."reply_token_expires_at" is null) and ("exchange_messages"."reply_token_hash" is null or "exchange_messages"."reply_token_hash" ~ '^[0-9a-f]{64}$'));