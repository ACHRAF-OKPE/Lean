# Lean

ERP supply chain et douane, construit en lots validés. Interface française, devise XOF,
référentiel SYSCOHADA/OHADA, tarif extérieur UEMOA/TEDU et régimes ASYCUDA.

**Statut : Lot 1 livré — identité, multi-tenant, permissions, audit.** Le prochain lot couvre
les tiers et les articles : nomenclature HS, import XLSX et rapport de vérification.

## Contraintes structurantes

- Aucun service ne tourne en permanence sur la machine du porteur. Le build est local,
  l'exécution est sur Vercel, la base sur Neon.
- Interface 100 % française, boutons icône uniquement, montants XOF entiers.
- Le dépôt local `Desktop\Axelor` est une référence en lecture seule. Les règles sont
  reformulées dans [`docs/business-rules.md`](docs/business-rules.md) avec un identifiant,
  puis implémentées. Aucun code n'est copié.
- Chaque import de données passera par le vrai XLSX, un template téléchargeable et un rapport
  de vérification par ligne avant écriture.

## Fidélité à Axelor

Lean est une réécriture, pas un fork. La fidélité est **fonctionnelle** et se prouve règle
par règle : source citée, comportement décrit en français, cas de parité, test qui cite
l'identifiant, écarts connus. Le protocole et la matrice de couverture vivent dans
[`docs/business-rules.md`](docs/business-rules.md#preuve-de-fidélité). En cas d'ambiguïté, un
Axelor local est démarré à la demande comme oracle, puis arrêté.

- **Garanti** : chaque flux livré tourne avec de vraies données, les imports passent par le
  vrai XLSX avec template et rapport ligne à ligne, les montants XOF restent entiers,
  l'isolation tenant est testée et chaque écart est documenté.
- **Non garanti** : une couverture 100 % d'Axelor, une interface pixel-identique, la
  compatibilité avec les plugins ou le Studio Axelor, la reprise automatique de données
  existantes.

## Stack

| Couche      | Choix                                    |
| ----------- | ---------------------------------------- |
| Application | Next.js 16 (App Router, RSC), React 19   |
| Langage     | TypeScript strict                        |
| Style       | Tailwind CSS 4                           |
| Base        | Neon Postgres                            |
| ORM         | Drizzle ORM + migrations SQL versionnées |
| Tests       | Vitest + PGlite (Postgres en mémoire)    |
| Hébergement | Vercel, runtime Node                     |
| CI          | GitHub Actions                           |

## Démarrage local

Prérequis : Node.js ≥ 22.11 (`.nvmrc` pointe sur 24).

```bash
npm ci
cp .env.example .env.local   # DATABASE_URL, puis les BOOTSTRAP_* pour l'amorçage
npm run db:migrate
npm run db:seed              # crée le tenant et son propriétaire, une seule fois
npm run dev
```

Le serveur local ne sert qu'au développement et au build. La production s'exécute sur
Vercel avec la base Neon.

## Identité et accès

- **Aucune inscription publique.** Le premier propriétaire est créé par `npm run db:seed` à
  partir des variables `BOOTSTRAP_*`. Le script est idempotent : un second passage n'écrit
  rien. Ces variables restent locales et ne vont jamais dans Vercel.
- Connexion par email et mot de passe (scrypt salé). Session opaque de 7 jours, cookie
  `httpOnly`, `secure` en production, `SameSite=Lax`. L'appartenance au tenant est
  revérifiée à chaque requête serveur.
- Rôles : **propriétaire** (tout), **administrateur** (membres, audit, données), **membre**
  (données). Le refus est la valeur par défaut ; l'interface ne fait que masquer ce que le
  serveur interdit.
- Connexion, déconnexion, changement d'espace et amorçage alimentent le journal d'audit,
  filtré par tenant et réservé aux rôles autorisés.

## Scripts

| Commande              | Rôle                                          |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | Serveur de développement                      |
| `npm run lint`        | ESLint, zéro avertissement                    |
| `npm run format`      | Prettier                                      |
| `npm run typecheck`   | TypeScript strict, sans émission              |
| `npm run test`        | Tests Vitest                                  |
| `npm run gate`        | Lint + format + types + tests + build         |
| `npm run db:generate` | Génère une migration Drizzle                  |
| `npm run db:migrate`  | Applique les migrations sur `DATABASE_URL`    |
| `npm run db:seed`     | Crée le tenant et son propriétaire (une fois) |
| `npm run db:studio`   | Drizzle Studio                                |

La barrière du porteur est incluse dans `npm run gate` : lint, typecheck, test, build. Le
formatage s'y ajoute.

## Base de données

Le schéma Drizzle vit dans [`src/db/schema.ts`](src/db/schema.ts) : `tenants`, `users`,
`memberships`, `sessions`, `audit_events`. Les migrations générées sont commitées dans
`drizzle/` ; la migration `0001` crée le socle d'identité.

```bash
npm run db:generate
npm run db:migrate
```

`DATABASE_URL` est requis pour appliquer les migrations. Utiliser l'URL « pooler » de Neon :
le client `postgres-js` est configuré avec une connexion unique et sans prepared statements
pour rester compatible avec le pooler serverless. Ne jamais modifier une migration déjà
appliquée : générer une migration corrective.

Les tests d'intégration utilisent PGlite (Postgres en mémoire, WASM) et appliquent les
migrations réelles : aucun service de base ne tourne pour tester, et la production n'est
jamais touchée.

## Déploiement

1. Importer le dépôt dans Vercel.
2. Créer la base Neon et renseigner `DATABASE_URL` (URL pooler) dans les variables
   d'environnement Vercel.
3. Appliquer les migrations (`npm run db:migrate`) contre la base cible.
4. Créer le premier propriétaire une seule fois : renseigner les `BOOTSTRAP_*` dans un
   environnement local pointant sur Neon, lancer `npm run db:seed`, puis retirer ces
   variables. Aucune inscription publique n'existe dans l'application.
5. Chaque push sur `main` déclenche la CI, puis le déploiement Vercel.

Aucun secret n'est stocké dans le dépôt ; `.env.example` documente les clés attendues.

## Documentation

- [`docs/business-rules.md`](docs/business-rules.md) — registre des règles, sources, statuts.
- [`docs/conventions.md`](docs/conventions.md) — architecture, UI, données, tests, lots.
- [`AGENTS.md`](AGENTS.md) — consignes pour les agents qui interviennent sur le dépôt.
