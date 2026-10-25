# Lean

ERP supply chain et douane, construit en lots validés. Interface française, devise XOF,
référentiel SYSCOHADA/OHADA, tarif extérieur UEMOA/TEDU et régimes ASYCUDA.

**Statut : Lot 3 livré — commandes fournisseur, réceptions, stock et import XLSX des lignes
de commande.** Le prochain lot couvre le cycle vente → livraison → facture.

Production : <https://lean-lilac.vercel.app> — projet Vercel `lean` lié au dépôt, base Neon
dédiée `lean`. Aucun autre service n'est nécessaire.

## Contraintes structurantes

- Aucun service ne tourne en permanence sur la machine du porteur. Le build est local,
  l'exécution est sur Vercel, la base sur Neon.
- Interface 100 % française, boutons icône uniquement, montants XOF entiers.
- Le dépôt local `Desktop\Axelor` est une référence en lecture seule. Les règles sont
  reformulées dans [`docs/business-rules.md`](docs/business-rules.md) avec un identifiant,
  puis implémentées. Aucun code n'est copié.
- Chaque import de données passe par le vrai XLSX, un template téléchargeable et un rapport
  de vérification par ligne avant toute écriture.

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
| XLSX        | ExcelJS côté serveur (lecture, template) |
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

## Tiers, articles et nomenclature

Les trois référentiels du Lot 2 sont consultables et créables depuis `/tiers`, `/articles` et
`/nomenclature`. Chaque enregistrement est unique par code dans l'espace de travail actif :

- **Tiers** — client et/ou fournisseur, entreprise ou particulier, pays ISO 3166-1, délai de
  paiement entier, indicateur actif.
- **Articles** — produit ou service, unité de la liste, prix XOF entiers, usages vente/achat.
  Un produit référence un code SH existant ; un service n'en porte pas.
- **Nomenclature douanière** — codes numériques de 6, 8 ou 10 chiffres, parent préfixe strict
  et déjà présent dans le référentiel ou dans le même fichier.

### Import XLSX

Le parcours suit deux temps, sans écriture métier à l'analyse :

1. Télécharger le modèle du domaine : `/api/modeles/tiers`, `/api/modeles/articles`,
   `/api/modeles/nomenclature` ou `/api/modeles/commandes`. Il contient la feuille `Données`,
   les en-têtes exacts, les listes déroulantes, un mode d'emploi et le référentiel pays.
2. Remplir le fichier puis l'envoyer depuis la page d'import. Lean l'analyse et affiche un
   rapport ligne à ligne : statut, code, erreurs bloquantes et avertissements.
3. Corriger les lignes en erreur et relancer l'analyse si nécessaire.
4. Confirmer l'import. Les lignes valides ou avec avertissement sont écrites par code
   (création ou mise à jour) dans une transaction ; les lignes en erreur sont ignorées.

Limites : `.xlsx` uniquement, 4 Mo maximum, 2 000 lignes de données, feuille `Données`. Les
en-têtes sont lus par position ; une casse ou un accent différent est normalisé avec une note,
une colonne manquante ou déplacée est refusée. Toute normalisation (majuscules, espaces,
e-mail) devient un avertissement visible, jamais une correction silencieuse.

Chaque lot conserve le fichier, son empreinte SHA-256, la feuille, les notes, l'acteur et les
lignes détaillées ; le rapport reste consultable sur `/imports/[batchId]`. Un lot ne s'applique
qu'une fois. Réanalyser un fichier déjà appliqué ajoute un avertissement, car confirmer
réécrirait les mêmes valeurs. L'import ne supprime jamais : il crée, met à jour ou désactive
via le champ `actif`.

## Achats, réceptions et stock

Le cycle achat s'appuie sur le référentiel livré au Lot 2. Il est accessible depuis `/achats`
et `/stock` :

- **Commandes fournisseur** — brouillon → demandée → confirmée → clôturée, annulable tant
  qu'aucune réception n'est validée. Le numéro `CMD-AAAA-NNNN` est attribué à la confirmation ;
  un brouillon s'affiche sans numéro définitif.
- **Réceptions** — sur commande confirmée uniquement, avec une date passée ou du jour et un
  emplacement interne actif. La réception partielle est permise ; la sur-réception est
  acceptée et signalée. Le bon `REC-AAAA-NNNN`, le mouvement d'entrée, la hausse du stock et
  les états sont écrits dans une seule transaction.
- **Stock** — niveaux disponibles par emplacement interne et journal immuable des mouvements
  `MVT-AAAA-NNNN`. Une annulation de réception écrit un mouvement inverse relié à l'original ;
  aucun mouvement ni niveau n'est modifié ou supprimé en place.
- **Import commandes** — modèle XLSX, analyse sans écriture et rapport par ligne. Les lignes
  sont groupées par fournisseur, date de réception prévue et référence externe ; chaque
  groupe crée une commande en brouillon, jamais une commande existante modifiée, et un même
  fichier ne s'applique qu'une fois.

Les quantités sont stockées en `numeric(18,6)`, les montants en XOF entiers et les totaux de
ligne arrondis HALF_UP. Les lignes de service ne génèrent jamais de mouvement de stock.

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
`memberships`, `sessions`, `audit_events`, `hs_codes`, `partners`, `articles`,
`import_batches`, `import_rows`, puis `purchase_orders`, `purchase_order_lines`,
`receptions`, `stock_locations`, `stock_moves`, `stock_move_lines`, `stock_levels` et
`document_sequences`. Les migrations générées sont commitées dans `drizzle/` : `0001` pour
l'identité, `0002` pour le catalogue et la traçabilité des imports, `0003` pour les notes de
lot, `0004` pour les achats et le stock. Les contraintes d'unicité, de rôle, de format SH, de
quantités et de cohérence article/nomenclature sont posées en base, en complément de la
validation applicative.

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
