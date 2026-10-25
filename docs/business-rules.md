# Registre des règles métier

Ce registre est la source de vérité des règles de Lean. Une règle entre dans le code
uniquement après y avoir été inscrite avec un identifiant stable, une source et un statut.
L'implémentation doit citer le test correspondant.

## Protocole clean-room

1. Lire la référence Axelor en **lecture seule**, sans modifier le dépôt.
2. Décrire la règle en français : comportement observable, cas limites, erreurs attendues.
3. Citer la source : fichier et symbole Axelor, ou brief du porteur, ou référentiel externe.
4. Écrire l'implémentation à partir de cette description, sans copier de code, de noms ou de
   commentaires.
5. Ajouter le test qui vérifie la règle et relier les deux dans le tableau.

Axelor est publié sous AGPL-3.0. Aucun code du dépôt de référence n'est incorporé. Toute
réutilisation d'un extrait, même minime, exigerait une revue de licence explicite.

## Format d'identifiant

`<DOMAINE>-<NNN>`, numéro à trois chiffres, jamais réutilisé.

| Préfixe | Domaine                      |
| ------- | ---------------------------- |
| `GEN`   | Transverse                   |
| `TEN`   | Tenants, utilisateurs, rôles |
| `ART`   | Tiers et articles            |
| `PUR`   | Achats                       |
| `STK`   | Stock et mouvements          |
| `SAL`   | Ventes                       |
| `CUS`   | Douane                       |
| `ACC`   | Comptabilité SYSCOHADA       |
| `RPT`   | Rapports et clôture          |

## Statuts

| Statut        | Sens                                                           |
| ------------- | -------------------------------------------------------------- |
| `adoptée`     | Décidée, pas encore implémentée                                |
| `implémentée` | Code et test présents                                          |
| `à instruire` | Sujet identifié, aucune règle arrêtée : pas encore d'ID        |
| `remplacée`   | Conservée pour l'historique, renvoie vers la règle qui la suit |

## Preuve de fidélité

La fidélité à Axelor se mesure **règle par règle**, pas par le langage. Une règle n'est
`implémentée` que si les six preuves suivantes existent :

| Preuve         | Contenu exigé                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Source         | Fichier et symbole Axelor, référentiel externe (UEMOA, SYSCOHADA, ASYCUDA) ou brief porteur daté                       |
| Comportement   | Description en français du résultat observable : entrées, sorties, erreurs, cas limites                                |
| Cas de parité  | Table de scénarios « entrée → résultat attendu », dérivés du comportement décrit                                       |
| Implémentation | Module testable dans `src/lib` ou `src/modules/<domaine>`                                                              |
| Test           | Test Vitest citant l'identifiant de la règle et couvrant les cas de parité                                             |
| Écarts connus  | Ce qui diverge d'Axelor, pourquoi, et l'impact accepté ; « aucun » est une réponse valide seulement après vérification |

Une règle dont un cas de parité échoue reste `adoptée`. On ne coche pas une règle parce que
l'écran s'affiche : on la coche parce que le comportement est vérifié.

### Oracle Axelor à la demande

Quand un comportement est ambigu (garde de transition, cut-off, valorisation), on démarre
Axelor **localement et ponctuellement** en Docker comme oracle : on rejoue le scénario, on
note le résultat, puis on arrête le conteneur. Rien ne tourne en permanence. L'oracle sert à
alimenter les cas de parité, jamais à recopier du code, des noms ou des commentaires.

### Matrice de couverture

| Lot | Règles identifiées | Implémentées | Écarts documentés | État    |
| --- | ------------------ | ------------ | ----------------- | ------- |
| 0   | 11 (GEN)           | 4            | aucun             | livré   |
| 1   | 6 (TEN)            | 6            | 6                 | livré   |
| 2   | 0                  | 0            | —                 | à venir |
| 3   | 0                  | 0            | —                 | à venir |
| 4   | 0                  | 0            | —                 | à venir |
| 5   | 0                  | 0            | —                 | à venir |
| 6   | 0                  | 0            | —                 | à venir |
| 7   | 0                  | 0            | —                 | à venir |

Un lot ne peut pas être déclaré livré si la matrice ne reflète pas ses règles et ses écarts.

### Garanti / non garanti

**Garanti :** chaque règle implémentée du registre a un test qui cite son identifiant ; les
flux métier complets tournent avec de vraies données, y compris l'import XLSX réel, son
template et son rapport ligne à ligne ; les montants XOF restent entiers ; l'isolation tenant
est testée ; chaque mutation est auditable ; chaque écart est écrit.

**Non garanti :** une couverture 100 % d'Axelor ; l'identité pixel de l'interface (la parité
est fonctionnelle, pas visuelle) ; la compatibilité avec les plugins, le Studio ou le schéma
Axelor ; la reprise automatique de données Axelor existantes.

## Règles transverses

| ID      | Règle                                                                                                                                         | Source                    | Statut        | Mise en œuvre                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- | ------------------------------------------------------------------------ |
| GEN-001 | La devise fonctionnelle est le XOF. Les montants sont des entiers sans décimale, affichés au format français avec le suffixe F CFA.           | Brief porteur, 2026-10-25 | `implémentée` | `src/lib/money.ts`, `src/lib/money.test.ts`                              |
| GEN-002 | Le référentiel comptable est SYSCOHADA/OHADA. Le plan comptable français (PCG) est exclu.                                                     | Brief porteur, 2026-10-25 | `adoptée`     | Lot 6                                                                    |
| GEN-003 | Les droits de douane suivent le tarif extérieur UEMOA et le TEDU.                                                                             | Brief porteur, 2026-10-25 | `adoptée`     | Lot 5                                                                    |
| GEN-004 | Les régimes douaniers sont ceux d'ASYCUDA, avec acquit-à-caution et apurement.                                                                | Brief porteur, 2026-10-25 | `adoptée`     | Lot 5                                                                    |
| GEN-005 | Les ports sont identifiés par leur code UN/LOCODE régional.                                                                                   | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2 et 5                                                              |
| GEN-006 | Les conditions de vente utilisent les Incoterms 2020.                                                                                         | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2, 4 et 5                                                           |
| GEN-007 | L'interface est en français et les formats d'affichage sont français (dates, nombres, montants).                                              | Brief porteur, 2026-10-25 | `implémentée` | `src/app/layout.tsx`, `src/lib/money.ts`                                 |
| GEN-008 | Chaque donnée métier appartient à un tenant. Aucune lecture ni écriture ne franchit la frontière d'un tenant.                                 | Brief porteur, 2026-10-25 | `implémentée` | `src/db/schema.ts`, `src/modules/identity/queries.ts`, `queries.test.ts` |
| GEN-009 | Les boutons sont uniquement des icônes accessibles (icône, `aria-label`, `title`), jamais des boutons texte.                                  | Brief porteur, 2026-10-25 | `implémentée` | `src/app/page.tsx`, `src/app/connexion/login-form.tsx`                   |
| GEN-010 | Un import de données passe par le vrai fichier XLSX, un template téléchargeable et un rapport de vérification par ligne avant toute écriture. | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2 et suivants                                                       |
| GEN-011 | Les articles portent une nomenclature douanière HS.                                                                                           | Brief porteur, 2026-10-25 | `adoptée`     | Lot 2                                                                    |

## Règles d'identité et de tenants

Le modèle multi-tenant répond au brief porteur. Il ne s'appuie sur aucun modèle Axelor : la
parité porte ici sur le comportement attendu par le porteur, pas sur un écran de référence.

| ID      | Règle                                                                                                                                                                                                    | Source                    | Statut        | Mise en œuvre                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- | -------------------------------------------------------------------------- |
| TEN-001 | Une session n'est valide que si son jeton existe, n'est pas expiré et si l'utilisateur est encore membre du tenant qu'elle désigne. La vérification a lieu à chaque requête serveur.                     | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/queries.ts`, `src/lib/auth/session.ts`               |
| TEN-002 | Trois rôles : propriétaire (toutes permissions), administrateur (membres, audit, données ; pas la gestion du tenant), membre (données). L'autorisation est vérifiée côté serveur, refus par défaut.      | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/permissions.ts`, `src/lib/auth/session.ts`           |
| TEN-003 | Le mot de passe est stocké en scrypt salé (N=32768, r=8, p=1, clé de 64 octets, 12 caractères minimum). Le jeton de session est opaque (32 octets) et seule son empreinte SHA-256 est stockée.           | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/password.ts`, `tokens.ts`, `src/lib/auth/cookies.ts` |
| TEN-004 | Connexion, déconnexion, changement d'espace et amorçage écrivent un évènement d'audit avec tenant, acteur, action, entité et détails. La lecture est filtrée par tenant et réservée aux rôles autorisés. | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/queries.ts`, `src/app/audit/page.tsx`                |
| TEN-005 | Aucune inscription publique. Le premier propriétaire est créé par un amorçage idempotent qui valide slug, email et mot de passe avant de créer tenant, utilisateur et membership.                        | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/bootstrap.ts`, `src/db/seed.ts`                      |
| TEN-006 | Le changement d'espace n'est accepté que si l'utilisateur possède une membership dans le tenant cible. La session est réaffectée et l'évènement `tenant.switch` consigne l'ancien et le nouveau tenant.  | Brief porteur, 2026-10-25 | `implémentée` | `src/modules/identity/queries.ts`, `src/lib/auth/actions.ts`               |

### Preuves du Lot 1

| ID      | Comportement et cas de parité                                                                                                                                                                                                                                                                                                                                   | Test                                                         | Écarts connus                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TEN-001 | Jeton inconnu → aucune session. Session expirée → refus. Membership supprimée → refus. Session dont le tenant ne correspond à aucune membership → refus. Membership valide → session résolue avec rôle et nom du tenant. Sans session, une page protégée redirige vers `/connexion`. Plusieurs memberships → défaut : rôle le plus fort, puis la plus ancienne. | `queries.test.ts` (TEN-001), `permissions.test.ts` (TEN-001) | Durée fixe de 7 jours, sans renouvellement glissant ni rotation ; pas de révocation globale par utilisateur.                                 |
| TEN-002 | Propriétaire → toutes permissions. Administrateur → audit, membres et données, jamais `tenant.manage`. Membre → données uniquement. Rôle inconnu → refus. L'UI masque le lien d'audit, mais la garde serveur reste l'autorité : accès refusé → `/acces-refuse`.                                                                                                 | `permissions.test.ts` (TEN-002), parcours navigateur         | Aucune interface de gestion des membres ni de changement de rôle ; `members.manage` et `tenant.manage` sont définis mais pas encore exposés. |
| TEN-003 | Le hash commence par les paramètres scrypt, ne contient jamais le mot de passe, diffère à chaque sel, accepte le bon secret et refuse le mauvais. Un mot de passe trop court lève une erreur. Un hash malformé renvoie faux sans lever. Jeton de 43 caractères base64url, unique, dont seule l'empreinte SHA-256 est stockée.                                   | `password.test.ts` (TEN-003), `tokens.test.ts` (TEN-003)     | Pas de limitation des tentatives ni de verrouillage, pas de MFA, pas de réinitialisation de mot de passe.                                    |
| TEN-004 | Les évènements d'un tenant ne sont jamais visibles depuis un autre. Le changement d'espace écrit un évènement dans le tenant cible avec `fromTenantId` et `toTenantId`. La déconnexion est tracée après le changement. La lecture est bornée à 200 lignes.                                                                                                      | `queries.test.ts` (TEN-004 / GEN-008)                        | Les échecs de connexion ne sont pas audités ; ni IP ni agent utilisateur ; pas d'export ni de chaîne d'intégrité (Lot 7).                    |
| TEN-005 | Un slug hors du format `^[a-z0-9]+(-[a-z0-9]+)*$` est refusé. Un mot de passe trop court est refusé avant écriture. Le premier appel crée tenant, propriétaire et membership. Un second appel ne duplique rien et n'écrit pas de second évènement d'amorçage. La connexion retrouve l'adresse normalisée en minuscules.                                         | `queries.test.ts` (TEN-005)                                  | Amorçage réservé à un script local avec variables d'environnement ; pas d'invitation ni de création de tenant depuis l'interface.            |
| TEN-006 | Cible sans membership → refus et session inchangée. Cible avec membership → session réaffectée, même jeton. Un acteur qui ne possède pas la session ne peut pas la déplacer. L'évènement `tenant.switch` n'apparaît que dans le tenant cible.                                                                                                                   | `queries.test.ts` (TEN-006)                                  | Pas de réauthentification ni de confirmation avant changement d'espace ; pas de notification au propriétaire du tenant quitté.               |

## Sujets à instruire

Ces sujets ne sont **pas encore des règles** : ils seront lus dans Axelor, reformulés puis
inscrits avec un identifiant au moment du lot concerné.

| Lot | Sujet à instruire                                                       | Référence principale à lire               |
| --- | ----------------------------------------------------------------------- | ----------------------------------------- |
| 2   | Structure article, unités, nomenclature HS, validation des tiers        | `axelor-base`, brief porteur, tarif UEMOA |
| 3   | Sémantique des mouvements de stock, réservations, réceptions partielles | `axelor-stock`, `axelor-supplychain`      |
| 4   | Cycle vente → livraison → facture, facturation des mouvements           | `axelor-sale`, `axelor-supplychain`       |
| 5   | Régimes, acquit-à-caution, apurement, liquidation TEDU                  | Référentiel ASYCUDA, brief porteur        |
| 6   | Cut-off comptable, écritures de stock, rapprochements SYSCOHADA         | `axelor-account`, `axelor-supplychain`    |
| 7   | Clôture, états de gestion, exports                                      | `axelor-account`, brief porteur           |

## Journal des sources

| Date       | Source                           | Ce qui a été utilisé                                        |
| ---------- | -------------------------------- | ----------------------------------------------------------- |
| 2026-10-25 | Brief porteur du projet Lean     | Stack, devise, référentiels, barre du module réel, lots     |
| 2026-10-25 | Brief porteur : réécriture       | Parité fonctionnelle visée, indépendance du langage         |
| 2026-10-25 | `Desktop\Axelor` (lecture seule) | Cadrage uniquement, aucune règle métier extraite à ce stade |
