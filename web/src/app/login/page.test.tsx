// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const state = vi.hoisted(() => ({
  search: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => state.router,
  useSearchParams: () => state.search,
  usePathname: () => "/login",
}));

/** Render the page as the router would after navigating to `/login?<query>`. */
function renderAt(query = "") {
  state.search = new URLSearchParams(query);
  return render(<LoginPage />);
}

function heading() {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

function passwordField() {
  return screen.getByLabelText("Password") as HTMLInputElement;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ google: false, github: false }))));
  localStorage.clear();
  state.search = new URLSearchParams();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("login and registration", () => {
  it("opens account creation directly from the registration URL", () => {
    renderAt("mode=register");
    expect(heading()).toBe("Create account");
    expect(passwordField().autocomplete).toBe("new-password");
    expect(screen.getByRole("link", { name: "Browse public records" }).getAttribute("href")).toBe("/explore");
  });

  it("describes the new-password limits only while creating an account", () => {
    const { unmount } = renderAt("mode=register");
    const guidance = document.getElementById(passwordField().getAttribute("aria-describedby")!);
    expect(guidance?.textContent).toContain("72 bytes");
    unmount();

    renderAt();
    expect(passwordField().getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/72 bytes/)).toBeNull();
  });

  it("switches copy and password semantics with the form mode", async () => {
    const user = userEvent.setup();
    const { rerender } = renderAt();
    expect(heading()).toBe("Sign in");
    expect(passwordField().autocomplete).toBe("current-password");

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(state.router.replace).toHaveBeenLastCalledWith("/login?mode=register");
    state.search = new URLSearchParams("mode=register");
    rerender(<LoginPage />);
    expect(heading()).toBe("Create account");
    expect(passwordField().autocomplete).toBe("new-password");

    await user.click(screen.getAllByRole("button", { name: "Sign in" })[0]);
    expect(state.router.replace).toHaveBeenLastCalledWith("/login");
    state.search = new URLSearchParams();
    rerender(<LoginPage />);
    expect(heading()).toBe("Sign in");
    expect(passwordField().autocomplete).toBe("current-password");
  });

  it("follows changes to the query mode while the login page stays mounted", () => {
    const { rerender } = renderAt();
    state.search = new URLSearchParams("mode=register");
    rerender(<LoginPage />);
    expect(heading()).toBe("Create account");

    state.search = new URLSearchParams("mode=unknown");
    rerender(<LoginPage />);
    expect(heading()).toBe("Sign in");
  });
});

describe("registration URL state", () => {
  it("preserves session notices while switching mode", async () => {
    const user = userEvent.setup();
    const { rerender } = renderAt("mode=register&reason=session_expired");
    await user.click(screen.getAllByRole("button", { name: "Sign in" })[0]);
    expect(state.router.replace).toHaveBeenLastCalledWith("/login?reason=session_expired");

    state.search = new URLSearchParams("reason=session_expired");
    rerender(<LoginPage />);
    expect(heading()).toBe("Sign in");
    expect(screen.getByText(/Your session expired/)).toBeTruthy();
  });
});
