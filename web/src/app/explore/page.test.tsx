// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExplorePage from "./page";

const api = vi.hoisted(() => ({ listIndexRecords: vi.fn(async () => []) }));
vi.mock("@/lib/nanda-api", () => ({ listIndexRecords: api.listIndexRecords }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.listIndexRecords.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("explore page structure", () => {
  it("titles the page with a single h1 that comes before every other heading", async () => {
    await act(async () => root.render(<ExplorePage />));
    const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    expect(headings[0]?.tagName).toBe("H1");
    expect(headings[0]?.textContent).toBe("Explore");
    expect(headings.filter((h) => h.tagName === "H1")).toHaveLength(1);
  });

  it("explains what the page is for directly under the title", async () => {
    await act(async () => root.render(<ExplorePage />));
    const h1 = container.querySelector("h1")!;
    const descriptor = h1.nextElementSibling;
    expect(descriptor?.tagName).toBe("P");
    expect(descriptor?.textContent).toMatch(/^Browse every entry listed in the index\./);
  });

  it("renders no main element of its own, so the layout's main stays the only landmark", async () => {
    await act(async () => root.render(<ExplorePage />));
    expect(container.querySelector("main")).toBeNull();
  });

  it("still loads the index and shows the empty state inside the shell", async () => {
    await act(async () => root.render(<ExplorePage />));
    expect(api.listIndexRecords).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No index records are registered yet.");
  });
});
