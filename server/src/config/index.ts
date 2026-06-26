/**
 * Reads a required env var.
 * Prints FATAL to stderr and exits with code 1 if the variable is
 * missing or blank. Intentional: the server must never bind to a
 * port with incomplete config (CLAUDE.md §332–357).
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    console.error(`FATAL: missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

/**
 * Reads an optional env var, returning `fallback` when unset or blank.
 */
export function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') return fallback;
  return value;
}

/**
 * Parses a string into a positive integer (> 0).
 * FATAL + exit(1) on invalid input — same rationale as requireEnv.
 */
export function parsePositiveInt(key: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(
      `FATAL: env var ${key} must be a positive integer (got "${raw}")`,
    );
    process.exit(1);
  }
  return n;
}

export interface DbConfig {
  readonly url: string;
  readonly maxConnections: number;
}

export interface OAuthConfig {
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly callbackBaseUrl: string;
}

export interface JwtConfig {
  readonly secret: string;
  readonly expiresIn: string;
}

export interface EmailConfig {
  readonly smtpUrl: string;
  readonly fromAddress: string;
}

export interface CookieConfig {
  readonly secret: string;
}

export interface AuthConfig {
  /** Max requests per window allowed on auth mutation routes (per IP). */
  readonly rateLimitMax: number;
  /** Rate-limit window, e.g. '1 minute' (see @fastify/rate-limit). */
  readonly rateLimitWindow: string;
  /** Failed logins before an account is temporarily locked. */
  readonly maxLoginAttempts: number;
  /** How long an account stays locked after hitting the threshold. */
  readonly lockoutMinutes: number;
  /** Lifetime of a password-reset token. */
  readonly resetTokenTtlMinutes: number;
}

export interface SigningConfig {
  readonly privateKey: string | undefined;
  readonly keyId: string;
}

export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  readonly db: DbConfig;
  readonly oauth: OAuthConfig;
  readonly jwt: JwtConfig;
  readonly email: EmailConfig;
  readonly cookie: CookieConfig;
  readonly auth: AuthConfig;
  readonly frontendUrl: string;
  readonly signing: SigningConfig;
}

/**
 * Builds the fully-typed config object from process.env.
 * Called once at server startup; the return value is the single
 * source of truth for env-driven config. Terminates the process
 * with code 1 if any required variable is missing or invalid.
 */
const DEV_JWT_SECRET = 'dev-secret-change-in-production';
const DEV_COOKIE_SECRET = 'dev-cookie-secret-change-in-production';
const MIN_JWT_SECRET_LENGTH = 32;

export function buildConfig(): Config {
  const rawSigningKey = process.env['SIGNING_PRIVATE_KEY'];
  const nodeEnv = optionalEnv('NODE_ENV', 'development');
  const jwtSecret = optionalEnv('JWT_SECRET', DEV_JWT_SECRET);
  const cookieSecret = optionalEnv('COOKIE_SECRET', DEV_COOKIE_SECRET);

  // Refuse to start in production with a weak or default JWT secret
  if (nodeEnv === 'production') {
    if (jwtSecret === DEV_JWT_SECRET) {
      console.error('FATAL: JWT_SECRET must be set in production — do not use the default dev secret');
      process.exit(1);
    }
    if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      console.error(`FATAL: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`);
      process.exit(1);
    }
    if (cookieSecret === DEV_COOKIE_SECRET) {
      console.error('FATAL: COOKIE_SECRET must be set in production — do not use the default dev secret');
      process.exit(1);
    }
  }

  return {
    port: parsePositiveInt('PORT', optionalEnv('PORT', '3001')),
    nodeEnv,
    db: {
      url: requireEnv('DATABASE_URL'),
      maxConnections: parsePositiveInt(
        'DB_MAX_CONNECTIONS',
        optionalEnv('DB_MAX_CONNECTIONS', '10'),
      ),
    },
    oauth: {
      googleClientId:     optionalEnv('GOOGLE_CLIENT_ID', ''),
      googleClientSecret: optionalEnv('GOOGLE_CLIENT_SECRET', ''),
      githubClientId:     optionalEnv('GITHUB_CLIENT_ID', ''),
      githubClientSecret: optionalEnv('GITHUB_CLIENT_SECRET', ''),
      callbackBaseUrl:    optionalEnv('OAUTH_CALLBACK_BASE_URL', 'http://localhost:3001'),
    },
    jwt: {
      secret:    jwtSecret,
      expiresIn: optionalEnv('JWT_EXPIRES_IN', '7d'),
    },
    email: {
      smtpUrl:     optionalEnv('SMTP_URL', 'log'),
      fromAddress: optionalEnv('EMAIL_FROM', 'noreply@nanda.local'),
    },
    cookie: {
      secret: cookieSecret,
    },
    auth: {
      rateLimitMax: parsePositiveInt(
        'AUTH_RATE_LIMIT_MAX', optionalEnv('AUTH_RATE_LIMIT_MAX', '10'),
      ),
      rateLimitWindow: optionalEnv('AUTH_RATE_LIMIT_WINDOW', '1 minute'),
      maxLoginAttempts: parsePositiveInt(
        'AUTH_MAX_LOGIN_ATTEMPTS', optionalEnv('AUTH_MAX_LOGIN_ATTEMPTS', '5'),
      ),
      lockoutMinutes: parsePositiveInt(
        'AUTH_LOCKOUT_MINUTES', optionalEnv('AUTH_LOCKOUT_MINUTES', '15'),
      ),
      resetTokenTtlMinutes: parsePositiveInt(
        'AUTH_RESET_TOKEN_TTL_MINUTES', optionalEnv('AUTH_RESET_TOKEN_TTL_MINUTES', '60'),
      ),
    },
    frontendUrl: optionalEnv('FRONTEND_URL', 'http://localhost:3000'),
    signing: {
      privateKey: rawSigningKey ? rawSigningKey.replace(/\\n/g, '\n') : undefined,
      keyId:      optionalEnv('SIGNING_KEY_ID', 'garr-dev-unspecified'),
    },
  };
}
