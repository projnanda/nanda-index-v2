import type { FastifyError, FastifySchemaValidationError } from 'fastify';
import { describe, expect, it } from 'vitest';
import { formatSchemaErrors, validationField } from '../../src/lib/validationErrors.js';
import { toApiError } from '../../src/plugins/errorHandler.js';

const failure = (
  keyword: string,
  instancePath: string,
  params: Record<string, unknown>,
  message?: string,
): FastifySchemaValidationError => ({ keyword, instancePath, schemaPath: '#', params, message });

describe('formatSchemaErrors', () => {
  it('keeps the default path-prefixed text for ordinary failures', () => {
    const errors = [
      failure('required', '', { missingProperty: 'email' }, "must have required property 'email'"),
      failure('maxLength', '/name', { limit: 3 }, 'must NOT have more than 3 characters'),
    ];
    expect(formatSchemaErrors(errors, 'body').message).toBe(
      "body must have required property 'email', body/name must NOT have more than 3 characters",
    );
  });

  it('names the expected value of a const failure', () => {
    const errors = [failure('const', '/confirmation', { allowedValue: 'DELETE' }, 'must be equal to constant')];
    expect(formatSchemaErrors(errors, 'body').message).toBe('body/confirmation must be equal to "DELETE"');
  });

  it('keeps the generic text for enum failures', () => {
    const errors = [failure('enum', '/role', { allowedValues: ['a', 'b'] }, 'must be equal to one of the allowed values')];
    expect(formatSchemaErrors(errors, 'body').message).toBe('body/role must be equal to one of the allowed values');
  });
});

describe('validationField', () => {
  it('returns undefined without validation errors', () => {
    expect(validationField(undefined)).toBeUndefined();
    expect(validationField([])).toBeUndefined();
  });

  it('names the missing property of a required failure, nested or not', () => {
    expect(validationField([failure('required', '', { missingProperty: 'email' })])).toBe('email');
    expect(validationField([failure('required', '/publisher', { missingProperty: 'name' })])).toBe('publisher/name');
  });

  it('uses the instance path of other failures and ignores whole-object ones', () => {
    expect(validationField([failure('maxLength', '/tags/0', {})])).toBe('tags/0');
    expect(validationField([failure('type', '', {})])).toBeUndefined();
  });
});

describe('toApiError', () => {
  const error = (props: Partial<FastifyError>): FastifyError =>
    Object.assign(new Error(props.message ?? ''), props) as FastifyError;

  it('never exposes the message of a 5xx', () => {
    expect(toApiError(error({ message: 'db password wrong' }), 500)).toEqual({ error: 'internal_server_error' });
  });

  it('keeps an error code and adds the validation field', () => {
    const validation = [failure('required', '', { missingProperty: 'email' })];
    expect(toApiError(error({ code: 'FST_ERR_VALIDATION', message: 'm', validation }), 400)).toEqual({
      error: 'FST_ERR_VALIDATION', detail: 'm', field: 'email',
    });
  });

  it('falls back to a status code name instead of the message when the error has no code', () => {
    expect(toApiError(error({ message: 'slow down' }), 429)).toEqual({ error: 'RATE_LIMITED', detail: 'slow down' });
    expect(toApiError(error({ message: 'teapot' }), 418)).toEqual({ error: 'ERROR', detail: 'teapot' });
  });
});
