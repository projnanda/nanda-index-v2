// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QueryPage from "./page";
import { ApiError, getIndexRecord, searchIndexRecords } from "@/lib/nanda-api";
import { PERSONAL_DATA_CLASS, REPLAY_MASK_CLASS } from "@/lib/analyticsPrivacy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/nanda-api", async () => {
  const original = await vi.importActual<typeof import("@/lib/nanda-api")>("@/lib/nanda-api");
  return { ...original, searchIndexRecords: vi.fn(), getIndexRecord: vi.fn() };
});

const typed = "ada@example.org weather";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function run(query: string) {
  render(<QueryPage />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
}

function isPersonal(element: Element | null) {
  expect(element?.className.split(" ")).toEqual(expect.arrayContaining(PERSONAL_DATA_CLASS.split(" ")));
}

it("hides a search term from session replays where the results repeat it", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue({ query: typed, count: 0, results: [] });
  run(typed);

  const echoes = await screen.findAllByText(typed, { selector: "span" });
  expect(echoes.length).toBeGreaterThan(0);
  echoes.forEach(isPersonal);
  isPersonal(screen.getByText(/"query":/, { selector: "pre" }));
  // The surrounding copy stays readable.
  expect(screen.getByText("No organizations found").closest(`.${REPLAY_MASK_CLASS}`)).toBeNull();
});

it("hides an error that quotes the typed org ID", async () => {
  vi.mocked(getIndexRecord).mockRejectedValue(new ApiError('org "ada-private" not found', 404));
  render(<QueryPage />);
  fireEvent.click(screen.getByRole("button", { name: "By Org ID" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "ada-private" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));

  isPersonal(await screen.findByText('404: org "ada-private" not found'));
});
