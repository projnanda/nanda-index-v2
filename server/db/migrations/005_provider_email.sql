-- Allow provider='email' for username/password accounts.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS provider_values,
  ADD CONSTRAINT provider_values CHECK (provider IN ('google', 'github', 'email'));
