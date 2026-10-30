// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInMethods } from "./SignInMethods";

const api = vi.hoisted(() => ({ getAuthProviders: vi.fn() }));
vi.mock("@/lib/nanda-api", () => ({ getAuthProviders: api.getAuthProviders }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.getAuthProviders.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<p>an email address and a password<SignInMethods /></p>));
}

describe("SignInMethods", () => {
  it("names nothing beyond email and password when no provider is configured", async () => {
    api.getAuthProviders.mockResolvedValue({ google: false, github: false });
    await render();
    expect(container.textContent).toBe("an email address and a password");
  });

  it("names only the providers the API reports as configured", async () => {
    api.getAuthProviders.mockResolvedValue({ google: true, github: false });
    await render();
    expect(container.textContent).toBe("an email address and a password, or a Google sign-in");
  });

  it("names both providers when both are configured", async () => {
    api.getAuthProviders.mockResolvedValue({ google: true, github: true });
    await render();
    expect(container.textContent).toBe("an email address and a password, or a Google or GitHub sign-in");
  });

  it("claims no provider when the API cannot be reached", async () => {
    api.getAuthProviders.mockRejectedValue(new Error("offline"));
    await render();
    expect(container.textContent).toBe("an email address and a password");
  });
});
