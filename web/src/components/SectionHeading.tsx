type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function SectionHeading({ eyebrow, title, description }: Props) {
  return (
    <div className="mb-6">
      {eyebrow ? (
        <p className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-500">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-serif text-3xl italic tracking-tight text-slate-950">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {description}
        </p>
      ) : null}
    </div>
  );
}