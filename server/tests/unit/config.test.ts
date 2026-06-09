import { describe, it, expect, afterEach, vi } from 'vitest';
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
    // JWT_SECRET must be set and long enough when NODE_ENV=production (JWT hardening)
    process.env.JWT_SECRET = 'a-secret-that-is-long-enough-for-production-use';
    process.env.SIGNING_KEY_ID = 'custom';
    process.env.DB_MAX_CONNECTIONS = '20';

    const cfg = buildConfig();
    expect(cfg.port).toBe(4000);
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.signing.keyId).toBe('custom');
    expect(cfg.db.maxConnections).toBe(20);

    delete process.env.JWT_SECRET;
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
});
