import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RankedOrganization } from '../../src/db/queries/organizations.js';
import { fanOutAgentSearch } from '../../src/services/registryFanout.js';
import {
  OutboundUrlError, pinnedLookup, publicUrlGuardWith, resolvePublicHttpUrl,
  type HostLookup,
} from '../../src/lib/outboundUrl.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: fetchMock,
}));

const transitionAddresses = [
  '64:ff9b::',
  '64:ff9b::ffff:ffff',
  '64:ff9b::127.0.0.1',
  '64:ff9b::a9fe:a9fe',
  '0064:FF9B:0000:0000:0000:0000:0A00:0001',
  '64:ff9b::808:808',
  '64:ff9b:1::',
  '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
  '64:ff9b:1::192.168.1.1',
  '2002::',
  '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  '2002:7f00:1::1',
  '2002:a9fe:a9fe::1',
  '2002:0808:0808::1',
  '2001::',
  '2001:0:ffff:ffff:ffff:ffff:ffff:ffff',
  '2001:0:4136:e378:8000:63bf:80ff:fffe',
  '2001:0:7f00:1:0:ffff:f7f7:f7f7',
];

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('IPv6 transition address SSRF guard', () => {
  it.each(transitionAddresses)('rejects literal %s before DNS or fetch', async (address) => {
    const lookup = vi.fn<HostLookup>();
    await expect(publicUrlGuardWith(lookup)(`https://[${address}]/card.json`)).rejects.toBeInstanceOf(OutboundUrlError);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(transitionAddresses)('rejects DNS answer %s before fetch', async (address) => {
    const lookup = vi.fn<HostLookup>().mockResolvedValue([address]);
    await expect(publicUrlGuardWith(lookup)('https://registry.example.org/catalog.json')).rejects.toBeInstanceOf(OutboundUrlError);
    expect(lookup).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['64:ff9b::a9fe:a9fe', '64:ff9b:1::a00:1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:80ff:fffe'])(
    'rejects mixed DNS answers containing %s in either order', async (address) => {
      for (const answers of [[address, '93.184.216.34', '2606:4700::1111'], ['2606:4700::1111', '93.184.216.34', address]]) {
        await expect(publicUrlGuardWith(async () => answers)('https://mixed.example.org'))
          .rejects.toBeInstanceOf(OutboundUrlError);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    '64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff',
    '64:ff9b::1:0:0',
    '64:ff9b:0:ffff:ffff:ffff:ffff:ffff',
    '64:ff9b:2::',
    '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:1::',
    '2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2003::',
  ])('does not extend a blocked subnet to adjacent address %s', async (address) => {
    await expect(resolvePublicHttpUrl(`https://[${address}]/`)).resolves.toHaveLength(1);
  });

  it('allows native public IPv4 and IPv6 and pins only the first validated DNS answer', async () => {
    const addresses = ['93.184.216.34', '2606:4700::1111'];
    const lookup = vi.fn<HostLookup>().mockResolvedValueOnce(addresses).mockResolvedValue(['64:ff9b::127.0.0.1']);
    const validated = await resolvePublicHttpUrl('https://registry.example.org', lookup);
    const connectLookup = pinnedLookup(validated);
    const pinned = await new Promise<unknown>((resolve, reject) => {
      connectLookup('registry.example.org', { all: true }, (error, result) => error ? reject(error) : resolve(result));
    });
    expect(pinned).toEqual([{ address: addresses[0], family: 4 }, { address: addresses[1], family: 6 }]);
    expect(lookup).toHaveBeenCalledOnce();
    for (const address of addresses) {
      const host = address.includes(':') ? `[${address}]` : address;
      await expect(resolvePublicHttpUrl(`https://${host}/`)).resolves.toEqual([address]);
    }
  });

  it.each(['https://registry.example.org', 'https://registry.example.org/.well-known/ai-catalog.json'])(
    'refuses transition DNS answers for a consumer fetching %s', async (registryUrl) => {
      const org: RankedOrganization = {
        id: 'transition-test', orgId: 'transition-test', displayName: 'Transition test',
        domain: 'registry.example.org', contactEmail: 'owner@example.org', registryUrl,
        emailVerified: true, verifyToken: null, verifyTokenExpiresAt: null,
        domainVerified: true, domainChallenge: null, domainChallengeExpiresAt: null,
        domainVerifiedAt: new Date(), everProven: true, ttlSeconds: 86400, status: 'active',
        createdAt: new Date(), updatedAt: new Date(), identifier: 'urn:air:registry.example.org:catalog:root',
        mediaType: 'application/ai-catalog+json', description: null, tags: [], publisher: null,
        extensions: {}, entryData: null, version: null, trustManifest: null,
        representativeQueries: [], moderation: 'none', rank: 1,
      };
      const globalFetch = vi.fn();
      vi.stubGlobal('fetch', globalFetch);
      for (const address of ['64:ff9b::a9fe:a9fe', '64:ff9b:1::a00:1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:80ff:fffe']) {
        const result = await fanOutAgentSearch([org], 'query', { urlGuard: publicUrlGuardWith(async () => [address]) });
        expect(result.unreachable).toEqual([org.orgId]);
        expect(result.candidates).toEqual([]);
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    },
  );
});
