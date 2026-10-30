import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { navigation } from "./site-data";

const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

function pageFor(href: string): string {
  return `${APP_DIR}${href === "/" ? "" : href.slice(1) + "/"}page.tsx`;
}

type Redirect = { source: string; destination: string; permanent: boolean };
async function redirects(): Promise<Redirect[]> {
  return (await nextConfig.redirects?.()) as Redirect[];
}

describe("navigation", () => {
  it("points every item at a page whose path matches its label", () => {
    for (const item of navigation) {
      expect(existsSync(pageFor(item.href)), `${item.label} -> ${item.href}`).toBe(true);
    }
    const discover = navigation.find((item) => item.label === "Discover");
    expect(discover?.href).toBe("/discover");
  });
});

describe("/query compatibility", () => {
  it("permanently redirects the old Discover path to /discover", async () => {
    expect(await redirects()).toContainEqual({ source: "/query", destination: "/discover", permanent: true });
  });

  it("keeps no page at the old path, so the redirect is the only handler", async () => {
    expect(existsSync(pageFor("/query"))).toBe(false);
    for (const { destination } of await redirects()) {
      expect(existsSync(pageFor(destination)), `redirect target ${destination}`).toBe(true);
    }
  });
});
