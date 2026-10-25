# Conventions — Lean

Ce document fixe les règles de construction du dépôt. Il s'applique à tous les lots.
Le registre métier associé est [`docs/business-rules.md`](./business-rules.md).

## 1. Principe directeur

Lean est une réécriture propre. Le dépôt `Desktop\Axelor` est une **référence en lecture
seule** : on y lit des mécanismes (mouvements de stock, cut-off, MRP, gardes de transition),
on reformule la règle en français dans le registre, puis on écrit notre propre code.

Aucun fichier Java, aucun extrait de code, aucun identifiant ni commentaire d'Axelor n'est
recopié. Une règle sans identifiant dans le registre ne part pas en production.

### Parité Axelor

La fidélité vise le **comportement métier**, pas le langage ni le pixel. Chaque règle
implémentée porte sa source citée, son comportement décrit, ses cas de parité, son test et
ses écarts connus, conformément à [`docs/business-rules.md`](./business-rules.md#preuve-de-fidélité).
Quand un comportement est ambigu, on rejoue le scénario sur un Axelor local démarré à la
demande comme oracle, puis on l'arrête : aucun service permanent, aucune copie de code.

## 2. Langue et interface

- Interface **100 % française**. Code et identifiants techniques en anglais. Documentation en
  français.
- Montants en **XOF**, entiers, sans décimale, affichés avec `formatXof`. Aucun calcul
  monétaire en virgule flottante.
- **Boutons icône uniquement**, jamais de bouton texte. Chaque bouton porte une icône, un
  `aria-label` et un `title`. Les liens de navigation peuvent rester textuels.
- Tableaux denses, chiffres en `tabular-nums`, actions destructives confirmées.
- Accessibilité : libellé sur chaque contrôle, focus visible, contraste suffisant.

## 3. Architecture

- Next.js App Router, React Server Components par défaut. `"use client"` uniquement sur les
  feuilles interactives.
- La logique métier vit dans `src/lib` et, à mesure que les domaines arrivent,
  `src/modules/<domaine>`. Elle est **pure** : ni React, ni Next, ni accès base. C'est elle que
  les tests couvrent.
- L'accès base est serveur uniquement, via Drizzle. Aucune requête SQL concaténée, aucun
  secret exposé au client.
- Mutations par Server Actions ; Route Handlers pour les webhooks, exports et intégrations.
- `cacheComponents` est activé : tout est dynamique par défaut, le cache est déclaré
  explicitement avec `use cache`.
- Toute entrée externe (formulaire, XLSX, API) est validée côté serveur avant écriture.

## 4. Multi-tenant

- `tenants` est la racine. Chaque table métier porte un `tenant_id` non nul.
- Toute contrainte d'unicité métier inclut `tenant_id`. Les index commencent par `tenant_id`.
- Aucune requête métier sans contexte tenant. Un accès inter-tenant est un défaut bloquant.
- Les tests d'isolation sont obligatoires dès le Lot 1 : lecture, écriture et export.

## 5. Données

- Tables au pluriel, colonnes en `snake_case`, propriétés TypeScript en `camelCase`.
- Identifiants `uuid` générés en base ; dates en `timestamptz`, stockées en UTC.
- Montants XOF : `integer`. Quantités et prix unitaires qui exigent une précision :
  `numeric(18,6)`, jamais `float` ni `double`.
- Une migration appliquée ne se modifie jamais. On ajoute une migration corrective.
- Le schéma est la source de vérité ; les types dérivés viennent de Drizzle.

## 6. Fichiers et nommage

- Fichiers en `kebab-case`, composants React en `PascalCase`, fonctions en `camelCase`.
- Tests colocalisés : `money.test.ts` à côté de `money.ts`.
- Les identifiants de règles (`GEN-001`, `CUS-004`…) sont stables et ne sont jamais réutilisés.

## 7. Tests et barrière

- Vitest. Chaque règle implémentée possède au moins un test qui cite son identifiant et
  couvre ses cas de parité. Un test qui ne cite aucune règle ne prouve rien : il documente au
  mieux un utilitaire.
- La barrière du porteur (lint, types, tests, build) est complétée par le formatage :

```bash
npm run gate
```

Elle s'exécute à l'identique en local et dans GitHub Actions. Aucun push sans gate vert.
Les tests d'intégration base utilisent PGlite (Postgres en mémoire) et les migrations
réelles ; ils ne touchent jamais la production et ne lancent aucun service permanent.

## 8. Git et livraison

- Branche `main`, déploiement Vercel depuis `main`.
- Un lot = un ensemble de commits cohérents, gate vert, puis push.
- Messages de commit : `type(scope): sujet`, avec `feat`, `fix`, `chore`, `docs`, `test`,
  `refactor`.
- Aucun secret dans le dépôt. Les variables vivent dans Vercel et Neon, `.env.example`
  documente les clés attendues.

## 9. Import XLSX — barre du module réel

Tout module alimenté par un fichier respecte ce protocole :

1. Import du **vrai fichier XLSX** de l'utilisateur, pas seulement du CSV.
2. **Template téléchargeable** : colonnes exactes, valeurs autorisées, lignes d'exemple.
3. Analyse en deux temps : le fichier est d'abord validé **sans écriture**, puis un
   **rapport par ligne** distingue erreurs bloquantes et avertissements.
4. Aucune écriture tant qu'une erreur bloquante existe ; aucune correction silencieuse.
5. Écriture traçable : fichier source, ligne, horodatage, acteur. Réimport idempotent.

## 10. Définition de fini d'un lot

Un lot est livré quand :

- son périmètre est décrit et ses décisions sont consignées ;
- ses règles métier ont un identifiant, une source citée, un comportement décrit et des cas
  de parité ;
- chaque règle implémentée a son test citant l'identifiant, et ses écarts connus sont écrits ;
- la matrice de couverture de `docs/business-rules.md` est à jour ;
- les migrations sont générées et commitées ;
- les tests passent, la gate est verte et GitHub Actions est verte ;
- le code est poussé sur `main` ;
- la feuille de route et la documentation sont à jour.

## 11. Sécurité

- Authentification et autorisation vérifiées côté serveur, jamais uniquement dans l'UI.
- Principe du moindre privilège pour les rôles ; les actions sensibles sont auditées.
- Chaque mutation est traçable : acteur, tenant, entité, avant/après.
- Les secrets ne sont ni loggés, ni committés, ni envoyés au client.
