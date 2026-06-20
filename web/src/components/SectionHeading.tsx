type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function SectionHeading({ eyebrow, title, description }: Props) {
  return (
    <div className="mb-6">
      {eyebrow ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-semibold tracking-[-0.01em] text-[color:var(--color-fg-strong)]">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[color:var(--color-fg-muted)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
