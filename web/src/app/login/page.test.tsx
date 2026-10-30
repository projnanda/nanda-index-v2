// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
import { Header } from "@/components/Header";

const state = vi.hoisted(() => ({
  search: new URLSearchParams(),
  pathname: "/login",
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => state.router,
  useSearchParams: () => state.search,
  usePathname: () => state.pathname,
}));

let container: HTMLDivElement;
let root: Root;
async function render(element: React.ReactNode) {
  await act(async () => { root.render(element); });
}
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === label)!;
}
function links(label: string) {
  return Array.from(container.querySelectorAll("a")).filter((el) => el.textContent?.trim() === label);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ google: false, github: false }))));
  localStorage.clear();
  state.search = new URLSearchParams();
  state.pathname = "/login";
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("login and registration", () => {
  it("opens account creation directly from the registration URL", async () => {
    state.search = new URLSearchParams("mode=register");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Create account");
    const password = container.querySelector<HTMLInputElement>("input[type=password]")!;
    expect(password.autocomplete).toBe("new-password");
    expect(document.getElementById(password.getAttribute("aria-describedby")!)?.textContent).toContain("8");
    expect(links("Browse public records")[0]?.getAttribute("href")).toBe("/explore");
  });

  it("switches copy and password semantics with the form mode", async () => {
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
    await act(async () => button("Create account").click());
    expect(state.router.replace).toHaveBeenLastCalledWith("/login?mode=register");
    state.search = new URLSearchParams("mode=register");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Create account");
    expect(container.querySelector<HTMLInputElement>("input[type=password]")?.autocomplete).toBe("new-password");
    await act(async () => button("Sign in").click());
    expect(state.router.replace).toHaveBeenLastCalledWith("/login");
    state.search = new URLSearchParams();
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
    expect(container.querySelector<HTMLInputElement>("input[type=password]")?.autocomplete).toBe("current-password");
  });

  it("follows changes to the query mode while the login page stays mounted", async () => {
    await render(<LoginPage />);
    state.search = new URLSearchParams("mode=register");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Create account");
    state.search = new URLSearchParams("mode=unknown");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
  });
});

describe("registration URL state", () => {
  it("preserves session notices while switching mode and follows back navigation", async () => {
    state.search = new URLSearchParams("mode=register&reason=session_expired");
    await render(<LoginPage />);
    await act(async () => button("Sign in").click());
    expect(state.router.replace).toHaveBeenLastCalledWith("/login?reason=session_expired");
    state.search = new URLSearchParams("reason=session_expired");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Sign in");
    state.search = new URLSearchParams("mode=register&reason=session_expired");
    await render(<LoginPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Create account");
  });
});

describe("auth-aware header", () => {
  it("shows sign-in and sign-up links on desktop and mobile while signed out", async () => {
    await render(<Header />);
    expect(links("Sign in").map((a) => a.getAttribute("href"))).toEqual(["/login", "/login"]);
    expect(links("Sign up").map((a) => a.getAttribute("href"))).toEqual(["/register", "/register"]);
    expect(links("Dashboard")).toHaveLength(0);
  });

  it("shows Dashboard on desktop and mobile only while signed in", async () => {
    const payload = { userId: "test", email: "test@example.com", displayName: "Test User", exp: Date.now() / 1000 + 600 };
    localStorage.setItem("nanda_auth_token", `header.${btoa(JSON.stringify(payload))}.signature`);
    await render(<Header />);
    expect(links("Dashboard")).toHaveLength(2);
    expect(links("Sign in")).toHaveLength(0);
    expect(links("Sign up")).toHaveLength(0);
    await act(async () => button("Sign out").click());
    expect(localStorage.getItem("nanda_auth_token")).toBeNull();
    expect(links("Dashboard")).toHaveLength(0);
    expect(links("Sign up")).toHaveLength(2);
  });

  it("treats expired sessions as signed out", async () => {
    localStorage.setItem("nanda_auth_token", `header.${btoa(JSON.stringify({ userId: "test", email: "test@example.com", exp: 1 }))}.signature`);
    await render(<Header />);
    expect(links("Dashboard")).toHaveLength(0);
    expect(links("Sign up")).toHaveLength(2);
  });
});
