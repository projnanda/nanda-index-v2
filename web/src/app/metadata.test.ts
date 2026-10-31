import { readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { TITLE_TEMPLATE } from "@/lib/site-metadata";

/**
 * Every rendered route must set its own <title>. The root layout's template
 * appends the site name to a plain page title; a page may instead set an
 * absolute title that already includes it. Client pages cannot export
 * metadata, so their segment's layout.tsx carries it. Redirect-only routes
 * never render a document and are skipped.
 */
const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const REDIRECT_ONLY = new Set(["/register", "/registries"]);

function pageDirs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageDirs(full));
    else if (entry.name === "page.tsx") out.push(dir);
  }
  return out;
}

type RouteModule = {
  metadata?: Metadata;
  generateMetadata?: (props: { params: Promise<Record<string, string>> }) => Promise<Metadata>;
};

/** Metadata declared for the route's own segment: its layout.tsx if it has one, else the page. */
async function routeMetadata(dir: string): Promise<Metadata | undefined> {
  const layout = join(dir, "layout.tsx");
  const file = existsSync(layout) ? layout : join(dir, "page.tsx");
  const mod = (await import(file)) as RouteModule;
  if (mod.generateMetadata) return mod.generateMetadata({ params: Promise.resolve({ org_id: "moon-bakery" }) });
  return mod.metadata;
}

/** What the tab will show, before the template: the page's own words. */
function usableTitle(metadata: Metadata | undefined): { text: string; absolute: boolean } | null {
  const title = metadata?.title;
  if (typeof title === "string") return title.trim() ? { text: title, absolute: false } : null;
  if (title && typeof title === "object") {
    if ("absolute" in title && typeof title.absolute === "string" && title.absolute.trim()) {
      return { text: title.absolute, absolute: true };
    }
    if ("default" in title && typeof title.default === "string" && title.default.trim()) {
      return { text: title.default, absolute: false };
    }
  }
  return null;
}

const routes = pageDirs(APP_DIR)
  .filter((dir) => dir !== APP_DIR)
  .map((dir) => ({ dir, route: "/" + relative(APP_DIR, dir).split("\\").join("/") }))
  .filter(({ route }) => !REDIRECT_ONLY.has(route));

describe("page titles", () => {
  it("discovers the rendered routes under src/app", () => {
    const found = routes.map((r) => r.route);
    expect(found).toContain("/explore");
    expect(found).toContain("/dashboard/orgs/[org_id]");
    expect(found).not.toContain("/register");
  });

  it("gives each rendered route a distinct, usable title", async () => {
    const rendered = new Map<string, string>();
    for (const { dir, route } of routes) {
      const title = usableTitle(await routeMetadata(dir));
      expect(title, `${route} has no title of its own`).not.toBeNull();
      // A plain title gets the site name from the template; it must not add it again.
      if (!title!.absolute) expect(title!.text, `${route} repeats the site name`).not.toMatch(/nanda index/i);
      rendered.set(route, title!.absolute ? title!.text : TITLE_TEMPLATE.replace("%s", title!.text));
    }
    expect(new Set(rendered.values()).size, "duplicate titles").toBe(rendered.size);
  });

  it("names the organization being managed from the URL", async () => {
    const title = usableTitle(await routeMetadata(join(APP_DIR, "dashboard", "orgs", "[org_id]")));
    expect(title?.text).toContain("moon-bakery");
  });

  // Next applies a title template only from the nearest layout that defines
  // one, so a layout that sets a title and has routes below it must pass the
  // template on, or those routes render without the site name.
  it("passes the site-name template on from every titled layout that has routes below it", async () => {
    const parents = routes.filter(
      ({ dir }) =>
        existsSync(join(dir, "layout.tsx")) && routes.some((other) => other.dir !== dir && other.dir.startsWith(dir + "/")),
    );
    expect(parents.length).toBeGreaterThan(0);
    for (const { dir, route } of parents) {
      const title = (await routeMetadata(dir))?.title;
      if (title === undefined) continue;
      expect(title, `${route} layout must forward the template`).toMatchObject({ template: TITLE_TEMPLATE });
    }
  });
});
