# Lean

ERP supply chain et douane, construit en lots validés. Interface française, devise XOF,
référentiel SYSCOHADA/OHADA, tarif extérieur UEMOA/TEDU et régimes ASYCUDA.

**Statut : Lot 5 complet — tâches, assignation et suivi (5D) livrés.**
La douane arrive ensuite.

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
- Rôles : **propriétaire** (tout), **administrateur** (membres, audit, données, paramètres),
  **membre** (données). Le refus est la valeur par défaut ; l'interface ne fait que masquer ce
  que le serveur interdit.
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
   `/api/modeles/nomenclature`, `/api/modeles/commandes` ou `/api/modeles/ventes`. Il contient
   la feuille `Données`, les en-têtes exacts, les listes déroulantes, un mode d'emploi et le
   référentiel pays.
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

## Ventes, livraisons et encours

Le cycle vente prolonge le référentiel du Lot 2 et le stock du Lot 3. Il est accessible depuis
`/ventes` et `/factures` :

- **Commandes client** — brouillon → confirmée → clôturée, annulable tant qu'aucune livraison
  ni facture n'est validée. Le numéro `VTE-AAAA-NNNN` est attribué à la confirmation ; un
  brouillon s'affiche sans numéro définitif. Un incoterm 2020 facultatif, une date de
  livraison prévue et une référence externe sont conservés.
- **Livraisons** — sur commande confirmée uniquement, avec une date passée ou du jour et un
  emplacement interne actif. Les produits seulement : un service n'est jamais livré, le
  reliquat n'est jamais dépassé et le stock disponible est contrôlé. Le bon `BL-AAAA-NNNN`,
  le mouvement de sortie vers l'emplacement client virtuel, la baisse du stock, les états et
  l'audit sont écrits dans une seule transaction.
- **Factures** — depuis une commande confirmée. Un produit se facture à hauteur de la
  quantité livrée, un service à hauteur de la quantité commandée. La facture naît en brouillon
  sans numéro et se valide une seule fois ; la validation attribue `FAC-AAAA-NNNN` et fige les
  montants.
- **Règlements et encours** — règlements append-only sur facture validée, plafonnés au solde
  restant. L'encours additionne les soldes des factures validées ; les brouillons sont exclus
  et une échéance dépassée est signalée.
- **Import commandes client** — modèle XLSX, analyse sans écriture et rapport par ligne. Les
  lignes sont groupées par client, date de livraison prévue et référence externe ; chaque
  groupe crée une commande en brouillon, jamais une commande existante modifiée, et un même
  fichier ne s'applique qu'une fois.

Une livraison s'annule par un mouvement inverse : le journal reste immuable. L'annulation est
refusée si une quantité déjà facturée n'était plus couverte par une livraison.

## Entreprise, conditions et contacts

Le socle administratif du Lot 5 est accessible depuis `/parametres` et la fiche de chaque
tiers :

- **Fiche entreprise** — une seule fiche par espace : raison sociale, forme juridique, capital
  XOF, identifiants fiscaux, adresse, contacts, pied de facture, délai de règlement par défaut
  et incoterm par défaut. Les membres la lisent ; seuls le propriétaire et l'administrateur la
  modifient (`settings.manage`).
- **Logo** — PNG, JPEG ou WebP de 512 Kio maximum, vérifié par signature binaire et non par
  simple extension. Stocké en base et servi par une route authentifiée, jamais par un chemin
  public. Le retrait est une suppression explicite et auditée.
- **Conditions de règlement** — délai entier de 0 à 365 jours et incoterm 2020 facultatif. Un
  changement ne réécrit jamais les documents déjà émis.
- **Coordonnées bancaires** — bloc complet ou vide : banque, titulaire et compte vont ensemble ;
  le SWIFT facultatif suit le format ISO 9362. Les valeurs sont normalisées en majuscules.
- **Contacts tiers** — plusieurs contacts par tiers, un seul principal actif à la fois. Un
  contact se désactive, ne se supprime pas ; le passage au principal désigne automatiquement
  les autres comme secondaires.

Chaque mutation vérifie le tenant actif et écrit un évènement d'audit avec l'acteur, les
valeurs avant et après. Un logo sans fiche entreprise crée la fiche avec le nom légal fourni.

## Échanges fournisseurs

Le Lot 5B ajoute l'envoi des demandes de prix et des confirmations de commande :

- **Compte d'envoi** — un seul compte SMTP par espace, activable, avec TLS implicite,
  STARTTLS ou aucun. Le mot de passe n'est jamais relu par l'interface ; il est chiffré en
  AES-256-GCM avec `LEAN_SECRET_KEY` et n'apparaît ni dans l'audit ni dans les erreurs. Un
  encart d'aide rappelle les réglages Gmail (`smtp.gmail.com`, 465, TLS implicite) et Outlook,
  et pointe vers la création d'un **mot de passe d'application** : Google, Microsoft et Yahoo
  refusent le mot de passe habituel. Un refus `535` ajoute cette consigne au message d'erreur.
  Pour la production, il décrit aussi **Resend** (`smtp.resend.com`, 465, identifiant `resend`,
  clé API, expéditeur sur un domaine vérifié) : un domaine authentifié par SPF, DKIM et DMARC
  est le seul moyen durable d'éviter le classement en spam.
- **Test de connexion** — vérifie l'authentification SMTP sans envoyer de message.
- **Modèles** — un modèle par type (demande ou confirmation), nom unique, sujet et corps à
  variables fermées. Un seul défaut actif par type ; désactiver un modèle ne le supprime pas.
  Sans modèle actif, le modèle intégré sert de repli. L'aperçu HTML échappe le contenu saisi.
- **Envoi** — depuis une commande demandée (demande) ou confirmée/clôturée (confirmation),
  avec destinataire prérempli depuis les contacts du tiers et aperçu en direct. Le message
  est rendu en texte et en HTML, le bon de commande est joint en PDF A4 avec le logo s'il
  existe.
- **Journal** — chaque tentative est append-only : statut, erreur éventuelle, acteur,
  destinataire, sujet, corps rendu et pièce jointe. Un renvoi crée une nouvelle tentative
  reliée à l'originale. Le détail restitue le message tel qu'il a été remis.
- **Instantané** — modifier l'entreprise ou le tiers après l'envoi ne réécrit jamais un
  message ; seul un nouvel envoi reprend les valeurs courantes.

`LEAN_SECRET_KEY` est obligatoire pour enregistrer un mot de passe SMTP. Les échanges sont
accessibles depuis `/echanges`, `/parametres/echanges` et la fiche d'une commande.

## Réponses fournisseurs

Le Lot 5E ramène la réponse du fournisseur dans l'application, sans lui imposer de compte :

- **Lien par message** — chaque demande ou confirmation remise au serveur SMTP contient un
  lien `/repondre/<jeton>`. Le jeton fait 256 bits, n'est stocké qu'en empreinte SHA-256 et
  vaut 90 jours ; un renvoi crée un nouveau lien sans invalider l'ancien.
- **Page publique** — le fournisseur voit le numéro, les dates, la référence, les notes, les
  lignes et le total, puis indique sa disponibilité, un commentaire, un délai, un montant
  proposé et, s'il le souhaite, une pièce jointe PDF, PNG, JPEG ou XLSX de 5 Mio au plus. Un
  lien inconnu ou expiré affiche une réponse neutre.
- **Retour dans l'application** — chaque réponse apparaît sur la commande, s'inscrit dans le
  fil comme évènement et notifie tous les membres. L'audit conserve la disponibilité et la
  présence d'une pièce jointe, jamais le commentaire.
- **Pièce jointe** — téléchargeable uniquement par un membre authentifié de l'espace, via une
  route qui force le téléchargement.

## Collaboration interne

Le Lot 5C ajoute un fil de discussion interne et une boîte de notifications :

- **Fil par document** — tiers, commande fournisseur, commande client et facture portent un
  fil append-only. Un commentaire de 1 à 4 000 caractères est signé et horodaté ; il n'est
  jamais modifiable ni supprimé et n'est jamais envoyé au tiers.
- **Mentions** — un commentaire mentionne des membres de l'espace, dédupliqués et limités à 50. Une mention hors espace fait échouer le commentaire entier ; l'auto-mention ne notifie
  personne.
- **Évènements** — demande, confirmation, clôture, annulation, réception, livraison,
  validation de facture et paiement s'inscrivent automatiquement dans le fil avec leur numéro
  et leur montant. Une clé stable rend chaque évènement unique, même rejoué.
- **Notifications** — chaque évènement notifie tous les membres, auteur compris, une fois par
  membre ; chaque mention notifie la personne visée. Le texte est borné à 500 caractères.
- **Bandeau** — la cloche affiche le nombre de non-lues et ouvre `/notifications`, limitée aux
  100 dernières. Chaque utilisateur ne lit et ne marque que ses propres notifications, de
  façon idempotente.

Aucune notification n'est envoyée par e-mail dans ce lot : la boîte reste interne à
l'application.

## Tâches et suivi

Le Lot 5D ajoute les tâches internes, rattachées ou non à un document :

- **Fiche** — titre obligatoire, description en texte brut, priorité Basse/Normale/Haute/
  Urgente, échéance facultative, assigné membre de l'espace et document facultatif (tiers,
  commande fournisseur, commande client ou facture).
- **Cycle de vie** — ouverte, en cours, terminée, annulée, avec des transitions limitées.
  Terminer conserve l'acteur et la date ; une tâche terminée ou annulée est figée jusqu'à sa
  réouverture. Une tâche non assignée ne peut pas être démarrée.
- **Chronomètre** — le démarrage arme un compteur propre à la tâche ; terminer, annuler ou
  rouvrir conserve le temps cumulé des passages. La fiche affiche le temps en cours et le
  reste avant l'échéance, la liste affiche le chrono de chaque tâche. Désassigner une tâche
  en cours est refusé ; une réassignation ne l'interrompt pas.
- **Suivi** — `/taches` filtre par statut, priorité, assigné et retard ; les compteurs
  ouverts, en retard et « mes tâches » sont calculés à l'affichage. Les fiches documentaires
  listent leurs tâches ouvertes et chaque tâche renvoie à son document.
- **Collaboration** — création, changement de statut et assignation s'inscrivent dans le fil
  du document et notifient les membres ; le texte généré ne contient jamais la description.
- **Import** — modèle XLSX à sept colonnes (titre, description, priorité, échéance, assigné
  par e-mail, type et référence du document), analyse en deux temps et rapport par ligne.
  Les tâches importées naissent ouvertes avec l'acteur comme créateur ; un même fichier ne
  s'applique qu'une fois et l'import n'ouvre ni fil ni notification par tâche.

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
`import_batches`, `import_rows`, `purchase_orders`, `purchase_order_lines`, `receptions`,
`stock_locations`, `stock_moves`, `stock_move_lines`, `stock_levels`, puis `sales_orders`,
`sales_order_lines`, `deliveries`, `delivery_lines`, `invoices`, `invoice_lines`,
`invoice_payments`, `document_sequences`, `company_settings`, `partner_contacts`,
`exchange_templates`, `exchange_messages`, `supplier_replies`, `discussion_messages`,
`discussion_mentions`, `notifications` et `tasks`. Les migrations générées sont commitées dans
`drizzle/` : `0001` pour l'identité, `0002` pour le catalogue et la traçabilité des imports,
`0003` pour les notes de lot, `0004` pour les achats et le stock, `0005` pour les ventes et la
facturation, `0006` pour la fiche entreprise et les contacts tiers, `0007` pour les échanges
fournisseurs, `0008` pour la collaboration, `0009` pour les réponses fournisseurs, `0010`
pour les tâches et `0011` pour leur chronomètre. Les
contraintes d'unicité, de rôle, de format SH, de quantités, de
cohérence article/nomenclature, de bloc bancaire et d'idempotence des évènements sont posées
en base, en complément de la validation applicative.

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
   d'environnement Vercel. Ajouter `LEAN_SECRET_KEY` (32 octets base64) pour chiffrer les
   mots de passe SMTP, et éventuellement `LEAN_APP_URL` pour les liens des e-mails.
3. Les migrations sont appliquées automatiquement au début de chaque build Vercel, avant le
   build applicatif (`vercel.json`). Un build qui ne peut pas migrer échoue et laisse la
   production précédente en place. En local, `npm run db:migrate` reste la commande explicite.
4. Créer le premier propriétaire une seule fois : renseigner les `BOOTSTRAP_*` dans un
   environnement local pointant sur Neon, lancer `npm run db:seed`, puis retirer ces
   variables. Aucune inscription publique n'existe dans l'application.
5. Chaque push sur `main` déclenche la CI, puis le déploiement Vercel.

Aucun secret n'est stocké dans le dépôt ; `.env.example` documente les clés attendues.

## Documentation

- [`docs/business-rules.md`](docs/business-rules.md) — registre des règles, sources, statuts.
- [`docs/conventions.md`](docs/conventions.md) — architecture, UI, données, tests, lots.
- [`AGENTS.md`](AGENTS.md) — consignes pour les agents qui interviennent sur le dépôt.
