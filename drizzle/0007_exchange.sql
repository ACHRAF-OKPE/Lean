CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"username" text,
	"password_ciphertext" text,
	"from_name" text NOT NULL,
	"from_address" text NOT NULL,
	"reply_to" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_accounts_name_check" CHECK (char_length("email_accounts"."name") between 1 and 80),
	CONSTRAINT "email_accounts_host_check" CHECK (char_length("email_accounts"."host") between 1 and 255),
	CONSTRAINT "email_accounts_port_check" CHECK ("email_accounts"."port" between 1 and 65535),
	CONSTRAINT "email_accounts_security_check" CHECK ("email_accounts"."security" in ('tls', 'starttls', 'none')),
	CONSTRAINT "email_accounts_credentials_check" CHECK (("email_accounts"."username" is null) = ("email_accounts"."password_ciphertext" is null)),
	CONSTRAINT "email_accounts_from_name_check" CHECK (char_length("email_accounts"."from_name") between 1 and 120),
	CONSTRAINT "email_accounts_from_address_check" CHECK (char_length("email_accounts"."from_address") between 3 and 160),
	CONSTRAINT "email_accounts_reply_to_check" CHECK ("email_accounts"."reply_to" is null or char_length("email_accounts"."reply_to") <= 160)
);
--> statement-breakpoint
CREATE TABLE "exchange_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"order_id" uuid NOT NULL,
	"template_id" uuid,
	"template_name" text NOT NULL,
	"recipient" text NOT NULL,
	"recipient_name" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text NOT NULL,
	"attachment_name" text NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"actor_user_id" uuid,
	"resent_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "exchange_messages_type_check" CHECK ("exchange_messages"."type" in ('purchase_request', 'purchase_confirmation')),
	CONSTRAINT "exchange_messages_status_check" CHECK ("exchange_messages"."status" in ('sent', 'failed')),
	CONSTRAINT "exchange_messages_terminal_check" CHECK (("exchange_messages"."status" = 'sent' and "exchange_messages"."sent_at" is not null and "exchange_messages"."error_message" is null) or ("exchange_messages"."status" = 'failed' and "exchange_messages"."sent_at" is null and "exchange_messages"."error_message" is not null)),
	CONSTRAINT "exchange_messages_template_check" CHECK (char_length("exchange_messages"."template_name") between 1 and 120),
	CONSTRAINT "exchange_messages_recipient_check" CHECK (char_length("exchange_messages"."recipient") between 3 and 160),
	CONSTRAINT "exchange_messages_recipient_name_check" CHECK ("exchange_messages"."recipient_name" is null or char_length("exchange_messages"."recipient_name") <= 120),
	CONSTRAINT "exchange_messages_subject_check" CHECK (char_length("exchange_messages"."subject") between 1 and 200),
	CONSTRAINT "exchange_messages_body_text_check" CHECK (char_length("exchange_messages"."body_text") between 1 and 20000),
	CONSTRAINT "exchange_messages_body_html_check" CHECK (char_length("exchange_messages"."body_html") between 1 and 60000),
	CONSTRAINT "exchange_messages_attachment_check" CHECK (char_length("exchange_messages"."attachment_name") between 1 and 200),
	CONSTRAINT "exchange_messages_error_check" CHECK ("exchange_messages"."error_message" is null or char_length("exchange_messages"."error_message") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "exchange_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_templates_type_check" CHECK ("exchange_templates"."type" in ('purchase_request', 'purchase_confirmation')),
	CONSTRAINT "exchange_templates_name_check" CHECK (char_length("exchange_templates"."name") between 1 and 120),
	CONSTRAINT "exchange_templates_subject_check" CHECK (char_length("exchange_templates"."subject") between 1 and 200),
	CONSTRAINT "exchange_templates_body_check" CHECK (char_length("exchange_templates"."body") between 1 and 6000),
	CONSTRAINT "exchange_templates_default_active_check" CHECK (not "exchange_templates"."is_default" or "exchange_templates"."active")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_tenant_idx" ON "email_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_tenant_id_idx" ON "email_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_messages_tenant_id_idx" ON "exchange_messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "exchange_messages_tenant_created_idx" ON "exchange_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "exchange_messages_tenant_order_idx" ON "exchange_messages" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_templates_tenant_name_idx" ON "exchange_templates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_templates_tenant_id_idx" ON "exchange_templates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_templates_default_idx" ON "exchange_templates" USING btree ("tenant_id","type") WHERE "exchange_templates"."is_default";--> statement-breakpoint
CREATE INDEX "exchange_templates_tenant_type_idx" ON "exchange_templates" USING btree ("tenant_id","type","active");--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."exchange_templates"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_tenant_resent_fk" FOREIGN KEY ("tenant_id","resent_from_id") REFERENCES "public"."exchange_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_templates" ADD CONSTRAINT "exchange_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_templates" ADD CONSTRAINT "exchange_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;