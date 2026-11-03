// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./Header";

afterEach(cleanup);

describe("Header mobile navigation", () => {
  it("closes the menu when a destination is chosen", async () => {
    const user = userEvent.setup();
    const { container } = render(<Header />);
    await user.click(screen.getByText("Menu"));
    const details = container.querySelector("details")!;
    expect(details.open).toBe(true);
    const menu = screen.getByRole("navigation", { name: "Mobile navigation" });
    const destination = within(menu).getByRole("link", { name: "Explore" });
    // jsdom cannot follow page navigation; keep the component's click handler real.
    destination.addEventListener("click", (event) => event.preventDefault());
    await user.click(destination);
    expect(details.open).toBe(false);
  });
});
