import { SectionHeading } from "./SectionHeading";
import { whatNandaIndexIs, whatNandaIndexIsNot } from "@/lib/site-data";

export function InfoCards() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Overview"
        title="What NANDA Index is and is not"
        description="NandaIndex does not replace existing discovery systems — it federates them into a single resolution layer."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="NANDA Index is" items={whatNandaIndexIs} />
        <Card title="NANDA Index is not" items={whatNandaIndexIsNot} />
      </div>
    </section>
  );
}

function Card({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
