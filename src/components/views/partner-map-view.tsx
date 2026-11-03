import Link from "next/link";
import { MapPin } from "lucide-react";
import { geolocationStats, groupByPlace, projectPoint } from "@/modules/catalog/coordinates";

const CARD = "rounded-xl border border-line bg-panel px-4 py-3";
const CARD_LABEL = "font-mono text-[9px] tracking-[0.14em] text-muted uppercase";
const CARD_VALUE = "mt-1 text-lg font-medium tabular-nums";

/** ART-011 — la carte place un point par lieu géolocalisé et rappelle ce qui reste à placer. */
export function PartnerMapView({
  rows,
}: {
  rows: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly city: string | null;
    readonly countryCode: string | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
  }[];
}) {
  const stats = geolocationStats(rows);
  const places = groupByPlace(rows);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={CARD}>
          <p className={CARD_LABEL}>Tiers du jeu</p>
          <p className={CARD_VALUE}>{stats.total}</p>
        </div>
        <div className={CARD}>
          <p className={CARD_LABEL}>Géolocalisés</p>
          <p className={CARD_VALUE}>{stats.geolocated}</p>
        </div>
        <div className={CARD}>
          <p className={CARD_LABEL}>Lieux distincts</p>
          <p className={CARD_VALUE}>{stats.places}</p>
        </div>
        <div className={CARD}>
          <p className={CARD_LABEL}>À placer</p>
          <p className={`${CARD_VALUE} ${stats.missing > 0 ? "text-copper" : ""}`}>
            {stats.missing}
          </p>
        </div>
      </div>

      <figure className="rounded-xl border border-line bg-panel">
        <figcaption className="border-b border-line px-4 py-2.5 text-[10px] leading-4 text-muted">
          Projection équirectangulaire sur les coordonnées saisies : aucun fond de carte ni service
          de tuiles n&apos;est appelé. Chaque point mène au premier tiers du lieu.
        </figcaption>

        {places.length === 0 ? (
          <p className="px-5 py-16 text-center text-[11px] leading-5 text-muted">
            Aucun tiers du jeu filtré ne porte de coordonnées. Renseignez la latitude et la
            longitude depuis la fiche d&apos;un tiers pour le voir apparaître ici.
          </p>
        ) : (
          <div
            role="img"
            aria-label={`Carte : ${places.length} lieu${places.length > 1 ? "x" : ""} pour ${stats.geolocated} tiers géolocalisés.`}
            className="relative m-4 aspect-[2/1] overflow-hidden rounded-lg border border-line bg-canvas"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px 10%), repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px 10%)",
            }}
          >
            {places.map((place) => {
              const point = projectPoint(place.latitude, place.longitude);
              const label = `${place.place} : ${place.rows.length} tiers`;
              return (
                <Link
                  key={`${place.place}|${place.countryCode ?? ""}|${place.latitude}`}
                  href={`/tiers/${place.rows[0]!.id}`}
                  aria-label={label}
                  title={label}
                  style={{
                    left: `${5 + point.x * 0.9}%`,
                    top: `${5 + point.y * 0.9}%`,
                  }}
                  className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-brand/25 bg-brand text-white shadow-sm transition-transform hover:scale-110"
                >
                  <MapPin className="size-3.5" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </figure>

      {places.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <h2 className="border-b border-line px-4 py-2.5 text-[11px] font-medium">
            Répartition par lieu
          </h2>
          <ul className="divide-y divide-line">
            {places.map((place) => (
              <li
                key={`${place.place}|${place.countryCode ?? ""}|${place.latitude}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 py-3"
              >
                <p className="text-[11px] font-medium">{place.place}</p>
                <p className="font-mono text-[10px] text-muted">
                  {place.countryCode ?? "Non renseigné"} · {place.latitude.toFixed(3)} /{" "}
                  {place.longitude.toFixed(3)}
                </p>
                <span className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                  {place.rows.length}
                </span>
                <span className="grow" />
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {place.rows.map((row) => (
                    <Link
                      key={row.id}
                      href={`/tiers/${row.id}`}
                      className="text-[11px] transition-colors hover:text-brand"
                    >
                      {row.name}
                      <span className="ml-1 font-mono text-[10px] text-muted">{row.code}</span>
                    </Link>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stats.missing > 0 ? (
        <p className="text-[10px] leading-4 text-muted">
          {stats.missing} tiers du jeu filtré n&apos;ont pas de coordonnées : ils apparaissent dans
          la liste et le Kanban, jamais sur la carte.
        </p>
      ) : null}
    </div>
  );
}
