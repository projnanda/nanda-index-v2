import type { FastifySchemaValidationError } from 'fastify';

/**
 * Schema-validation error text and field extraction.
 *
 * Fastify's default formatter writes `${dataVar}${instancePath} ${message}`,
 * which is kept so clients that parse the leading path (web
 * org-validation.ts) still work. Only ajv's "must be equal to constant",
 * which hides the one value a confirmation field accepts (DELETE /api/v1/me's
 * `confirmation: "DELETE"`), is rewritten to name it. Enum failures keep the
 * generic text: an enum can map out an operator API (see
 * auth-before-validation.test.ts), a single confirmation constant cannot.
 */

const SEPARATOR = ', ';

function describe(error: FastifySchemaValidationError): string {
  const { params } = error;
  if (error.keyword === 'const') return `must be equal to ${JSON.stringify(params.allowedValue)}`;
  return error.message ?? 'is invalid';
}

/** Fastify `schemaErrorFormatter`: one line per failure, prefixed by its path. */
export function formatSchemaErrors(errors: FastifySchemaValidationError[], dataVar: string): Error {
  const text = errors
    .map((error) => `${dataVar}${error.instancePath} ${describe(error)}`)
    .join(SEPARATOR);
  return new Error(text);
}

/**
 * The request property the first failure is about, as a `/`-separated path
 * relative to the validated part (`email`, `tags/0`); undefined when the
 * failure is about the whole object.
 */
export function validationField(errors: readonly FastifySchemaValidationError[] | undefined): string | undefined {
  const first = errors?.[0];
  if (!first) return undefined;
  const { params } = first;
  const missing = first.keyword === 'required' && typeof params.missingProperty === 'string'
    ? `/${params.missingProperty}`
    : '';
  const path = `${first.instancePath}${missing}`.replace(/^\//, '');
  return path || undefined;
}
