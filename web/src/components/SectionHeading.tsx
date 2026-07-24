type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function SectionHeading({ eyebrow, title, description }: Props) {
  return (
    <div className="mb-8">
      {eyebrow ? (
        <p className="brand-label mb-3">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-display text-ink-strong">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-medium">
          {description}
        </p>
      ) : null}
    </div>
  );
}
