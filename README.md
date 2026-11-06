# Lean

ERP supply chain et douane, construit en lots validés. Interface française, devise XOF,
référentiel SYSCOHADA/OHADA, tarif extérieur UEMOA/TEDU et régimes ASYCUDA.

**Statut : Lot 11 livré — RH socle, avec les congés.**
Le Lot 11A pose l'organisation, le personnel et les contrats, le Lot 11B le temps de travail et
le Lot 11C les congés (types paramétrables, demande en demi-journées, solde et workflow). Le
Lot 12 est livré : ergonomie et vues du registre des tiers. Les droits par module, l'équipe et
les responsables sont en production depuis le Lot 10. La paie (Lot 13) et son export sont livrés.
Le Lot 14 est en cours : 14A masque les actions hors niveau de droit, 14B ouvre l'annuaire du
paramétrage des modules à la manière d'Odoo, 14C puis 14D livrent les deux premiers écrans de
module — achats (délai de réception par défaut) et ventes (délai de livraison par défaut) —,
chaque module gagnant ensuite son propre écran.

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
- Depuis le Lot 10, chaque rôle porte aussi un **niveau par module** (aucun accès, lecture,
  écriture, gestion) détaillé plus bas : la permission globale reste exigée en dessous.
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

### Registre des tiers

`/tiers` se filtre — recherche sur la référence et le nom, rôle client ou fournisseur, état actif
ou inactif, catégorie et pays — et se lit en trois vues partageables par l'adresse : liste dense
avec sélection multiple, Kanban groupé par catégorie (les tiers sans catégorie forment le groupe
« Sans catégorie ») et carte, qui place un point par tiers muni de ses coordonnées et rappelle le
nombre de tiers géolocalisés et de lieux distincts. Dans le Kanban, une carte se glisse d'une
colonne à l'autre pour rattacher le tiers à la catégorie d'accueil, ou sur « Sans catégorie » pour
l'en détacher ; le geste est réservé au niveau écriture et tracé. Selon le niveau de droit, la sélection permet
de changer le rôle, l'état ou les catégories, d'exporter, de modifier ou de supprimer : une action
en lot s'applique en une seule transaction et refuse toute la sélection dès qu'une ligne est citée
par un document.

Chaque espace définit ses **catégories de tiers** depuis `/tiers/categories` — création,
renommage, désactivation et suppression, interdite tant que la catégorie porte des tiers — et peut
en créer une à la volée depuis le formulaire d'un tiers. La fiche d'un tiers s'ouvre sur
`/tiers/[id]`, se modifie sur `/tiers/[id]/modifier` (coordonnées saisies à la main, sans
géocodeur) et se supprime depuis la fiche.

### Registre des articles

`/articles` se filtre — recherche sur le code et la désignation, type produit ou service, état
actif ou inactif, catégorie — et se lit en trois vues partageables par l'adresse : liste dense
avec sélection multiple, Kanban groupé par catégorie d'articles (les articles sans catégorie
forment la colonne « Sans catégorie ») et grille, une carte par article. Dans le Kanban, une
carte se glisse d'une colonne à l'autre pour rattacher l'article à la catégorie d'accueil, ou
sur « Sans catégorie » pour l'en détacher ; le geste est réservé au niveau écriture et tracé.

Chaque espace définit ses **catégories d'articles** depuis `/articles/categories` — création,
renommage, désactivation et suppression, interdite tant que la catégorie porte des articles — et
peut en créer une à la volée depuis le formulaire d'un article. La fiche d'un article s'ouvre sur
`/articles/[id]`, se modifie sur `/articles/[id]/modifier` et se supprime depuis la fiche.

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

## Douane

Le Lot 6 ajoute le passage en douane, du référentiel à la mainlevée :

- **Référentiels** — `/douane/referentiels` gère les bureaux (code UN/LOCODE), les régimes
  ASYCUDA (nature, acquit obligatoire, apurement progressif) et les taxes paramétrables
  (assiette CIF ou CIF + droits, taux à deux décimales). Le taux TEC d'un code SH reste
  limité aux bandes UEMOA 0, 5, 10, 20 et 35 ; il s'importe avec la nomenclature et se
  conserve si la colonne est vide.
- **Déclaration** — `/douane` liste les déclarations brouillon, déposées, liquidées,
  réglées et annulées. Une déclaration porte un numéro DEC-AAAA-NNNN, un régime, un bureau,
  le tiers déclaré, une date et les frais de transport et d'assurance ; elle s'enrichit de
  lignes jusqu'au dépôt, qui fige l'en-tête et les lignes. Le régime se choisit parmi les
  régimes actifs de l'espace ; un régime absent (IM9 par exemple) se saisit directement dans
  le formulaire : il est créé, ajouté à la liste et appliqué à la déclaration.
- **Liquidation** — le fret et l'assurance sont répartis au prorata des valeurs de ligne au
  franc près (plus fort reste) ; le droit de douane applique le TEC de chaque code SH, puis
  les taxes actives sont calculées sur leur assiette. L'instantané fige lignes, taxes et
  totaux ; une modification ultérieure du référentiel ne le change pas.
- **Acquit-à-caution** — un régime suspensif exige un acquit AAC-AAAA-NNNN, unique, dont la
  garantie couvre au moins le montant à payer ; l'apurement est unique et lève le blocage de
  la mainlevée.
- **Apurement progressif (IM9)** — un régime peut aussi exiger l'apurement progressif de ses
  articles, pour une entreprise en zone franche. Les lignes d'une déclaration liquidée
  deviennent les articles du sommier ; chaque écriture apure une quantité d'une ligne (mode
  production, exportation, destruction ou transfert, référence de pièce) et le cumul ne
  dépasse jamais la quantité déclarée. Les écritures sont append-only, l'état (ouvert,
  partiel, apuré) se déduit du journal et les totaux ne s'additionnent jamais entre unités
  différentes. `/douane/apurement` suit tous les sommiers ; la fiche de la déclaration porte
  le détail par ligne et le journal.
- **Paiements** — append-only, au plus égaux au montant à payer, datés d'aujourd'hui ou
  avant ; la mainlevée exige le paiement intégral et, si le régime l'exige, l'acquit apuré.
- **Import** — modèle XLSX à huit colonnes (numéro de déclaration, code SH, désignation,
  quantité, unité, valeur, poids, pays d'origine), regroupé par déclaration brouillon. Un
  code SH ou une désignation déjà présent sur la déclaration est signalé ; un fichier ne
  s'applique qu'une fois. Le journal d'apurement s'importe aussi par XLSX (six colonnes :
  numéro de déclaration, ligne, quantité, date, mode, référence), avec le même rapport par
  ligne et le même contrôle du restant, écritures existantes et fichier compris.

## Comptabilité

Le Lot 7A pose le socle SYSCOHADA, accessible depuis `/comptabilite` :

- **Exercice** — libellé, dates de début et de fin, 366 jours maximum, sans chevauchement
  dans l'espace. Un exercice s'ouvre puis se clôture une seule fois ; la clôture est refusée
  tant qu'une écriture de la période reste en brouillon.
- **Plan comptable** — codes de 2 à 10 chiffres commençant par une classe de 1 à 8 ; la
  classe se déduit du premier chiffre. Un compte se désactive sans effacer son historique et
  ne reçoit plus d'écriture.
- **Journaux** — code de 2 à 6 caractères normalisé en majuscules, type vente, achat, banque,
  caisse ou opérations diverses. Un journal inactif n'accueille aucune écriture nouvelle.
- **Écritures** — saisie manuelle ou import, au moins deux lignes, un seul montant par ligne,
  débit égal au crédit en XOF entiers, date couverte par un exercice ouvert, compte actif.
  Le brouillon se supprime ; la validation l'immuabilise et attribue le numéro
  `JOURNAL-AAAA-NNNN`, séquentiel par journal et par année, jamais réutilisé.
- **Balance et grand livre** — la balance agrège les seules écritures validées de l'exercice
  demandé (débit, crédit, solde) et le grand livre suit le solde progressif d'un compte avec
  les écritures en date d'écriture puis numéro. Les brouillons n'y apparaissent jamais.
- **Import** — deux modèles XLSX : plan comptable (code, libellé, actif) et journal
  d'écritures (journal, date, pièce, libellé, libellé de ligne, compte, tiers, débit, crédit).
  L'analyse vérifie chaque ligne, y compris l'équilibre de chaque écriture groupée ; l'import
  crée ou met à jour les comptes et crée les écritures en brouillon, sans jamais les valider.
  Un fichier ne s'applique qu'une fois.

Le Lot 7B branche la comptabilité sur les opérations et ajoute le suivi des comptes de tiers :

- **Comptabilisation automatique** — opt-in via `/comptabilite/parametres` : un journal de
  vente, un journal d'achat, un journal de banque et cinq comptes (client, fournisseur,
  vente, achat, banque). La validation d'une facture débite le client et crédite les ventes ;
  chaque règlement débite la banque et crédite le client ; chaque réception débite les achats
  et crédite le fournisseur, et son annulation produit l'écriture inverse. Les écritures sont
  validées à la source, datées du document et référencées par son numéro ; un document ne
  produit jamais deux écritures. Paramétrage présent mais journal ou compte inactif, ou date
  hors exercice ouvert : l'opération métier est refusée, sans écriture partielle.
- **Lettrage** — `/comptabilite/lettrage` rapproche au moins deux lignes non lettrées d'un
  même compte de tiers, du même tiers, de débits et crédits égaux. Le groupe reçoit un code
  `L0001` séquentiel par espace, jamais réutilisé ; le délettrage libère le groupe entier.
  Lettrage et délettrage ne touchent ni aux montants ni au statut des écritures.
- **Cut-off et clôture** — `/comptabilite/rapprochement` confronte les factures, règlements et
  réceptions de l'exercice à leurs écritures automatiques, et permet de comptabiliser à la
  demande les documents antérieurs au paramétrage. L'opération est idempotente, refuse un
  exercice clôturé et reste disponible sans paramétrage (en lecture). Quand la comptabilité
  automatique est paramétrée, la clôture d'un exercice est refusée tant qu'un document validé
  de la période reste non comptabilisé.

Les montants sont des entiers XOF et chaque mutation écrit un évènement d'audit.

## Approvisionnement — appels d'offres

Le Lot 8A ouvre `/achats/appels-offres` et remplace l'import en tête de gondole par un flux
in-app complet :

- **Demande de cotation** — un intitulé, une échéance, des lignes de besoin (article actif et
  achetable, quantité, date souhaitée) et des fournisseurs actifs avec une adresse e-mail. La
  demande naît en brouillon, modifiable et supprimable, puis reçoit son numéro
  `DAO-AAAA-NNNN` à l'envoi, qui fige lignes et fournisseurs.
- **Lien public de cotation** — l'envoi adresse à chaque fournisseur un e-mail personnalisé
  vers `/cotations/<jeton>`. Le jeton de 256 bits n'est conservé qu'en empreinte SHA-256 et
  expire à la fin du jour d'échéance. La page ne demande aucune session, n'expose que la
  raison sociale, le numéro, l'échéance, les lignes et le nom du fournisseur, et rappelle que
  le lien est personnel. Un lien inconnu, expiré, remplacé ou annulé affiche une réponse
  neutre. Un renvoi émet un nouveau jeton et invalide l'ancien ; un échec d'envoi ne laisse
  aucun lien actif.
- **Cotation** — le fournisseur saisit un nom, un e-mail et un délai facultatifs, puis
  quantité et prix unitaire par ligne. Une ligne à zéro est non proposée ; toute autre exige
  un prix strictement positif. Un refus global doit être motivé. Chaque dépôt crée une
  révision append-only (dix au plus), seule la dernière faisant foi. Un champ piège bloque
  les robots.
- **Comparaison et attribution** — chaque ligne confronte les offres triées par prix, délai
  puis date de dépôt. L'acheteur attribue une offre ou écarte la ligne ; retenir un prix
  supérieur au meilleur exige un motif. Une attribution est figée et la demande devient
  terminale quand toutes ses lignes sont attribuées ou écartées.
- **Commandes fournisseur** — sur action explicite, une commande brouillon par fournisseur
  retenu reprend l'article, la quantité et le prix proposés, avec la référence `DAO` et une
  date de réception calculée sur le délai de l'offre. Les commandes suivent ensuite PUR-001 à
  PUR-005, y compris la numérotation `CMD` à la confirmation.

Toutes les mutations sont auditées ; la cotation publique est enregistrée sans acteur.

## Approvisionnement — besoins et propositions d'achat

Le Lot 8B complète la supply chain avec `/achats/approvisionnement` (politiques) et
`/achats/besoins` (calculs) :

- **Politique d'approvisionnement** — par article produit actif et achetable : fournisseur par
  défaut actif, délai d'approvisionnement (0 à 365 jours), délai de sécurité (0 à 60 jours),
  stock minimum, quantité de réapprovisionnement et multiple de commande facultatif. Une
  politique inactive est ignorée. Chaque enregistrement est audité.
- **Calcul des besoins** — sur un horizon de 1 à 365 jours, le stock interne est confronté aux
  commandes fournisseurs confirmées non reçues et aux commandes clients confirmées non livrées.
  Le premier jour où le stock projeté perce le seuil produit une proposition : quantité = plus
  grand du manque au seuil et de la quantité de réapprovisionnement, arrondie au multiple. La
  date de commande recule des deux délais, ramenée au jour avec un signalement de retard. Le
  calcul est numéroté `BES-AAAA-NNNN`, figé et conservé.
- **Conversion** — les propositions sélectionnées deviennent des commandes fournisseur en
  brouillon, une par fournisseur ou une par fournisseur et date de besoin, avec la référence
  `BES` et la date de réception la plus proche du groupe. Elles peuvent aussi produire une
  demande de cotation brouillon, envoyée ensuite comme en 8A. Une ligne traitée ne se convertit
  plus ; l'écart exige un motif et reste audité.

Toutes les mutations sont auditées et cloisonnées par espace ; les tests `supply.test.ts`
couvrent SCM-007 à SCM-012.

## Rapports et clôture

Le Lot 9 ferme la feuille de route initiale avec trois états de gestion, leur export et la
clôture annuelle :

- **Compte de résultat** — `/comptabilite/resultat` calcule à la lecture, pour l'exercice
  choisi, les soldes nets des comptes de classe 6 (charges), 7 (produits) et 8 (hors activité
  ordinaire, selon le sens du solde). Totaux et résultat net sont affichés avec le contrôle
  « la somme des classes 1 à 5 égale l'opposé du résultat ». Les brouillons sont exclus.
- **Balance âgée des créances** — `/comptabilite/creances` liste les factures de vente validées
  dont le solde (total hors taxe − règlements) reste positif à la date choisie, par tranche
  d'ancienneté d'échéance (non échu, 1 à 30, 31 à 60, 61 à 90, plus de 90 jours), avec la
  synthèse par ancienneté et la synthèse par client. L'état se calcule depuis les factures et
  les règlements, donc il fonctionne sans paramétrage comptable.
- **Engagements fournisseurs** — `/comptabilite/engagements` valeur les reliquats des commandes
  confirmées non entièrement reçues (reliquat × prix unitaire, arrondi HALF_UP), avec la date de
  réception prévue et l'indicateur de retard.
- **Export XLSX** — chaque état se télécharge en XLSX depuis une route authentifiée
  (`/api/rapports/<état>`), avec les mêmes lignes et totaux que l'écran, des en-têtes français,
  des montants XOF entiers et un nom de fichier `<état>-<période>.xlsx`. L'export n'écrit
  aucune donnée et n'est pas mis en cache.
- **Clôture annuelle** — le bouton de clôture d'un exercice produit, dans une seule
  transaction, une écriture de clôture validée datée du dernier jour (solde des classes 6, 7
  et 8, résultat porté au crédit du 131 en bénéfice ou au débit du 139 en perte) puis une
  écriture d'à-nouveaux validée datée du premier jour de l'exercice suivant (reprise des
  classes 1 à 5, 131/139 compris). Les deux vont dans le journal de type divers actif au code
  le plus petit. Sans journal divers actif, sans compte 131/139 quand le résultat est non nul,
  ou sans exercice ouvert commençant le lendemain, la clôture est refusée et aucune écriture
  n'est produite. Chaque écriture porte sa source (`fiscal_year_close`, `fiscal_year_open`),
  n'est produite qu'une fois, et les deux sont auditées.

## Paramétrage des modules

Le Lot 14 ouvre un écran de paramétrage par module, à la manière d'Odoo. Le poste de pilotage
`/parametres` en tient l'annuaire : chaque module lisible au niveau effectif y figure avec son
bouton, et un module dont l'écran reste à livrer est annoncé comme à venir, jamais lié à une page
absente. La consultation exige la lecture du module, l'enregistrement sa gestion (`GEN-012`,
`GEN-018`), et l'écran lui-même propose son bouton depuis sa page de liste.

- **Achats** — `/achats/parametres` porte un délai de réception par défaut, entier de 0 à 365
  jours (`PUR-007`). Il est proposé comme date de réception prévue à la saisie d'une commande ;
  zéro ne propose aucune date.
- **Ventes** — `/ventes/parametres` porte un délai de livraison par défaut, entier de 0 à 365
  jours (`SAL-009`). Il est proposé comme date de livraison prévue à la saisie d'une commande
  client ; zéro ne propose aucune date.

Chaque enregistrement est unique par espace, tracé dans l'audit avec l'indication de création, et
ne réécrit jamais un document déjà émis.

## Équipe et droits par module

Le Lot 10 répond à la demande du porteur : savoir qui est responsable de quel module, qui peut
voir quoi, qui peut lire, écrire ou gérer.

- **Quatorze modules, quatre niveaux.** Tiers, Articles, Nomenclature douanière, Douane, Achats,
  Appels d'offres, Besoins d'achat, Échanges, Ventes, Factures, Stock, Tâches, Comptabilité,
  Ressources humaines ; aucun accès < lecture < écriture < gestion. Le catalogue est unique
  (`TEN-008`) : un module hors liste (la paie) ne peut être ni concédé ni gardé tant qu'il
  n'existe pas.
- **Le défaut dépend du rôle.** Propriétaire et administrateur gèrent tout. Un membre lit les
  onze modules courants et ne voit ni la douane, ni la comptabilité, ni les ressources humaines
  — les trois modules sensibles sont scellés par défaut.
- **La concession écrase le défaut, y compris vers le bas.** Une concession est une ligne
  `(tenant, membre, module)` : `none` est un sceau conservé, pas une suppression. Retirer la
  concession fait retomber sur le défaut du rôle. Le propriétaire gère de droit : toute
  concession sur lui est refusée (`TEN-009`).
- **`write` ou `manage` (`GEN-012`).** Écrire = créer et modifier un brouillon ou une donnée de
  base. Gérer = faire sortir un document du brouillon (demande, confirmation, validation,
  clôture, annulation, réouverture, suppression) et enregistrer le paramétrage du module.
- **Chaque écran est gardé par son module (`TEN-013`).** Les pages de liste exigent la lecture,
  la saisie l'écriture, les transitions et le paramétrage la gestion — en plus de la permission
  globale. Les imports sont gardés sur la cible du lot, du modèle XLSX jusqu'à l'application :
  `/tiers/import` n'ouvre pas l'écriture d'un module non concédé. `src/modules/identity/routes.test.ts`
  échoue si une route n'est ni cartographiée ni explicitement plateforme.
- **`/equipe`** (réservé à `members.read`) : ajouter un membre ou rattacher un compte existant,
  changer un rôle, ouvrir la matrice des droits des quatorze modules pour chaque membre, désigner
  le responsable de chaque module, retirer un membre. L'enregistrement groupé n'écrit et
  n'audite que les concessions réellement changées.
- **Gardes d'intégrité de l'équipe (`TEN-010`).** Pas de doublon dans l'espace, un compte déjà
  connu est rattaché sans être recréé, seul le propriétaire nomme un propriétaire, l'espace garde
  toujours au moins un propriétaire, et personne ne modifie son propre rôle, ses propres droits
  ni ne se retire lui-même. Un changement de rôle efface les concessions.
- **Le responsable est une addressabilité, pas une permission (`TEN-011`).** Un seul responsable
  par module et par espace ; le désigner ne change aucun droit.
- **Toute mutation est auditée (`TEN-012`).** Membre, rôle, concession, responsabilité :
  acteur, entité, module, valeurs avant/après, en français. Un retrait de membre supprime en
  cascade ses concessions et ses responsabilités.
- **Le cockpit** n'affiche que les modules lisibles et présente la section « Mes droits par
  module » ; `/acces-refuse` reste l'autorité, l'interface ne faisant que masquer.

## Ressources humaines

Le Lot 11A ouvre `/rh` pour l'organisation, le personnel et les contrats de travail (HR-001 à
HR-008). RH est le quatorzième module du catalogue des droits : un membre n'y a aucun accès par
défaut et chaque écran est gardé par son niveau (`TEN-013`).

- **Organisation** — `/rh/organisation` rend l'arbre des services avec l'effectif de chaque nœud,
  cumulé avec ses descendants. Un service porte un code (2 à 10 caractères, normalisé en
  majuscules) et un nom, uniques dans l'espace, un parent facultatif — jamais lui-même ni l'un de
  ses descendants — et un responsable choisi parmi les salariés de l'espace. Un service qui a des
  enfants ou des salariés rattachés ne se supprime pas : il se désactive, disparaît des
  formulaires, et ses fiches conservent la référence (`HR-002`).
- **Personnel** — `/rh/personnel` filtre par service, statut et recherche sur le matricule, le nom
  ou le prénom, et affiche des compteurs recalculés à la lecture : effectif actif, suspendus,
  sortis, contrats en cours, périodes d'essai, arrivées et sorties du mois civil d'Abidjan. Une
  fiche porte un matricule unique, un nom et un prénom, un poste facultatif, une date d'embauche,
  un statut, un service et un manager — un salarié de l'espace, jamais lui-même, jamais un salarié
  sorti. « Sorti » exige une date de sortie postérieure à l'embauche ; une fiche qui a des
  contrats ne se supprime pas, elle passe par « sorti » (`HR-003`).
- **Compte de connexion** — une fiche se rattache en un-à-un à un compte membre de l'espace, depuis
  la fiche. Le rattachement ne change aucun droit : les niveaux de `hr` se posent dans `/equipe`,
  et deux fiches ne partagent pas le même compte. Supprimer le membre laisse la fiche intacte et
  son lien à null (`HR-003`, `HR-008`).
- **Contrats** — `/rh/contrats` liste les contrats filtrés par statut affiché et par salarié. Un
  contrat rattache une fiche à un type (CDI, CDD, intérim, stage, mission), avec une date de début,
  une fin obligatoire pour CDD, intérim et stage, une période d'essai en jours (0 à 365, jamais
  supérieure à la durée du contrat), une durée hebdomadaire en heures (0 à 80) et un salaire brut
  entier en XOF. Un seul contrat en cours par salarié et par espace, tenu par un index unique.
  Brouillon → en cours → éché ou résilié : « éché » se dérive de la date de fin à la lecture,
  jamais il ne se stocke. Sortir du brouillon, résilier et supprimer relèvent de la gestion ; les
  caractéristiques d'un contrat qui a quitté le brouillon sont figées, une correction passe par un
  nouveau contrat, et seul un brouillon se supprime (`HR-004`).
- **Le salaire est une donnée sociale sensible (`HR-005`).** Il ne s'affiche qu'à partir du niveau
  écriture, sur le contrat et la fiche de son salarié — jamais dans la liste du personnel, les
  compteurs d'effectif, le hub, les exports XLSX ni le détail des évènements d'audit. La requête de
  liste ne le renvoie pas non plus.
- **Import XLSX du personnel** — `/rh/personnel/import` avec un modèle à neuf colonnes (matricule,
  nom, prénom, poste, date d'embauche, code service, matricule du manager, e-mail du compte,
  statut), analyse sans écriture puis rapport ligne à ligne. Un matricule déjà présent est un
  avertissement et met à jour la fiche au lieu de la dupliquer ; un service ou un manager inconnu,
  un auto-rattachement, un e-mail hors espace ou un statut inconnu bloquent la ligne. Un fichier ne
  s'applique qu'une fois, l'application est gardée en écriture sur `hr` et n'écrit aucun montant
  (`HR-006`).
- **Les écrans masquent ce que le serveur refuse.** Sur `/rh`, un membre en lecture ne voit ni
  formulaires, ni bouton de création, ni transitions, ni salaire ; en écriture il saisit services,
  fiches, rattachements et brouillons de contrat, mais la mise en cours, la résiliation et la
  suppression restent invisibles. Cette règle, constatée comme écart au Lot 10, est appliquée ici ;
  son extension aux autres modules est attendue au Lot 13.

Le Lot 11B ajoute le temps de travail au même module `hr` : `/rh/temps` pour le paramétrage —
calendriers hebdomadaires, jours fériés et chômés — et `/rh/pointages` pour la feuille de temps
(HR-009 à HR-012). Le paramétrage et la validation relèvent de la gestion, la saisie d'un pointage
relève de l'écriture.

- **Calendrier hebdomadaire (`HR-009`)** — `/rh/temps/calendriers` liste les calendriers de
  l'espace avec leur valeur hebdomadaire en demi-journées et en heures et le nombre de fiches
  rattachées. Un calendrier décrit les sept jours, un seul par jour, chacun avec un matin et une
  après-midi en deux bornes horaires : une demi-journée ne compte comme travaillée que si ses deux
  bornes sont posées. La saisie refuse une fin antérieure à son début, une après-midi qui commence
  avant la fin du matin et une demi-journée à une seule borne. Un seul calendrier est celui de
  l'espace, tenu par un index unique partiel, et une fiche peut en pointer un autre qui prime pour
  elle seule ; le premier jour de la semaine est le jour de plus faible rang. Le calendrier de
  l'espace, comme un calendrier encore rattaché, ne se supprime pas.
- **Jours fériés et chômés (`HR-010`)** — `/rh/temps/feries` pose une ligne par date et par période
  — journée, matin ou après-midi — avec un libellé. La fraction couverte ne doit rien au décompte :
  la valeur travaillée du jour en est minorée, et une fraction posée sur une demi-journée déjà non
  travaillée ne change rien — un férié tombant un dimanche reste à 0. La nature, férié ou chômé,
  sert au libellé et aux états, pas au calcul. Un calendrier modifié rétroagit sur les décomptes
  déjà lus, les pointages validés restant acquis.
- **Pointages (`HR-011`)** — `/rh/pointages` filtre par salarié, statut et période et recalcule à
  la lecture ses compteurs : brouillons en attente, validés et absences du mois civil d'Abidjan,
  demi-journées et heures travaillées du mois, salariés pointés. Une ligne rattache une fiche à une
  date d'au plus aujourd'hui, à une nature — travaillé ou absence — et à une durée exprimée soit en
  période soit en heures au quart d'heure. La capacité du jour se calcule sur le calendrier
  applicable au salarié, jour férié déduit : une journée ne vaut pas deux demi-journées et les
  heures ne dépassent pas la capacité horaire du jour. Deux lignes de même salarié, date et période
  sont refusées, sauf les lignes en heures qui se cumulent. Une absence explique son motif, un
  travaillé n'en porte pas. Le pointage naît en brouillon : sa sortie fige la ligne, seul le retour
  au brouillon en gestion l'ouvre à nouveau, et la suppression reste réservée au brouillon.
- **Nouvelle ligue** — le bouton de la liste `/rh/pointages`, celui d'une ligne déjà pointée et
  celui de la fiche d'un salarié ouvrent `/rh/pointages/nouveau` avec le salarié pré-sélectionné et
  la date pré-remplie. L'écran affiche les demi-journées attendues pour le jour visé, calculées sur
  le calendrier applicable et les jours fériés de la semaine, et ne laisse ouvertes que les périodes
  réellement travaillées.
- **Import XLSX des pointages (`HR-012`)** — `/rh/pointages/import` propose un modèle à six
  colonnes (matricule, date, nature, période, heures, motif), une analyse sans écriture et un
  rapport ligne à ligne. Sont bloquants un matricule inconnu de l'espace ou en doublon dans le
  fichier, une date invalide ou future, une nature ou une période inconnue, une saisie sur un jour
  non travaillée ou couverte par un férié, des heures hors capacité en cumulant les lignes du
  fichier et les pointages déjà posés, et une ligne qui reprendrait un pointage validé. Une ligne
  qui reprend un brouillon de la même période est un avertissement : ce brouillon est mis à jour,
  pas dupliqué. Un même fichier ne s'applique qu'une fois et l'application n'écrit aucun montant.
- **Le temps de travail ne lit jamais un salaire (`HR-005`).** Listes, fiches, compteurs, imports et
  audits des pointages ignorent la rémunération : la paie reste le Lot 13.

Le Lot 11C complète le module `hr` avec les congés (HR-013 à HR-019) : `/rh/conges` pour les
demandes, `/rh/conges/types` pour le paramétrage et `/rh/conges/soldes` pour les soldes. Le
paramétrage des types et la validation relèvent de la gestion, la pose d'une demande relève de
l'écriture.

- **Types de congé (`HR-013`)** — `/rh/conges/types` liste les types avec leur droit annuel et le
  nombre de demandes posées. Un type porte un code (2 à 12 caractères, normalisé en majuscules) et
  un nom, uniques dans l'espace, un droit annuel en jours (0 à 366, au centième) et deux réglages :
  congé payé et demi-journée autorisée. Un type actif accepte les demandes, un type désactivé n'en
  accepte plus mais reste sur les demandes déjà posées ; un type qui porte des demandes ne se
  supprime pas, il se désactive.
- **Demande de congé (`HR-014`, `HR-015`)** — `/rh/conges/nouvelle` ouvre une demande sur un salarié
  actif et un type actif, avec un motif facultatif de 200 caractères. La plage est bornée par un jour
  de début et un jour de fin, chacun avec une demi-journée de départ et d'arrivée, mesurée sur le
  calendrier du salarié, jours fériés et chômés déduits. Deux demandes d'un même salarié ne peuvent
  se recouvrir sur une même demi-journée — brouillon comme demande validée — tandis que deux
  demandes jointives sur des demi-journées distinctes coexistent.
- **Workflow (`HR-016`, `HR-019`)** — une demande naît en brouillon. La gestion la valide, la refuse
  avec un motif obligatoire, ou l'annule ; chaque transition laisse une trace avant/après, sans
  montant. Un brouillon se corrige et se supprime, une demande validée se retire du calendrier en
  l'annulant. Le compte membre rattaché à la fiche du salarié demandeur ne peut pas valider sa propre
  demande : la décision revient à un tiers.
- **Déduction et solde (`HR-017`, `HR-018`)** — un congé validé retire du travail attendu les
  demi-journées couvertes, comme un jour férié, sans double décompte ; un pointage sur une
  demi-journée couverte se refuse. `/rh/conges/soldes` chiffre pour chaque salarié et chaque type le
  droit annuel, les jours acquis, les brouillons en attente et le solde restant, une valeur négative
  s'affichant en alerte. La liste `/rh/conges` filtre par année, statut, salarié et type et recalcule
  à la lecture ses compteurs — brouillons, décisions de l'année, absents du jour, types actifs.

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
`discussion_mentions`, `notifications`, `tasks`, puis `customs_offices`, `customs_regimes`,
`customs_taxes`, `customs_declarations`, `customs_declaration_lines`,
`customs_declaration_taxes`, `customs_bonds`, `customs_payments`, `customs_apurements`, puis
`accounting_journals`, `fiscal_years`, `ledger_accounts`, `journal_entries`,
`journal_entry_lines`, `journal_entry_sequences`, `accounting_settings`,
`journal_entry_line_letterings` et `lettering_sequences`, puis `tender_requests`,
`tender_request_lines`, `tender_invitations`, `tender_quotes`, `tender_quote_lines` et
`tender_awards`, puis `article_supply_policies`, `supply_runs` et `supply_run_lines`, puis
`module_grants` et `module_responsibles`, puis `hr_departments`, `hr_employees` et
`hr_contracts`, puis `hr_work_calendars`, `hr_work_calendar_days`, `hr_public_holidays` et
`hr_time_entries`, puis `partner_categories` et `partner_category_links`, puis `hr_leave_types`
et `hr_leave_requests`, puis `article_categories` et `article_category_links`. Les
migrations générées sont commitées dans
`drizzle/` : `0001` pour l'identité, `0002` pour le catalogue et la traçabilité des imports,
`0003` pour les notes de lot, `0004` pour les achats et le stock, `0005` pour les ventes et la
facturation, `0006` pour la fiche entreprise et les contacts tiers, `0007` pour les échanges
fournisseurs, `0008` pour la collaboration, `0009` pour les réponses fournisseurs, `0010`
pour les tâches, `0011` pour leur chronomètre, `0012` pour la douane, `0013` pour
l'apurement progressif des IM9, `0014` pour le socle comptable et `0015` pour le paramétrage,
les écritures automatiques, le lettrage et le cut-off, `0016` pour les appels d'offres et la
cotation fournisseur, `0017` pour les politiques d'approvisionnement, les calculs de besoins et
les propositions d'achat, `0018` pour les sources d'écriture de clôture et d'à-nouveaux, `0019`
pour les droits par module et les responsables, `0020` pour l'organisation, le personnel et les
contrats de travail, `0021` pour les calendriers, jours fériés et pointages, `0022` pour les
catégories de tiers et les coordonnées, `0023` pour les types de congé et les demandes, `0024`
pour les catégories d'articles. Les
contraintes d'unicité, de rôle, de format SH, de quantités, de
cohérence article/nomenclature, de bloc bancaire, d'idempotence des évènements, d'unicité des
écritures de clôture, d'appartenance à l'espace (clé composite `(tenant_id, user_id)` vers
`memberships`) et du catalogue des modules et des niveaux (contraintes `CHECK`) sont posées en
base, en complément de la validation applicative.

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
