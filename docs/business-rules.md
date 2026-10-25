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

## Règles transverses

| ID      | Règle                                                                                                                                         | Source                    | Statut        | Mise en œuvre                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- | ----------------------------------------------- |
| GEN-001 | La devise fonctionnelle est le XOF. Les montants sont des entiers sans décimale, affichés au format français avec le suffixe F CFA.           | Brief porteur, 2026-10-25 | `implémentée` | `src/lib/money.ts`, `src/lib/money.test.ts`     |
| GEN-002 | Le référentiel comptable est SYSCOHADA/OHADA. Le plan comptable français (PCG) est exclu.                                                     | Brief porteur, 2026-10-25 | `adoptée`     | Lot 6                                           |
| GEN-003 | Les droits de douane suivent le tarif extérieur UEMOA et le TEDU.                                                                             | Brief porteur, 2026-10-25 | `adoptée`     | Lot 5                                           |
| GEN-004 | Les régimes douaniers sont ceux d'ASYCUDA, avec acquit-à-caution et apurement.                                                                | Brief porteur, 2026-10-25 | `adoptée`     | Lot 5                                           |
| GEN-005 | Les ports sont identifiés par leur code UN/LOCODE régional.                                                                                   | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2 et 5                                     |
| GEN-006 | Les conditions de vente utilisent les Incoterms 2020.                                                                                         | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2, 4 et 5                                  |
| GEN-007 | L'interface est en français et les formats d'affichage sont français (dates, nombres, montants).                                              | Brief porteur, 2026-10-25 | `implémentée` | `src/app/layout.tsx`, `src/lib/money.ts`        |
| GEN-008 | Chaque donnée métier appartient à un tenant. Aucune lecture ni écriture ne franchit la frontière d'un tenant.                                 | Brief porteur, 2026-10-25 | `adoptée`     | Lot 1, racine `tenants` dans `src/db/schema.ts` |
| GEN-009 | Les boutons sont uniquement des icônes accessibles (icône, `aria-label`, `title`), jamais des boutons texte.                                  | Brief porteur, 2026-10-25 | `adoptée`     | `docs/conventions.md` §2                        |
| GEN-010 | Un import de données passe par le vrai fichier XLSX, un template téléchargeable et un rapport de vérification par ligne avant toute écriture. | Brief porteur, 2026-10-25 | `adoptée`     | Lots 2 et suivants                              |
| GEN-011 | Les articles portent une nomenclature douanière HS.                                                                                           | Brief porteur, 2026-10-25 | `adoptée`     | Lot 2                                           |

## Sujets à instruire

Ces sujets ne sont **pas encore des règles** : ils seront lus dans Axelor, reformulés puis
inscrits avec un identifiant au moment du lot concerné.

| Lot | Sujet à instruire                                                       | Référence principale à lire                                   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Modèle tenant, rôles, permissions, journal d'audit                      | Brief porteur ; aucune reprise de modèle Axelor sans décision |
| 2   | Structure article, unités, nomenclature HS, validation des tiers        | `axelor-base`, brief porteur, tarif UEMOA                     |
| 3   | Sémantique des mouvements de stock, réservations, réceptions partielles | `axelor-stock`, `axelor-supplychain`                          |
| 4   | Cycle vente → livraison → facture, facturation des mouvements           | `axelor-sale`, `axelor-supplychain`                           |
| 5   | Régimes, acquit-à-caution, apurement, liquidation TEDU                  | Référentiel ASYCUDA, brief porteur                            |
| 6   | Cut-off comptable, écritures de stock, rapprochements SYSCOHADA         | `axelor-account`, `axelor-supplychain`                        |
| 7   | Clôture, états de gestion, exports                                      | `axelor-account`, brief porteur                               |

## Journal des sources

| Date       | Source                           | Ce qui a été utilisé                                        |
| ---------- | -------------------------------- | ----------------------------------------------------------- |
| 2026-10-25 | Brief porteur du projet Lean     | Stack, devise, référentiels, barre du module réel, lots     |
| 2026-10-25 | `Desktop\Axelor` (lecture seule) | Cadrage uniquement, aucune règle métier extraite à ce stade |
