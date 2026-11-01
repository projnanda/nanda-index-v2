// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HomePage from "./page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function headings() {
  return Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
}
function links() {
  return Array.from(container.querySelectorAll("a"));
}

describe("homepage", () => {
  it("opens with exactly one h1 and keeps the section headings one level below it", async () => {
    await act(async () => root.render(<HomePage />));
    const all = headings();
    expect(all[0]?.tagName).toBe("H1");
    expect(all[0]?.textContent).toMatch(/\S/);
    expect(all.filter((h) => h.tagName === "H1")).toHaveLength(1);
    expect(all.slice(1).map((h) => h.tagName)).toEqual(all.slice(1).map(() => "H2"));
  });

  it("offers internal actions to explore and register before any external link", async () => {
    await act(async () => root.render(<HomePage />));
    const hrefs = links().map((a) => a.getAttribute("href"));
    const explore = hrefs.indexOf("/explore");
    // Registration goes straight to the form; its auth guard sends signed-out
    // visitors to sign in, while /login would bounce signed-in users.
    const register = hrefs.indexOf("/dashboard/orgs/new");
    const firstExternal = hrefs.findIndex((href) => /^https?:/.test(href ?? ""));
    expect(explore).toBeGreaterThanOrEqual(0);
    expect(register).toBeGreaterThanOrEqual(0);
    expect(firstExternal).toBeGreaterThan(Math.max(explore, register));
    for (const internal of links().filter((a) => a.getAttribute("href")?.startsWith("/"))) {
      expect(internal.getAttribute("target")).toBeNull();
    }
  });

  it("does not nest a second main landmark inside the layout's main", async () => {
    await act(async () => root.render(<HomePage />));
    expect(container.querySelector("main")).toBeNull();
  });
});
