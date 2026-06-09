import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  children: ReactNode;
};

export function PageShell({ title, description, children }: Props) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-serif text-4xl italic tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}