import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReachPage from "./page";

/**
 * nandaindex.org/reach is the extension's identifier on the wire, so the page
 * at that URL must state the three things an implementer looks for: the header
 * that opts in, what a Company may keep, and that "none" on a routing rule is
 * a decline the sender must honour.
 */
describe("reach extension page", () => {
  const html = renderToStaticMarkup(createElement(ReachPage));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

  it("names the extension and its version", () => {
    expect(text).toMatch(/nandaindex\.org\/reach/);
    expect(html).toContain('Poppy-Extensions: &quot;nandaindex.org/reach&quot;;v=&quot;1&quot;');
  });

  it("says what a Company stores and what it must not", () => {
    expect(text).toMatch(/nanda_locator/);
    expect(text).toMatch(/MUST NOT store/);
    expect(text).toMatch(/inbox address/);
  });

  it("defines none as a decline the sender must honour", () => {
    expect(text).toMatch(/"none".*declines the topic/);
    expect(text).toMatch(/MUST honour "none"/);
  });

  it("points at the reference implementation", () => {
    expect(html).toContain("https://github.com/Sharathvc23/nanda-reach-demo");
  });
});
