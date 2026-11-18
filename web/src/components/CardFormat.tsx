import { FieldLabel } from "@/components/FieldLabel";
import { CARD_FORMATS, cardFormatLabel, type CardFormat } from "@/lib/cardFormats";
import { cardStatus } from "@/lib/entryStatus";
import { formatTimestamp } from "@/lib/formatTimestamp";
import { ORG_FIELD_HELP } from "@/lib/org-field-help";
import type { CardValidation } from "@/lib/nanda-types";

/** Read view: the declared card format and the server's latest structural check of it. */
export function CardCheckSummary({ format, check }: { format: CardFormat; check: CardValidation | null | undefined }) {
  const status = cardStatus(check);
  return (
    <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <div><span className="font-medium">Card format:</span> <span>{cardFormatLabel(format)}</span></div>
      <p className="font-medium">Card check: {status.label}</p>
      <p className="text-xs text-slate-600">{status.detail}</p>
      {status.checkedAt && <p className="text-xs text-slate-500">Checked {formatTimestamp(status.checkedAt)}</p>}
      {check?.status === "invalid" && (
        <p className="text-xs text-slate-500">
          If the card at this URL uses the other format, edit this entry and change its card format to recheck it.
        </p>
      )}
    </div>
  );
}

interface CardFormatFieldProps {
  id: string;
  value: CardFormat;
  /** The saved format and whether its last check passed — switching away from a passing card is likely a mistake. */
  stored: CardFormat;
  storedPasses: boolean;
  onChange: (format: CardFormat) => void;
}

/** Edit form: switches between the A2A and MCP card formats. */
export function CardFormatField({ id, value, stored, storedPasses, onChange }: CardFormatFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <FieldLabel htmlFor={id} label="Card format" info={ORG_FIELD_HELP.media_type} />
      <select id={id} value={value} aria-describedby={hintId} onChange={(e) => onChange(e.target.value as CardFormat)}
        className="w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300">
        {CARD_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
      </select>
      <p id={hintId} className="mt-1 text-[11px] text-slate-400">Changing the format rechecks the card when you save. Your identifier and verification stay the same.</p>
      {storedPasses && value !== stored && (
        <p role="status" className="mt-1 text-xs text-amber-700">
          This card currently passes its check as an {cardFormatLabel(stored)}. Switch only if the file at this URL is an {cardFormatLabel(value)}; otherwise the check will fail and resolvers will read the card in the wrong format.
        </p>
      )}
    </div>
  );
}
