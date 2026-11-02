import { expect, it } from "vitest";
import { GET } from "./route";

const context = (kind: string, path: string[]) => ({ params: Promise.resolve({ kind, path }) });

it("does not build example URLs from the request's Host header", async () => {
  const request = new Request("http://localhost:3000/api/resolve-examples/catalog/index", {
    headers: { host: "evil.example:3000" },
  });
  const response = await GET(request, context("catalog", ["index"]));
  const body = (await response.json()) as { entry: { url: string } };
  expect(JSON.stringify(body)).not.toContain("evil.example");
  expect(JSON.stringify(body)).not.toContain(":3000");
  expect(body.entry.url).toBe("/api/resolve-examples/catalog/registry");
});

it("links the card to its same-origin runtime", async () => {
  const response = await GET(new Request("http://localhost/api/resolve-examples/smb/card"), context("smb", ["card"]));
  expect(((await response.json()) as { url: string }).url).toBe("/api/resolve-examples/smb/runtime");
});

it("returns 404 for unknown example resources", async () => {
  const response = await GET(new Request("http://localhost/x"), context("other", ["index"]));
  expect(response.status).toBe(404);
});
