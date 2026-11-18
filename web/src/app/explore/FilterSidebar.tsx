import {
  OWNERS,
  OWNER_LABELS,
  PROTOCOLS,
  PROTOCOL_LABELS,
  type FacetTally,
  type Owner,
  type Protocol,
} from "@/lib/entryCategory";

export interface FilterSidebarProps {
  search: string;
  onSearchChange: (value: string) => void;
  ownerFilters: ReadonlySet<Owner>;
  protocolFilters: ReadonlySet<Protocol>;
  /** Null until the index has loaded, so no option shows a "0" nobody counted. */
  ownerTally: FacetTally<Owner> | null;
  protocolTally: FacetTally<Protocol> | null;
  /** Entries in the whole index; null until it has loaded. */
  total: number | null;
  onToggleOwner: (value: Owner) => void;
  onToggleProtocol: (value: Protocol) => void;
  onClear: () => void;
}

export function FilterSidebar(props: FilterSidebarProps) {
  const hasActive =
    props.ownerFilters.size > 0 || props.protocolFilters.size > 0 || props.search.trim().length > 0;
  return (
    <aside className="lg:w-64 flex-shrink-0">
      <div className="bg-surface-strong rounded-card border border-line p-4 space-y-5 sticky top-24">
        <div>
          <label
            htmlFor="search"
            className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-1.5"
          >
            Search
          </label>
          <input
            type="text"
            id="search"
            placeholder="Filter by name, identifier, or domain..."
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            className="w-full rounded-control border-2 border-line bg-surface-light px-3 py-2 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500"
          />
        </div>

        <FacetGroup
          facet="owner"
          legend="Owner"
          options={OWNERS}
          labels={OWNER_LABELS}
          selected={props.ownerFilters}
          tally={props.ownerTally}
          onToggle={props.onToggleOwner}
        />
        <FacetGroup
          facet="protocol"
          legend="Protocol"
          options={PROTOCOLS}
          labels={PROTOCOL_LABELS}
          selected={props.protocolFilters}
          tally={props.protocolTally}
          onToggle={props.onToggleProtocol}
        />

        {props.total !== null && (
          <p data-entry-summary className="text-xs text-ink-weak">
            {props.total} {props.total === 1 ? "entry" : "entries"}
          </p>
        )}

        {hasActive && (
          <button
            onClick={props.onClear}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    </aside>
  );
}

interface FacetGroupProps<T extends string> {
  facet: string;
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: ReadonlySet<T>;
  tally: FacetTally<T> | null;
  onToggle: (value: T) => void;
}

// Choices inside a group are alternatives (OR); the two groups narrow each other (AND).
function FacetGroup<T extends string>({ facet, legend, options, labels, selected, tally, onToggle }: FacetGroupProps<T>) {
  return (
    <fieldset data-facet={facet}>
      <legend className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-2">
        {legend}
      </legend>
      <div className="space-y-1.5">
        {options.map((option) => (
          <FacetOption
            key={option}
            label={labels[option]}
            count={tally ? tally.counts.get(option) ?? 0 : null}
            checked={selected.has(option)}
            onToggle={() => onToggle(option)}
          />
        ))}
      </div>
      {tally && tally.unspecified > 0 && (
        <p data-facet-unspecified className="mt-2 text-xs text-ink-weak">
          {tally.unspecified} unspecified
        </p>
      )}
    </fieldset>
  );
}

interface FacetOptionProps {
  label: string;
  /** Null until the index has loaded. */
  count: number | null;
  checked: boolean;
  onToggle: () => void;
}

function FacetOption({ label, count, checked, onToggle }: FacetOptionProps) {
  const isEmpty = count === 0;
  return (
    <label
      data-facet-option
      data-empty={String(isEmpty)}
      className={`flex items-center justify-between gap-2 text-sm cursor-pointer ${
        isEmpty ? "text-ink-weak opacity-60" : "text-ink"
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="rounded border-line-strong text-brand-500 focus:ring-brand-500"
        />
        <span data-facet-label>{label}</span>
      </span>
      <span data-facet-count className="text-xs text-ink-weak tabular-nums">
        {count === null ? "–" : count}
      </span>
    </label>
  );
}
