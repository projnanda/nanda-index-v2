import { describe, expect, it } from 'vitest';
import { newPasswordError } from './passwordRules';

describe('new password rules', () => {
  it.each(['a'.repeat(8), 'a'.repeat(72), 'é'.repeat(36), '🧪'.repeat(18)])(
    'accepts a password within the character and byte bounds (%s)',
    (password) => {
      expect(newPasswordError(password)).toBeNull();
    },
  );
  it.each(['a'.repeat(7), '🧪'.repeat(7)])('counts the minimum in characters (%s)', (password) => {
    expect(newPasswordError(password)).toContain('8');
  });
  it.each(['a'.repeat(73), 'é'.repeat(37), '🧪'.repeat(19)])(
    'counts the maximum in UTF-8 bytes (%s)',
    (password) => {
      expect(newPasswordError(password)).toContain('72');
    },
  );
});
