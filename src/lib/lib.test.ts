import { describe, expect, it } from 'vitest';
import { baseName, formatBytes, toNumber } from './format';
import { mapToPairs, pairsToMap, validateMetadata } from './pairs';
import { nonAsciiWarning, normalizePrefix, validateBucketName, validateObjectKey } from './validation';

describe('validateBucketName', () => {
  it.each(['abc', 'my-bucket-1', 'a'.repeat(63)])('accepts %s', (name) => {
    expect(validateBucketName(name)).toBeNull();
  });

  it.each(['ab', 'a'.repeat(64), 'Upper', 'has.dot', '-lead', 'trail-', 'under_score', 'sp ace'])(
    'rejects %s',
    (name) => {
      expect(validateBucketName(name)).not.toBeNull();
    },
  );
});

describe('validateObjectKey', () => {
  it('accepts nested keys', () => {
    expect(validateObjectKey('a/b/c.txt')).toBeNull();
  });

  it.each(['', '/lead', 'a/../b', './x', 'a/./b'])('rejects %j', (key) => {
    expect(validateObjectKey(key)).not.toBeNull();
  });

  it('warns on non-ASCII keys without rejecting them', () => {
    expect(nonAsciiWarning('café.txt')).not.toBeNull();
    expect(nonAsciiWarning('cafe.txt')).toBeNull();
    expect(validateObjectKey('café.txt')).toBeNull();
  });
});

describe('normalizePrefix', () => {
  it('adds a trailing slash and strips leading ones', () => {
    expect(normalizePrefix('docs')).toBe('docs/');
    expect(normalizePrefix('/docs/')).toBe('docs/');
    expect(normalizePrefix('')).toBe('');
    expect(normalizePrefix('///')).toBe('');
  });
});

describe('formatting', () => {
  it('formats byte sizes from numbers and BIGINT strings', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes('1023')).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes('9437184')).toBe('9.0 MB');
    expect(formatBytes(undefined)).toBe('—');
    expect(toNumber('42')).toBe(42);
  });

  it('extracts the last path segment of keys and folder prefixes', () => {
    expect(baseName('a/b/c.txt')).toBe('c.txt');
    expect(baseName('a/b/')).toBe('b');
    expect(baseName('plain')).toBe('plain');
  });
});

describe('pairs', () => {
  it('drops blank rows, trims names and lets later duplicates win', () => {
    expect(
      pairsToMap([
        { key: ' team ', value: 'a' },
        { key: '', value: 'ignored' },
        { key: 'team', value: 'b' },
      ]),
    ).toEqual({ team: 'b' });
  });

  it('round-trips maps', () => {
    expect(pairsToMap(mapToPairs({ a: '1', b: '2' }))).toEqual({ a: '1', b: '2' });
    expect(mapToPairs(undefined)).toEqual([]);
  });

  it('validates metadata names and values for header safety', () => {
    expect(validateMetadata([{ key: 'project', value: 'demo' }])).toBeNull();
    expect(validateMetadata([{ key: '', value: '' }])).toBeNull();
    expect(validateMetadata([{ key: 'bad name', value: 'x' }])).toMatch(/letters, numbers and hyphens/);
    expect(validateMetadata([{ key: 'ok', value: 'café' }])).toMatch(/ASCII/);
  });
});
