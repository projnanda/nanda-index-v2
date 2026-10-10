import { describe, it, expect } from 'vitest';
import {
  buildEntryProfile,
  updateEntryProfile,
  EntryProfileError,
  NANDA_EXTENSION,
} from '../../src/lib/entryProfile.js';

const base = { orgId: 'acme', contactEmail: 'admin@example.com', displayName: 'Example' };

describe('buildEntryProfile — paper §6 record shapes', () => {
  it('registry path → nested AI Catalog entry anchored at <domain>:catalog:root', () => {
    const profile = buildEntryProfile({ ...base, path: 'registry', domain: 'example.com' });
    expect(profile).toEqual({
      identifier: 'urn:air:example.com:catalog:root',
      mediaType: 'application/ai-catalog+json',
      publisher: { identifier: 'example.com', displayName: 'Example', identityType: 'dns' },
      extensions: {
        [NANDA_EXTENSION]: {
          resolutionRole: 'nested-ai-catalog',
          preferredDiscovery: 'ai-catalog',
          nandaIndexRole: 'optional-fallback-entry',
        },
      },
    });
  });

  it('dns-svcb path → A2A Agent Card entry with a DNS SVCB pointer role', () => {
    const profile = buildEntryProfile({
      ...base, orgId: 'refunds', path: 'dns-svcb', domain: 'skyblue.com', displayName: 'SkyBlue Airlines',
    });
    expect(profile.identifier).toBe('urn:air:skyblue.com:agent:refunds');
    expect(profile.mediaType).toBe('application/a2a-agent-card+json');
    expect(profile.publisher).toEqual({ identifier: 'skyblue.com', displayName: 'SkyBlue Airlines', identityType: 'dns' });
    expect(profile.extensions[NANDA_EXTENSION]).toEqual({
      resolutionRole: 'dns-svcb-pointer',
      preferredDiscovery: 'dns-svcb',
      authoritativeSystem: 'skyblue.com DNS',
      nandaIndexRole: 'federated-pointer',
    });
  });

  it('smb path → agent card entry, client runtime/auth hints preserved', () => {
    const profile = buildEntryProfile({
      ...base,
      orgId: 'orders',
      path: 'smb',
      domain: 'moonbakery.com',
      extensions: {
        [NANDA_EXTENSION]: { agentCardHost: 'host39.org', 'runtime.provider': 'AWS', resolutionRole: 'spoofed' },
      },
    });
    expect(profile.identifier).toBe('urn:air:moonbakery.com:agent:orders');
    expect(profile.extensions[NANDA_EXTENSION]).toEqual({
      resolutionRole: 'smb-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'host39.org',
      'runtime.provider': 'AWS',
    });
  });

  it('personal path → host39-anchored identifier, host39 publisher, verified email as subjectAccount', () => {
    const profile = buildEntryProfile({
      ...base, path: 'personal', domain: null, contactEmail: 'John@Hotmail.com', displayName: "John's Personal Agent",
    });
    expect(profile.identifier).toBe('urn:air:host39.org:personal:john-hotmail-com');
    expect(profile.publisher).toEqual({ identifier: 'host39.org', displayName: 'Host39', identityType: 'dns' });
    expect(profile.extensions[NANDA_EXTENSION]).toEqual({
      resolutionRole: 'personal-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'host39.org',
      subjectAccount: 'john@hotmail.com',
    });
  });

  it('keeps foreign extension namespaces untouched', () => {
    const profile = buildEntryProfile({
      ...base, path: 'registry', domain: 'example.com', extensions: { 'com.example': { tier: 'gold' } },
    });
    expect(profile.extensions['com.example']).toEqual({ tier: 'gold' });
  });

  it('accepts a client identifier anchored to the registering domain', () => {
    const profile = buildEntryProfile({
      ...base, path: 'smb', domain: 'moonbakery.com', identifier: 'urn:air:MoonBakery.com:agent:catering',
    });
    expect(profile.identifier).toBe('urn:air:moonbakery.com:agent:catering');
  });

  it('rejects a client identifier anchored to someone else\'s domain', () => {
    expect(() => buildEntryProfile({
      ...base, path: 'smb', domain: 'moonbakery.com', identifier: 'urn:air:skyblue.com:agent:refunds',
    })).toThrow(EntryProfileError);
  });

  it('rejects a personal identifier that does not match the verified email', () => {
    expect(() => buildEntryProfile({
      ...base, path: 'personal', domain: null, contactEmail: 'john@hotmail.com',
      identifier: 'urn:air:host39.org:personal:someone-else',
    })).toThrow(EntryProfileError);
  });

  it('rejects the retired urn:ai: scheme', () => {
    expect(() => buildEntryProfile({
      ...base, path: 'registry', domain: 'example.com', identifier: 'urn:ai:domain:example.com',
    })).toThrow(EntryProfileError);
  });

  it('honours an explicit media type and publisher display name', () => {
    const profile = buildEntryProfile({
      ...base, path: 'smb', domain: 'tools.dev', mediaType: 'application/mcp-server-card+json',
      publisherDisplayName: 'Tools Inc',
    });
    expect(profile.mediaType).toBe('application/mcp-server-card+json');
    expect(profile.publisher.displayName).toBe('Tools Inc');
  });

  it('requires a domain for domain-anchored paths', () => {
    expect(() => buildEntryProfile({ ...base, path: 'smb', domain: null })).toThrow(EntryProfileError);
  });
});

describe('updateEntryProfile', () => {
  const current = buildEntryProfile({ ...base, orgId: 'refunds', path: 'dns-svcb', domain: 'skyblue.com' });

  it('re-anchors identifier, publisher and authoritativeSystem when the domain changes', () => {
    const next = updateEntryProfile(current, { domain: 'skyblue.aero' });
    expect(next.identifier).toBe('urn:air:skyblue.aero:agent:refunds');
    expect(next.publisher.identifier).toBe('skyblue.aero');
    expect(next.extensions[NANDA_EXTENSION]!.authoritativeSystem).toBe('skyblue.aero DNS');
  });

  it('replaces client extensions but never the server-owned role keys', () => {
    const next = updateEntryProfile(current, {
      extensions: { [NANDA_EXTENSION]: { resolutionRole: 'spoofed', 'auth.execution': 'oauth' } },
    });
    expect(next.extensions[NANDA_EXTENSION]).toEqual({
      resolutionRole: 'dns-svcb-pointer',
      preferredDiscovery: 'dns-svcb',
      authoritativeSystem: 'skyblue.com DNS',
      'auth.execution': 'oauth',
    });
  });

  it('updates only the publisher display name', () => {
    const next = updateEntryProfile(current, { publisherDisplayName: 'SkyBlue' });
    expect(next.publisher).toEqual({ identifier: 'skyblue.com', displayName: 'SkyBlue', identityType: 'dns' });
    expect(next.identifier).toBe(current.identifier);
  });

  it('does not mutate the current profile', () => {
    const snapshot = JSON.stringify(current);
    updateEntryProfile(current, { domain: 'other.com', publisherDisplayName: 'X' });
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});
