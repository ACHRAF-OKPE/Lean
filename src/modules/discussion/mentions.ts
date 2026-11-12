export interface TextSegment {
  readonly type: "text" | "mention";
  readonly value: string;
  readonly userId?: string;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
  return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
}

/**
 * Détecte les identifiants d'utilisateurs mentionnés dans le texte sous la forme `@Nom` ou `@Prénom Nom`.
 * Seuls les membres autorisés de l'espace sont retenus.
 * Traite les noms les plus longs en priorité pour éviter qu'un prénom masque un nom complet.
 */
export function detectMentionsFromText(
  body: string,
  members: readonly { readonly userId: string; readonly name: string }[],
): string[] {
  if (!body.includes("@") || members.length === 0) {
    return [];
  }

  const detected = new Set<string>();
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  let remainingText = body;

  for (const member of sorted) {
    if (!member.userId || !member.name) continue;
    const escapedName = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|\\s)@${escapedName}(?=$|\\s|[.,!?;:])`, "i");
    if (regex.test(remainingText)) {
      detected.add(member.userId);
      remainingText = remainingText.replace(new RegExp(`@${escapedName}`, "gi"), "___MENTIONED___");
    }
  }

  return Array.from(detected);
}

/**
 * Découpe un texte de message pour faire ressortir visuellement les @mentions sous forme de segments.
 */
export function parseBodyWithMentions(
  body: string,
  mentions: readonly { readonly userId?: string; readonly name: string }[] = [],
): TextSegment[] {
  if (!body) return [];
  if (!body.includes("@")) {
    return [{ type: "text", value: body }];
  }

  // Créer un dictionnaire nom -> userId
  const nameToId = new Map<string, string | undefined>();
  for (const m of mentions) {
    nameToId.set(m.name.toLowerCase(), m.userId);
  }

  if (mentions.length > 0) {
    const namesSorted = [...mentions]
      .map((m) => m.name.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    if (namesSorted.length > 0) {
      const escaped = namesSorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const regex = new RegExp(`(@(?:${escaped}))`, "gi");
      const parts = body.split(regex);
      const segments: TextSegment[] = [];

      for (const part of parts) {
        if (!part) continue;
        if (part.startsWith("@")) {
          const rawName = part.slice(1);
          const userId = nameToId.get(rawName.toLowerCase());
          segments.push({ type: "mention", value: rawName, userId });
        } else {
          segments.push({ type: "text", value: part });
        }
      }
      return segments;
    }
  }

  // Recherche générique
  const genericRegex = /(@[A-Za-zÀ-ÿ0-9_-]+(?:\s+[A-Za-zÀ-ÿ0-9_-]+)?)/g;
  const parts = body.split(genericRegex);
  const segments: TextSegment[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("@")) {
      const rawName = part.slice(1).trim();
      const userId = nameToId.get(rawName.toLowerCase());
      segments.push({ type: "mention", value: rawName, userId });
    } else {
      segments.push({ type: "text", value: part });
    }
  }

  return segments;
}
