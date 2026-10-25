# Lean

ERP supply chain et douane, construit en lots validés. Interface française, devise XOF,
référentiel SYSCOHADA/OHADA, tarif extérieur UEMOA/TEDU et régimes ASYCUDA.

**Statut : Lot 0 livré — socle technique.** Le prochain lot couvre l'authentification, le
multi-tenant, les permissions et l'audit.

## Contraintes structurantes

- Aucun service ne tourne en permanence sur la machine du porteur. Le build est local,
  l'exécution est sur Vercel, la base sur Neon.
- Interface 100 % française, boutons icône uniquement, montants XOF entiers.
- Le dépôt [`Desktop\Axelor`](../Axelor) est une référence en lecture seule. Les règles sont
  reformulées dans [`docs/business-rules.md`](docs/business-rules.md) avec un identifiant,
  puis implémentées. Aucun code n'est copié.
- Chaque import de données passera par le vrai XLSX, un template téléchargeable et un rapport
  de vérification par ligne avant écriture.

## Stack

| Couche      | Choix                                    |
| ----------- | ---------------------------------------- |
| Application | Next.js 16 (App Router, RSC), React 19   |
| Langage     | TypeScript strict                        |
| Style       | Tailwind CSS 4                           |
| Base        | Neon Postgres                            |
| ORM         | Drizzle ORM + migrations SQL versionnées |
| Tests       | Vitest                                   |
| Hébergement | Vercel, runtime Node                     |
| CI          | GitHub Actions                           |

## Démarrage local

Prérequis : Node.js ≥ 22.11 (`.nvmrc` pointe sur 24).

```bash
npm ci
cp .env.example .env.local   # renseigner DATABASE_URL pour la base
npm run dev
```

Le serveur local ne sert qu'au développement et au build. La production s'exécute sur
Vercel avec la base Neon.

## Scripts

| Commande              | Rôle                                       |
| --------------------- | ------------------------------------------ |
| `npm run dev`         | Serveur de développement                   |
| `npm run lint`        | ESLint, zéro avertissement                 |
| `npm run format`      | Prettier                                   |
| `npm run typecheck`   | TypeScript strict, sans émission           |
| `npm run test`        | Tests Vitest                               |
| `npm run gate`        | Lint + format + types + tests + build      |
| `npm run db:generate` | Génère une migration Drizzle               |
| `npm run db:migrate`  | Applique les migrations sur `DATABASE_URL` |
| `npm run db:studio`   | Drizzle Studio                             |

La barrière du porteur est incluse dans `npm run gate` : lint, typecheck, test, build. Le
formatage s'y ajoute.

## Base de données

Le schéma Drizzle vit dans [`src/db/schema.ts`](src/db/schema.ts). La racine `tenants` est
posée pour le Lot 1. Les migrations générées sont commitées dans `drizzle/`.

```bash
npm run db:generate
npm run db:migrate
```

`DATABASE_URL` est requis pour appliquer les migrations. Ne jamais modifier une migration
déjà appliquée : générer une migration corrective.

## Déploiement

1. Importer le dépôt dans Vercel.
2. Créer la base Neon et renseigner `DATABASE_URL` dans les variables d'environnement Vercel.
3. Appliquer les migrations (`npm run db:migrate`) contre la base cible.
4. Chaque push sur `main` déclenche la CI, puis le déploiement Vercel.

Aucun secret n'est stocké dans le dépôt ; `.env.example` documente les clés attendues.

## Documentation

- [`docs/business-rules.md`](docs/business-rules.md) — registre des règles, sources, statuts.
- [`docs/conventions.md`](docs/conventions.md) — architecture, UI, données, tests, lots.
- [`AGENTS.md`](AGENTS.md) — consignes pour les agents qui interviennent sur le dépôt.
