ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_logo_check";--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_logo_check" CHECK (
  ("logo_data" is null and "logo_mime" is null) or
  ("logo_data" is not null and "logo_mime" is not null and "logo_mime" in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'))
);
