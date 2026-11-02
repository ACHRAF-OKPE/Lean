import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { parsePartnerFilters } from "@/modules/catalog/filters";
import { categoriesByPartner } from "@/modules/catalog/partner-queries";
import { listPartners } from "@/modules/catalog/queries";
import { buildPartnersExport, partnersExportFileName } from "@/modules/catalog/xlsx";

function rawParams(url: URL): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }
  return raw;
}

/** GEN-017 — l'export reprend le jeu filtré, ou seulement la sélection qui lui est ajoutée. */
export async function GET(request: Request): Promise<Response> {
  const session = await requireModule("partners", "read");
  const filters = parsePartnerFilters(rawParams(new URL(request.url)));

  const db = getDb();
  const page = await listPartners(db, session.tenantId, filters);
  const categories = await categoriesByPartner(
    db,
    session.tenantId,
    page.rows.map((row) => row.id),
  );

  const bytes = await buildPartnersExport(
    page.rows.map((row) => ({
      code: row.code,
      name: row.name,
      type: row.type,
      isCustomer: row.isCustomer,
      isSupplier: row.isSupplier,
      email: row.email,
      phone: row.phone,
      address: row.addressLine,
      city: row.city,
      countryCode: row.countryCode,
      taxNumber: row.taxNumber,
      paymentTermDays: row.paymentTermDays,
      active: row.active,
      categories: (categories.get(row.id) ?? []).map((category) => category.title),
      latitude: row.latitude,
      longitude: row.longitude,
    })),
  );

  return new Response(new Blob([bytes]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${partnersExportFileName()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
