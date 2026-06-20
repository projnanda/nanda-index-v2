export function Footer() {
  return (
    <footer className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-[color:var(--color-fg-weak)] sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p>NANDA Index — Federated Agent Discovery</p>
        <p>Resolve any agent identity to the correct discovery object.</p>
      </div>
    </footer>
  );
}
