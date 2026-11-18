import { describe, it, expect, afterEach } from 'vitest';
import {
  buildEntryProfile,
  updateEntryProfile,
  EntryProfileError,
  NANDA_EXTENSION,
} from '../../src/lib/entryProfile.js';

const base = { orgId: 'acme', contactEmail: 'admin@example.com', displayName: 'Example' };

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

/** An entry built under a namespace of the registrant's own choosing. */
function withExtensions(extensions: Record<string, Record<string, unknown>>) {
  return () => buildEntryProfile({ ...base, path: 'registry', domain: 'example.com', extensions });
}

describe('extensions — active-content URLs', () => {
  it('rejects javascript: in a namespace the registrant invented', () => {
    // The case this change exists for: validating only
    // org.projectnanda.runtime.url left every other key open.
    expect(withExtensions({ 'com.evil': { url: 'javascript:alert(1)' } })).toThrow(
      EntryProfileError,
    );
  });

  it('names the offending path, so the registrant can find it', () => {
    expect(withExtensions({ 'com.evil': { url: 'javascript:alert(1)' } })).toThrow(
      /extensions\.com\.evil\.url/,
    );
  });

  it('rejects it nested several levels down', () => {
    expect(
      withExtensions({ 'com.evil': { a: { b: { c: { href: 'javascript:alert(1)' } } } } }),
    ).toThrow(EntryProfileError);
  });

  it('rejects it inside an array, and says which element', () => {
    expect(withExtensions({ 'com.evil': { links: ['https://ok', 'javascript:alert(1)'] } })).toThrow(
      /links\[1\]/,
    );
  });

  it('rejects vbscript:', () => {
    expect(withExtensions({ 'com.evil': { url: 'vbscript:msgbox(1)' } })).toThrow(EntryProfileError);
  });

  it('rejects data: URLs that declare markup', () => {
    for (const url of [
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'data:application/xhtml+xml,<html/>',
    ]) {
      expect(withExtensions({ 'com.evil': { url } })).toThrow(EntryProfileError);
    }
  });

  describe('evasions', () => {
    it('rejects leading whitespace before the scheme', () => {
      expect(withExtensions({ 'com.evil': { url: '   javascript:alert(1)' } })).toThrow(
        EntryProfileError,
      );
    });

    it('rejects a control character inside the scheme, which browsers strip', () => {
      // java<tab>script:alert(1) navigates, so matching the raw string would
      // leave the easiest evasion there is.
      for (const sep of [TAB, LF, NUL]) {
        expect(withExtensions({ 'com.evil': { url: `java${sep}script:alert(1)` } })).toThrow(
          EntryProfileError,
        );
      }
    });

    it('rejects whitespace between the scheme and the colon', () => {
      expect(withExtensions({ 'com.evil': { url: `javascript${TAB}:alert(1)` } })).toThrow(
        EntryProfileError,
      );
    });

    it('is case-insensitive', () => {
      expect(withExtensions({ 'com.evil': { url: 'JaVaScRiPt:alert(1)' } })).toThrow(
        EntryProfileError,
      );
      expect(withExtensions({ 'com.evil': { url: 'DATA:TEXT/HTML,<script>' } })).toThrow(
        EntryProfileError,
      );
    });
  });

  describe('things that must keep working', () => {
    // Over-blocking is a defect too. "data:", "about:" and "file:" are
    // ordinary English and appear in real metadata.
    const allowed: Record<string, string> = {
      'an https URL': 'https://example.com/agent',
      'a date written after a label': 'data: 2026-01-01',
      'prose beginning with about': 'about: the refunds agent',
      'prose beginning with file': 'file: see the attached catalog',
      'a png data URL': 'data:image/png;base64,iVBORw0KGgo=',
      'the word javascript inside a sentence': 'written in javascript: mostly',
      'an empty string': '',
    };
    for (const [what, value] of Object.entries(allowed)) {
      it(`accepts ${what}`, () => {
        expect(withExtensions({ 'com.example': { note: value } })).not.toThrow();
      });
    }

    it('accepts non-string values without inspecting them as URLs', () => {
      expect(
        withExtensions({ 'com.example': { n: 1, ok: true, nothing: null, list: [1, 2] } }),
      ).not.toThrow();
    });

    it('leaves an entry with no extensions alone', () => {
      expect(() => buildEntryProfile({ ...base, path: 'registry', domain: 'example.com' })).not.toThrow();
    });
  });

  it('applies on update as well as create', () => {
    const current = buildEntryProfile({ ...base, path: 'registry', domain: 'example.com' });
    expect(() =>
      updateEntryProfile(current, { extensions: { 'com.evil': { url: 'javascript:alert(1)' } } }),
    ).toThrow(EntryProfileError);
  });

  it('does not revalidate stored metadata on an unrelated edit', () => {
    // An entry registered before this check existed must stay editable; the
    // check applies to what is being supplied, not to what is already stored.
    const current = buildEntryProfile({ ...base, path: 'registry', domain: 'example.com' });
    const legacy = {
      ...current,
      extensions: { ...current.extensions, 'com.legacy': { url: 'javascript:alert(1)' } },
    };
    expect(() => updateEntryProfile(legacy, { publisherDisplayName: 'Renamed' })).not.toThrow();
  });
});

describe('extensions — namespace policy', () => {
  afterEach(() => {
    delete process.env['EXTENSION_NAMESPACE_POLICY'];
  });

  it('accepts any reverse-DNS namespace by default', () => {
    // Default is open on purpose: one entry on the live index publishes under
    // a namespace that is not its own domain reversed, and this change must
    // not reject its next update.
    expect(withExtensions({ 'dev.agenticprimitives': { estate: 'faithnet' } })).not.toThrow();
  });

  describe('with EXTENSION_NAMESPACE_POLICY=anchored', () => {
    it('accepts the reverse-DNS form of the domain the entry proved', () => {
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'anchored';
      expect(withExtensions({ 'com.example': { did: 'did:web:example.com' } })).not.toThrow();
    });

    it('accepts org.projectnanda', () => {
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'anchored';
      expect(withExtensions({ [NANDA_EXTENSION]: { 'runtime.url': 'https://example.com' } })).not.toThrow();
    });

    it('rejects a namespace belonging to somebody else’s domain', () => {
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'anchored';
      expect(withExtensions({ 'com.someoneelse': { claim: 'theirs' } })).toThrow(
        /use "org\.projectnanda" or "com\.example"/,
      );
    });

    it('allows a personal entry only org.projectnanda, since it proved no domain', () => {
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'anchored';
      expect(() =>
        buildEntryProfile({
          ...base,
          path: 'personal',
          domain: null,
          extensions: { 'com.example': { mine: true } },
        }),
      ).toThrow(/may only use "org\.projectnanda"/);
    });

    it('checks the new domain on a re-anchoring update, not the old one', () => {
      const current = buildEntryProfile({ ...base, path: 'registry', domain: 'example.com' });
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'anchored';
      expect(() =>
        updateEntryProfile(current, {
          domain: 'acme.com',
          extensions: { 'com.acme': { ok: true } },
        }),
      ).not.toThrow();
      expect(() =>
        updateEntryProfile(current, {
          domain: 'acme.com',
          extensions: { 'com.example': { stale: true } },
        }),
      ).toThrow(EntryProfileError);
    });

    it('treats an unrecognised policy value as open rather than failing closed on startup', () => {
      process.env['EXTENSION_NAMESPACE_POLICY'] = 'strict-ish-typo';
      expect(withExtensions({ 'com.someoneelse': { claim: 'theirs' } })).not.toThrow();
    });
  });
});

/**
 * Review on #133: the first version of the scheme test rejected ordinary
 * metadata — a skills list beginning an entry with "JavaScript:" came back
 * 400. The test is now two-tier, strict under a URL-shaped key and relaxed
 * for prose elsewhere. These pin that boundary down from both sides.
 */
describe('extensions — prose that merely starts with a scheme name', () => {
  it('accepts a skills list entry of "JavaScript: React"', () => {
    expect(withExtensions({ 'com.example': { skills: ['JavaScript: React'] } })).not.toThrow();
  });

  it('accepts "JavaScript: ES2022, TypeScript" as a free-text value', () => {
    expect(withExtensions({ 'com.example': { languages: 'JavaScript: ES2022, TypeScript' } })).not.toThrow();
  });

  it('still rejects a payload with no space after the scheme, under any key', () => {
    expect(withExtensions({ 'com.example': { skills: ['javascript:alert(1)'] } }))
      .toThrow(EntryProfileError);
  });

  it('is strict under a URL-shaped key, space or not', () => {
    // A value here is going to be handed to an href; prose is not expected.
    expect(withExtensions({ 'com.example': { homepageUrl: 'javascript: alert(1)' } }))
      .toThrow(EntryProfileError);
    expect(withExtensions({ 'com.example': { 'runtime.url': 'javascript: alert(1)' } }))
      .toThrow(EntryProfileError);
    expect(withExtensions({ 'com.example': { href: 'vbscript: msgbox(1)' } }))
      .toThrow(EntryProfileError);
  });

  it('carries the key down into arrays, so a list of links stays strict', () => {
    expect(withExtensions({ 'com.example': { links: ['javascript: alert(1)'] } }))
      .toThrow(EntryProfileError);
  });

  it('leaves the data: rules alone — markup refused, prose kept', () => {
    expect(withExtensions({ 'com.example': { note: 'data:text/html,<script>x</script>' } }))
      .toThrow(EntryProfileError);
    expect(withExtensions({ 'com.example': { updated: 'data: 2026-01-01' } })).not.toThrow();
  });
});

describe('extensions — object keys', () => {
  it('rejects an active-content URL used as a key', () => {
    expect(withExtensions({ 'com.example': { 'javascript:alert(1)': 'x' } }))
      .toThrow(EntryProfileError);
  });

  it('says the problem was a key, not a value', () => {
    expect(withExtensions({ 'com.example': { 'javascript:alert(1)': 'x' } }))
      .toThrow(/as a key/);
  });

  it('rejects a key nested deeper down', () => {
    expect(withExtensions({ 'com.example': { meta: { 'vbscript:msgbox(1)': 'x' } } }))
      .toThrow(EntryProfileError);
  });

  it('leaves ordinary keys alone', () => {
    expect(withExtensions({ 'com.example': { 'runtime.url': 'https://example.com/run' } }))
      .not.toThrow();
  });
});

const NBSP = String.fromCharCode(160);

/**
 * Re-review on #133: the first prose exemption keyed on "is there a space
 * after the colon", which turned out to exempt every payload that bothered to
 * add one. The exemption is now defined by what a payload needs — brackets,
 * assignment, terminators, quotes, percent-encoding — so these stay refused
 * while the prose below stays accepted.
 */
describe('extensions — the prose exemption cannot be used as a bypass', () => {
  const bypasses: ReadonlyArray<readonly [string, string]> = [
    ['a plain space', 'javascript: alert(1)'],
    ['a non-breaking space', `javascript:${NBSP}alert(1)`],
    ['percent-encoding the call', 'javascript: %61lert%281%29'],
    ['a tagged template call', 'javascript: alert`1`'],
    ['a comment before the call', 'javascript:  /**/alert(1)'],
    ['assignment and a throw', 'javascript: onerror=alert;throw 1'],
  ];

  it.each(bypasses)('refuses %s, under a key that is not URL-shaped', (_label, value) => {
    expect(withExtensions({ 'com.example': { skills: [value] } })).toThrow(EntryProfileError);
  });

  it('still accepts prose with punctuation that cannot execute', () => {
    expect(withExtensions({ 'com.example': { languages: 'JavaScript: Node.js, Deno & Bun' } }))
      .not.toThrow();
  });
});

describe('extensions — URL-shaped strictness is inherited, not reset', () => {
  it('refuses a payload inside an array of link objects', () => {
    // The most natural way to write a list of links, and the shape that
    // escaped the check entirely before strictness was inherited.
    expect(withExtensions({
      'com.example': { links: [{ label: 'x', target: 'javascript: alert(1)' }] },
    })).toThrow(EntryProfileError);
  });

  it('refuses a payload inside an object of links', () => {
    expect(withExtensions({ 'com.example': { links: { home: 'javascript: alert(1)' } } }))
      .toThrow(EntryProfileError);
  });

  it('leaves an ordinary link alone', () => {
    expect(withExtensions({
      'com.example': { links: [{ label: 'Home', target: 'https://example.com' }] },
    })).not.toThrow();
  });
});

describe('extensions — prose keys', () => {
  it('accepts a key that merely opens with a scheme name', () => {
    expect(withExtensions({ 'com.example': { 'JavaScript: notes': 'tooling' } })).not.toThrow();
  });

  it('still refuses a key that could execute', () => {
    expect(withExtensions({ 'com.example': { 'javascript: alert(1)': 'x' } }))
      .toThrow(/as a key/);
  });
});
