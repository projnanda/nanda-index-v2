import { describe, it, expect, afterEach, vi } from 'vitest';
import { availableParallelism } from 'node:os';
import {
  requireEnv,
  optionalEnv,
  parsePositiveInt,
  buildConfig,
} from '../../src/config/index.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function mockExit() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return vi
    .spyOn(process, 'exit')
    .mockImplementation((_code?: string | number | null) => {
      throw new Error('__mock_exit__');
    });
}

describe('requireEnv', () => {
  it('returns the value when the var is set', () => {
    process.env.TEST_KEY = 'hello';
    expect(requireEnv('TEST_KEY')).toBe('hello');
  });

  it('exits with code 1 when the var is missing', () => {
    delete process.env.TEST_KEY;
    const exitSpy = mockExit();
    expect(() => requireEnv('TEST_KEY')).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when the var is blank/whitespace', () => {
    process.env.TEST_KEY = '   ';
    const exitSpy = mockExit();
    expect(() => requireEnv('TEST_KEY')).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('optionalEnv', () => {
  it('returns the value when set', () => {
    process.env.OPT_KEY = 'set';
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('set');
  });

  it('returns the fallback when unset', () => {
    delete process.env.OPT_KEY;
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when blank', () => {
    process.env.OPT_KEY = '   ';
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('fallback');
  });
});

describe('parsePositiveInt', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('KEY', '42')).toBe(42);
  });

  it.each([['0'], ['-5'], ['abc'], ['3.14'], ['']])(
    'exits on invalid input: "%s"',
    (raw) => {
      const exitSpy = mockExit();
      expect(() => parsePositiveInt('KEY', raw)).toThrow('__mock_exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
    },
  );
});

describe('buildConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';
    delete process.env.SIGNING_PRIVATE_KEY;
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.SIGNING_KEY_ID;
    delete process.env.DB_MAX_CONNECTIONS;

    const cfg = buildConfig();
    expect(cfg.port).toBe(3001);  // default changed from 3000 in v2
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.db.url).toBe('postgresql://u:p@localhost/db');
    expect(cfg.db.maxConnections).toBe(10);
    expect(cfg.signing.privateKey).toBeUndefined();  // optional in v2
    expect(cfg.signing.keyId).toBe('garr-dev-unspecified');
  });

  it('applies overrides from env', () => {
    process.env.DATABASE_URL = 'x';
    process.env.PORT = '4000';
    process.env.NODE_ENV = 'production';
    // JWT_SECRET and COOKIE_SECRET must be set in production (auth hardening)
    process.env.JWT_SECRET = 'a-secret-that-is-long-enough-for-production-use';
    process.env.COOKIE_SECRET = 'a-production-cookie-secret-of-32-plus-chars';
    process.env.SMTP_URL = 're_production_key';
    process.env.SIGNING_KEY_ID = 'custom';
    process.env.DB_MAX_CONNECTIONS = '20';

    const cfg = buildConfig();
    expect(cfg.port).toBe(4000);
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.signing.keyId).toBe('custom');
    expect(cfg.db.maxConnections).toBe(20);

    delete process.env.JWT_SECRET;
    delete process.env.COOKIE_SECRET;
  });

  it('exits in production when COOKIE_SECRET is shorter than 32 characters', () => {
    process.env.DATABASE_URL = 'x';
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-secret-that-is-long-enough-for-production-use';
    process.env.COOKIE_SECRET = 'x'.repeat(31);
    const exitSpy = mockExit();

    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts a short COOKIE_SECRET outside production', () => {
    process.env.DATABASE_URL = 'x';
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECRET = 'short';

    expect(buildConfig().cookie.secret).toBe('short');
  });

  it('exits when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reads OAuth config from env', () => {
    process.env.DATABASE_URL = 'x';
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
    process.env.JWT_SECRET = 'mysecret';

    const cfg = buildConfig();
    expect(cfg.oauth.googleClientId).toBe('gid');
    expect(cfg.oauth.googleClientSecret).toBe('gsecret');
    expect(cfg.jwt.secret).toBe('mysecret');
  });

  it('defaults SMTP_URL to "log"', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.SMTP_URL;

    const cfg = buildConfig();
    expect(cfg.email.smtpUrl).toBe('log');
  });

  it('reads community recipients from server environment and ignores empty CC entries', () => {
    process.env.DATABASE_URL = 'x';
    process.env.COMMUNITY_CONTACT_EMAIL = ' contact@example.org ';
    process.env.COMMUNITY_CONTACT_CC = ' reviewer-one@example.org, , reviewer-two@example.org, ';
    expect(buildConfig().email).toMatchObject({
      communityTo: 'contact@example.org',
      communityCc: ['reviewer-one@example.org', 'reviewer-two@example.org'],
    });
  });

  it('leaves community recipients unset until an operator configures them', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.COMMUNITY_CONTACT_EMAIL;
    delete process.env.COMMUNITY_CONTACT_CC;
    expect(buildConfig().email).toMatchObject({ communityTo: '', communityCc: [] });
  });

  it('applies cookie + auth defaults', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECRET;
    delete process.env.AUTH_RATE_LIMIT_MAX;
    delete process.env.AUTH_MAX_LOGIN_ATTEMPTS;
    delete process.env.AUTH_LOCKOUT_MINUTES;
    delete process.env.AUTH_RESET_TOKEN_TTL_MINUTES;
    delete process.env.AUTH_UNVERIFIED_RECLAIM_HOURS;

    const cfg = buildConfig();
    expect(cfg.cookie.secret).toBe('dev-cookie-secret-change-in-production');
    expect(cfg.auth.rateLimitMax).toBe(10);
    expect(cfg.auth.rateLimitWindow).toBe('1 minute');
    expect(cfg.auth.maxLoginAttempts).toBe(5);
    expect(cfg.auth.lockoutMinutes).toBe(15);
    expect(cfg.auth.resetTokenTtlMinutes).toBe(60);
    expect(cfg.auth.unverifiedReclaimHours).toBe(48);
  });

  it('throttles domain verification per IP by default, overridable from env', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.DOMAIN_VERIFY_RATE_LIMIT_MAX;
    delete process.env.DOMAIN_VERIFY_RATE_LIMIT_WINDOW;
    expect(buildConfig().claims).toMatchObject({ domainVerifyRateLimitMax: 20, domainVerifyRateLimitWindow: '10 minutes' });

    process.env.DOMAIN_VERIFY_RATE_LIMIT_MAX = '5';
    process.env.DOMAIN_VERIFY_RATE_LIMIT_WINDOW = '1 hour';
    expect(buildConfig().claims).toMatchObject({ domainVerifyRateLimitMax: 5, domainVerifyRateLimitWindow: '1 hour' });
  });

  it('caps concurrent password hashes at CPU count minus one (min 1), overridable from env', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.AUTH_MAX_CONCURRENT_HASHES;
    // availableParallelism() sees the host's cores, not a container's CPU cap,
    // which is why the env override exists.
    expect(buildConfig().auth.maxConcurrentHashes).toBe(Math.max(1, availableParallelism() - 1));

    process.env.AUTH_MAX_CONCURRENT_HASHES = '3';
    expect(buildConfig().auth.maxConcurrentHashes).toBe(3);
  });

  it('defaults JWT lifetime to 1 day', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.JWT_EXPIRES_IN;

    expect(buildConfig().jwt.expiresIn).toBe('1d');
  });

  it('does not trust proxy headers unless TRUST_PROXY_HOPS is set', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.TRUST_PROXY_HOPS;
    expect(buildConfig().trustProxyHops).toBe(0);

    process.env.TRUST_PROXY_HOPS = '1';
    expect(buildConfig().trustProxyHops).toBe(1);
  });

  it('caches index counts and facets for 60 seconds unless INDEX_STATS_CACHE_SECONDS says otherwise', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.INDEX_STATS_CACHE_SECONDS;
    expect(buildConfig().indexStatsCacheSeconds).toBe(60);

    process.env.INDEX_STATS_CACHE_SECONDS = '0';
    expect(buildConfig().indexStatsCacheSeconds).toBe(0);
  });

  it('exits on a negative INDEX_STATS_CACHE_SECONDS', () => {
    process.env.DATABASE_URL = 'x';
    process.env.INDEX_STATS_CACHE_SECONDS = '-5';
    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('leaves server-side analytics off unless POSTHOG_API_KEY is set', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;

    expect(buildConfig().analytics).toEqual({
      posthogApiKey: undefined,
      posthogHost: 'https://us.i.posthog.com',
    });
  });

  it('reads the PostHog key and host from env', () => {
    process.env.DATABASE_URL = 'x';
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';

    expect(buildConfig().analytics).toEqual({
      posthogApiKey: 'phc_test',
      posthogHost: 'https://eu.i.posthog.com',
    });
  });

  it('exits on a non-integer TRUST_PROXY_HOPS', () => {
    process.env.DATABASE_URL = 'x';
    process.env.TRUST_PROXY_HOPS = 'yes';
    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reads auth overrides from env', () => {
    process.env.DATABASE_URL = 'x';
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = '7';
    process.env.AUTH_RATE_LIMIT_MAX = '25';

    const cfg = buildConfig();
    expect(cfg.auth.maxLoginAttempts).toBe(7);
    expect(cfg.auth.rateLimitMax).toBe(25);
  });

  it('exits when COOKIE_SECRET is left as the dev default in production', () => {
    process.env.DATABASE_URL = 'x';
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-secret-that-is-long-enough-for-production-use';
    delete process.env.COOKIE_SECRET;

    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);

    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  describe('email delivery in production', () => {
    function productionEnv() {
      process.env.DATABASE_URL = 'x';
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a-secret-that-is-long-enough-for-production-use';
      process.env.COOKIE_SECRET = 'a-production-cookie-secret-of-32-plus-chars';
    }

    // 'log' prints live reset and verification links to stdout (docker logs).
    it.each([['log'], [undefined], ['   ']])('exits when SMTP_URL is %j', (smtpUrl) => {
      productionEnv();
      if (smtpUrl === undefined) delete process.env.SMTP_URL;
      else process.env.SMTP_URL = smtpUrl;
      delete process.env.ALLOW_EMAIL_LOG_IN_PRODUCTION;

      const exitSpy = mockExit();
      expect(() => buildConfig()).toThrow('__mock_exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('starts with a real SMTP_URL (Resend API key)', () => {
      productionEnv();
      process.env.SMTP_URL = 're_production_key';
      expect(buildConfig().email.smtpUrl).toBe('re_production_key');
    });

    it('starts in log mode only with the explicit override', () => {
      productionEnv();
      process.env.SMTP_URL = 'log';
      process.env.ALLOW_EMAIL_LOG_IN_PRODUCTION = 'true';
      expect(buildConfig().email.smtpUrl).toBe('log');
    });

    it('does not treat a non-"true" override as consent', () => {
      productionEnv();
      process.env.SMTP_URL = 'log';
      process.env.ALLOW_EMAIL_LOG_IN_PRODUCTION = '1';
      const exitSpy = mockExit();
      expect(() => buildConfig()).toThrow('__mock_exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('keeps log mode as the default outside production', () => {
      process.env.DATABASE_URL = 'x';
      delete process.env.NODE_ENV;
      delete process.env.SMTP_URL;
      expect(buildConfig().email.smtpUrl).toBe('log');
    });
  });
});
