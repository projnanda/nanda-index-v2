import { describe, expect, it } from "vitest";
import type { CaptureResult, CapturedNetworkRequest } from "posthog-js";
import {
  isPrivatePath,
  scrubEvent,
  scrubNetworkRequest,
  scrubReplayAttribute,
  stripQueryAndHash,
} from "./analyticsPrivacy";

/** A minimal PostHog event as `before_send` receives it. */
function event(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: "0190-test", event: "$pageview", properties: {}, ...overrides };
}

describe("isPrivatePath", () => {
  it.each(["/reset-password", "/auth/callback", "/verify-email", "/verify-account"])("%s is private", (path) => {
    expect(isPrivatePath(path)).toBe(true);
  });

  it.each(["/", "/explore", "/dashboard", "/privacy", "/authors"])("%s is public", (path) => {
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
      "/dashboard",
    );

    expect(scrubbed?.properties.$elements_chain).toBe('a:attr__href="/verify-email"href="/verify-email"nth-child="1";div');
    expect(scrubbed?.properties.$elements).toEqual([{ tag_name: "a", attr__href: "/reset-password" }]);
  });

  it("redacts email addresses anywhere in the event", () => {
    const scrubbed = scrubEvent(
      event({ event: "$autocapture", properties: { $el_text: "Signed in as Ada@Example.org" } }),
      "/dashboard",
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

it("strips shared personal fragments from analytics, replay links and page recording", () => {
  const fragment = "#urn=urn%3Aair%3Ahost39.org%3Apersonal%3Aada%40example.org";
  const scrubbed = scrubEvent(event({ properties: {
    $current_url: `https://nandaindex.org/resolve${fragment}`,
    $elements: [{ attr__href: `/resolve${fragment}` }],
    $el_text: "urn:air:host39.org:personal:ada@example.org",
  } }), "/resolve");
  expect(scrubbed?.properties.$current_url).toBe("https://nandaindex.org/resolve");
  expect(scrubbed?.properties.$elements).toEqual([{ attr__href: "/resolve" }]);
  expect(JSON.stringify(scrubbed)).not.toContain("ada");
  expect(scrubReplayAttribute("href", `/resolve${fragment}`)).toBe("/resolve");
  expect(scrubNetworkRequest({ name: `https://nandaindex.org/resolve${fragment}` } as CapturedNetworkRequest).name).toBe("https://nandaindex.org/resolve");
});
