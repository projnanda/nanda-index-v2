import type { UpdateOrgPayload } from "./nanda-types";

/** The JSON card formats an entry administrator may switch between in place. */
export type CardFormat = NonNullable<UpdateOrgPayload["media_type"]>;

/**
 * Mirrors the server's JSON_CARD_MEDIA_TYPES. Catalogs and other artifacts are
 * deliberately absent: the server refuses to convert them, because their
 * media type also decides whether an unverified domain is publicly listed.
 * Typed as a Record so adding a format to CardFormat fails to compile until it
 * has a label here.
 */
const CARD_FORMAT_LABELS: Readonly<Record<CardFormat, string>> = {
  "application/a2a-agent-card+json": "A2A agent card",
  "application/mcp-server-card+json": "MCP server card",
};

export const CARD_FORMATS: readonly { readonly value: CardFormat; readonly label: string }[] =
  (Object.keys(CARD_FORMAT_LABELS) as CardFormat[]).map((value) => ({ value, label: CARD_FORMAT_LABELS[value] }));

/** The entry's card format, or null when its media type is not a correctable JSON card. */
export function cardFormatOf(mediaType: string | null | undefined): CardFormat | null {
  return mediaType && Object.hasOwn(CARD_FORMAT_LABELS, mediaType) ? mediaType as CardFormat : null;
}

export function cardFormatLabel(format: CardFormat): string {
  return CARD_FORMAT_LABELS[format];
}
