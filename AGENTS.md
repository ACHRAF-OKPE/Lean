<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Lean — règles du dépôt

- Lire `docs/conventions.md` et `docs/business-rules.md` avant toute modification.
- Gate obligatoire : `npm run gate` (lint, format, types, tests, build). Aucun push sans gate verte.
- Interface française, boutons icône uniquement avec `aria-label` et `title`, montants XOF entiers.
- `Desktop\Axelor` est une référence en lecture seule : reformuler la règle et citer la source, ne jamais copier de code.
- Migration : `npm run db:generate`; ne jamais modifier une migration déjà appliquée.
