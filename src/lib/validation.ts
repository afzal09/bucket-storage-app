/** Client-side checks mirroring the rules in the API contract. Return an error message or null. */

export function validateBucketName(name: string): string | null {
  if (name.length < 3 || name.length > 63) return 'Must be between 3 and 63 characters.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return 'Use only lowercase letters, numbers and hyphens, starting and ending with a letter or number.';
  }
  return null;
}

export function validateObjectKey(key: string): string | null {
  if (!key) return 'Key is required.';
  if (key.startsWith('/')) return 'Key must not start with “/”.';
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'Key must not contain “.” or “..” path segments.';
  }
  return null;
}

/** The contract only guarantees simple ASCII keys; warn (don't block) on anything else. */
export function nonAsciiWarning(key: string): string | null {
  // eslint-disable-next-line no-control-regex
  return /[^\x20-\x7e]/.test(key)
    ? 'Non-ASCII characters in keys are not guaranteed to work with this service.'
    : null;
}

export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
