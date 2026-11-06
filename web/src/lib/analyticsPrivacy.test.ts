// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CaptureResult, CapturedNetworkRequest } from "posthog-js";
import {
  PERSONAL_DATA_CLASS,
  REPLAY_MASK_CLASS,
  isPrivatePath,
  redactEmails,
  scrubEvent,
  scrubNetworkRequest,
  scrubReplayAttribute,
  scrubReplayText,
  stripQueryAndHash,
} from "./analyticsPrivacy";

/** A minimal PostHog event as `before_send` receives it. */
function event(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: "0190-test", event: "$pageview", properties: {}, ...overrides };
}

describe("isPrivatePath", () => {
  it.each([
    "/reset-password",
    "/auth/callback",
    "/verify-email",
    "/verify-account",
    "/login",
    "/register",
    "/forgot-password",
    "/dashboard",
    "/dashboard/",
    "/dashboard/orgs/123",
    "/dashboard/settings",
  ])("%s is private", (path) => {
    expect(isPrivatePath(path)).toBe(true);
  });

  it.each(["/", "/explore", "/privacy", "/authors", "/login-help", "/dashboards", "/registries"])("%s is public", (path) => {
    expect(isPrivatePath(path)).toBe(false);
  });
});

describe("stripQueryAndHash", () => {
  it("drops the query string and fragment of an absolute URL", () => {
    expect(stripQueryAndHash("https://nandaindex.org/reset-password?token=abc#x")).toBe("https://nandaindex.org/reset-password");
  });

  it("drops them from a relative URL too", () => {
    expect(stripQueryAndHash("/auth/callback?token=jwt")).toBe("/auth/callback");
    expect(stripQueryAndHash("/explore#mcp")).toBe("/explore");
  });

  it("leaves a URL without either unchanged", () => {
    expect(stripQueryAndHash("https://nandaindex.org/explore")).toBe("https://nandaindex.org/explore");
  });
});

describe("scrubEvent", () => {
  it("drops every event while the visitor is on a private page", () => {
    expect(scrubEvent(event(), "/reset-password")).toBeNull();
    expect(scrubEvent(event({ event: "$snapshot" }), "/auth/callback")).toBeNull();
  });

  it("passes a null event through", () => {
    expect(scrubEvent(null, "/")).toBeNull();
  });

  it("strips query strings from URL properties, including person properties", () => {
    const scrubbed = scrubEvent(
      event({
        properties: {
          $current_url: "https://nandaindex.org/explore?q=weather",
          $referrer: "https://github.com/login/oauth?code=secret",
          $pathname: "/explore",
        },
        $set_once: { $initial_current_url: "https://nandaindex.org/verify-email?token=t" },
      }),
      "/explore",
    );

    expect(scrubbed?.properties).toMatchObject({
      $current_url: "https://nandaindex.org/explore",
      $referrer: "https://github.com/login/oauth",
      $pathname: "/explore",
    });
    expect(scrubbed?.$set_once).toEqual({ $initial_current_url: "https://nandaindex.org/verify-email" });
  });

  it("strips query strings from link hrefs in autocaptured elements", () => {
    const scrubbed = scrubEvent(
      event({
        event: "$autocapture",
        properties: {
          $elements_chain: 'a:attr__href="/verify-email?token=t"href="/verify-email?token=t"nth-child="1";div',
          $elements: [{ tag_name: "a", attr__href: "/reset-password?token=t" }],
        },
      }),
      "/explore",
    );

    expect(scrubbed?.properties.$elements_chain).toBe('a:attr__href="/verify-email"href="/verify-email"nth-child="1";div');
    expect(scrubbed?.properties.$elements).toEqual([{ tag_name: "a", attr__href: "/reset-password" }]);
  });

  it("redacts email addresses anywhere in the event", () => {
    const scrubbed = scrubEvent(
      event({ event: "$autocapture", properties: { $el_text: "Signed in as Ada@Example.org" } }),
      "/explore",
    );

    expect(scrubbed?.properties.$el_text).toBe("Signed in as [email]");
  });

  it("leaves non-URL text with a question mark alone", () => {
    const scrubbed = scrubEvent(event({ properties: { $el_text: "What is NANDA?" } }), "/");

    expect(scrubbed?.properties.$el_text).toBe("What is NANDA?");
  });

  it("does not rewrite session-replay snapshots (their URLs are masked when recorded)", () => {
    const snapshot = event({ event: "$snapshot", properties: { $snapshot_data: [{ type: 2, data: "H4sI…@a.bc" }] } });

    expect(scrubEvent(snapshot, "/explore")).toBe(snapshot);
  });

  it("does not mutate the event it was given", () => {
    const original = event({ properties: { $current_url: "https://nandaindex.org/explore?q=x" } });

    scrubEvent(original, "/explore");

    expect(original.properties.$current_url).toBe("https://nandaindex.org/explore?q=x");
  });
});

describe("scrubReplayAttribute", () => {
  it.each(["href", "action", "formaction"])("strips the query string from a recorded %s", (name) => {
    expect(scrubReplayAttribute(name, "https://nandaindex.org/verify-email?token=t#x")).toBe("https://nandaindex.org/verify-email");
  });

  it("leaves image sources whole so replays still show them", () => {
    expect(scrubReplayAttribute("src", "/_next/image?url=%2Flogos%2Fa.png&w=64")).toBe("/_next/image?url=%2Flogos%2Fa.png&w=64");
  });

  it("redacts email addresses in any attribute", () => {
    expect(scrubReplayAttribute("href", "mailto:Ada@Example.org")).toBe("mailto:[email]");
    expect(scrubReplayAttribute("title", "Owner: ada@example.org")).toBe("Owner: [email]");
  });

  it("leaves other attributes unchanged", () => {
    expect(scrubReplayAttribute("class", "h-9 rounded-control")).toBe("h-9 rounded-control");
  });
});

describe("scrubReplayText", () => {
  function element(html: string, selector: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root.querySelector<HTMLElement>(selector)!;
  }

  it("keeps ordinary page text readable", () => {
    const heading = element("<h2>Weather agent</h2>", "h2");
    expect(scrubReplayText("Weather agent · verified by acme.example", heading)).toBe("Weather agent · verified by acme.example");
  });

  it("redacts email addresses shown on the page", () => {
    const identity = element("<span>owner</span>", "span");
    expect(scrubReplayText("Identity: Ada@Example.org (email)", identity)).toBe("Identity: [email] (email)");
  });

  it("masks every character of text marked as personal, keeping its shape", () => {
    const name = element(`<span class="${REPLAY_MASK_CLASS}">x</span>`, "span");
    expect(scrubReplayText("(Ada Lovelace)", name)).toBe("**** *********");
  });

  it("masks text nested anywhere inside an element marked as personal", () => {
    const inner = element(`<div class="${REPLAY_MASK_CLASS}"><p><b>x</b></p></div>`, "b");
    expect(scrubReplayText("Ada", inner)).toBe("***");
  });

  it("still redacts email addresses when the recorder gives no element", () => {
    expect(scrubReplayText("write to ada@example.org")).toBe("write to [email]");
    expect(scrubReplayText("write to ada@example.org", null)).toBe("write to [email]");
  });

  it("stars out an email inside a personal-data element rather than redacting it", () => {
    const name = element(`<span class="${PERSONAL_DATA_CLASS}">x</span>`, "span");
    expect(scrubReplayText("ada@example.org", name)).toBe("***************");
  });
});

describe("PERSONAL_DATA_CLASS", () => {
  it("masks replays and keeps the text out of autocaptured clicks", () => {
    expect(PERSONAL_DATA_CLASS.split(" ")).toEqual([REPLAY_MASK_CLASS, "ph-sensitive"]);
  });
});

describe("redactEmails", () => {
  it.each([
    ["every address in a string", "ada@example.org, bob@example.net", "[email], [email]"],
    ["a URL-encoded @, as in a request URL", "/api/v1/resolve?locator=urn%3Aair%3Ahost39.org%3Apersonal%3Aada%40example.org", "/api/v1/resolve?locator=[email]"],
    ["an apostrophe in the local part", "o'brien@example.org", "[email]"],
    ["non-ASCII letters", "josé@exämple.de", "[email]"],
  ])("redacts %s", (_case, input, expected) => {
    expect(redactEmails(input)).toBe(expected);
  });

  it("leaves text without an address untouched", () => {
    expect(redactEmails("urn:air:host39.org:weather · 100% uptime")).toBe("urn:air:host39.org:weather · 100% uptime");
  });
});

describe("scrubNetworkRequest", () => {
  it("strips the query string from a recorded network request", () => {
    const request = {
      name: "https://api.nandaindex.org/api/v1/search?q=weather",
      entryType: "resource",
      startTime: 1,
      duration: 2,
      isInitial: false,
    } as CapturedNetworkRequest;

    expect(scrubNetworkRequest(request)).toEqual({ ...request, name: "https://api.nandaindex.org/api/v1/search" });
  });

  it("strips it from a page URL the recorder masks (passed as just { name })", () => {
    const pageUrl = { name: "https://nandaindex.org/auth/callback?token=jwt" } as CapturedNetworkRequest;

    expect(scrubNetworkRequest(pageUrl)).toEqual({ name: "https://nandaindex.org/auth/callback" });
  });
});
