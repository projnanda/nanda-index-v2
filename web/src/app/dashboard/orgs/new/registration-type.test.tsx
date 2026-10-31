// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewOrgPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
// jsdom omits CSS.escape, which user-event uses for the ASCII radio name.
vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
afterEach(cleanup);

describe("registration type cards", () => {
  it("exposes a labeled group with exactly one checked radio", async () => {
    const user = userEvent.setup();
    render(<NewOrgPage />);
    expect(screen.getByRole("group", { name: "What best describes you?" })).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.filter((radio) => radio.checked)).toEqual([radios[0]]);
    await user.click(screen.getByRole("radio", { name: /Personal Agent/ }));
    expect(radios.filter((radio) => radio.checked)).toEqual([radios[3]]);
    expect(screen.getByLabelText(/^Email Identity/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Domain/)).toBeNull();
  });

  it("moves selection and focus with arrow keys", async () => {
    const user = userEvent.setup();
    render(<NewOrgPage />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    radios[0].focus();
    await user.keyboard("[ArrowRight]");
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
    await user.keyboard("[ArrowLeft][ArrowLeft]");
    expect(document.activeElement).toBe(radios[3]);
    expect(radios[3].checked).toBe(true);
  });
});
