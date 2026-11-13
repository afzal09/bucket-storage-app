import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StorageClient, objectPath, parseEndpoint } from './client';
import { ApiError } from './errors';
import { authorizationHeader, canonicalRequest, importSecret } from './sign';

/** Reference implementation lifted from the service's SDK (packages/sdk/src/client.ts). */
function referenceAuthorization(secret: string, id: string, method: string, url: URL): string {
  const query = Object.fromEntries(url.searchParams);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${name}=${query[name]}`)
    .join('&');
  const canonical = [method, url.pathname, canonicalQuery, `host:${url.host}`, 'host'].join('\n');
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  return `OSS-HMAC-SHA256 Credential=${id}, SignedHeaders=host, Signature=${signature}`;
}

describe('request signing', () => {
  const secret = 'synthetic-example-save-the-real-secret';
  const id = 'AKIA0123456789ABCDEF';

  it.each([
    ['GET', 'http://localhost:4000/'],
    ['PUT', 'http://localhost:4000/demo-assets?policy='],
    ['GET', 'http://localhost:4000/demo-assets?prefix=public%2F&delimiter=%2F'],
    ['PUT', 'http://localhost:4000/demo-assets/public/hello.txt?uploadId=abc&partNumber=2'],
    ['DELETE', 'http://localhost:4000/demo-assets/a%20b/c%26d.txt?versionId=v1'],
  ])('matches the service SDK for %s %s', async (method, href) => {
    const url = new URL(href);
    const key = await importSecret(secret);
    expect(await authorizationHeader(key, id, method, url)).toBe(
      referenceAuthorization(secret, id, method, url),
    );
  });

  it('sorts query parameters and keeps empty flags', () => {
    const url = new URL('http://localhost:4000/b?versions=&prefix=a');
    expect(canonicalRequest('get', url)).toBe('GET\n/b\nprefix=a&versions=\nhost:localhost:4000\nhost');
  });
});

describe('paths and endpoints', () => {
  it('encodes each key segment but keeps slashes', () => {
    expect(objectPath({ bucket: 'my-bucket', key: 'dir one/file #1.txt' })).toBe(
      '/my-bucket/dir%20one/file%20%231.txt',
    );
  });

  it('rejects dot segments and empty keys', () => {
    expect(() => objectPath({ bucket: 'b', key: 'a/../b' })).toThrow(TypeError);
    expect(() => objectPath({ bucket: 'b', key: '' })).toThrow(TypeError);
  });

  it('only accepts bare HTTP(S) origins', () => {
    expect(parseEndpoint('http://localhost:4000').origin).toBe('http://localhost:4000');
    expect(() => parseEndpoint('http://localhost:4000/api')).toThrow(TypeError);
    expect(() => parseEndpoint('ftp://localhost')).toThrow(TypeError);
    expect(() => parseEndpoint('nonsense')).toThrow(TypeError);
  });
});

describe('StorageClient requests', () => {
  const config = {
    endpoint: 'http://localhost:4000',
    accessKeyId: 'AKIA0123456789ABCDEF',
    secretKey: 'secret',
  };

  function mockFetch(response: Response) {
    const spy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('signs requests and never sends a host header from the browser side', async () => {
    const spy = mockFetch(Response.json([]));
    await new StorageClient(config).buckets.list();
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(url.href).toBe('http://localhost:4000/');
    expect(headers.get('authorization')).toBe(
      referenceAuthorization('secret', config.accessKeyId, 'GET', url),
    );
    expect(headers.has('host')).toBe(false);
  });

  it('creates access keys without signing', async () => {
    const spy = mockFetch(Response.json({ accessKeyId: 'AKIA1', secretKey: 's' }, { status: 201 }));
    const key = await new StorageClient({ endpoint: config.endpoint }).auth.createAccessKey('owner');
    expect(key.accessKeyId).toBe('AKIA1');
    const [, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.body).toBe('{"ownerId":"owner"}');
  });

  it('sends bucket subresource flags as empty query values', async () => {
    const spy = mockFetch(Response.json({ status: 'DISABLED' }));
    await new StorageClient(config).buckets.getVersioning('demo');
    expect((spy.mock.calls[0][0] as URL).search).toBe('?versioning=');
  });

  it('sends lifecycle and CORS rules as bare arrays', async () => {
    const spy = mockFetch(Response.json({}));
    await new StorageClient(config).buckets.setCors('demo', [
      { allowedOrigins: ['*'], allowedMethods: ['GET'] },
    ]);
    expect((spy.mock.calls[0][1] as RequestInit).body).toBe(
      '[{"allowedOrigins":["*"],"allowedMethods":["GET"]}]',
    );
  });

  it('never sends maxKeys when listing objects', async () => {
    const spy = mockFetch(Response.json({ bucket: 'demo', isTruncated: false, contents: [], commonPrefixes: [] }));
    await new StorageClient(config).objects.list('demo', { prefix: 'a/', delimiter: '/' });
    const url = spy.mock.calls[0][0] as URL;
    expect(url.searchParams.get('prefix')).toBe('a/');
    expect(url.searchParams.has('maxKeys')).toBe(false);
  });

  it('turns the contract error shape into ApiError', async () => {
    mockFetch(
      Response.json(
        { error: { code: 'NoSuchBucket', message: 'The specified bucket does not exist: x', requestId: 'r1' } },
        { status: 404 },
      ),
    );
    const error = await new StorageClient(config).buckets.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NoSuchBucket', requestId: 'r1' });
  });

  it('resolves presigned URLs against the endpoint and rejects foreign origins', async () => {
    mockFetch(Response.json({ url: '/b/k.txt?method=GET&expires=1&ownerId=o&accessKeyId=a&signature=s' }));
    const url = await new StorageClient(config).objects.presign({ bucket: 'b', key: 'k.txt' });
    expect(url).toBe('http://localhost:4000/b/k.txt?method=GET&expires=1&ownerId=o&accessKeyId=a&signature=s');

    mockFetch(Response.json({ url: 'https://evil.example/b/k.txt?signature=s' }));
    await expect(new StorageClient(config).objects.presign({ bucket: 'b', key: 'k.txt' })).rejects.toThrow(
      /different origin/,
    );
  });

  it('does not use application/json as a multipart content-type selector', async () => {
    const spy = mockFetch(Response.json({ uploadId: 'u' }, { status: 201 }));
    await new StorageClient(config).multipart.initiate({ bucket: 'b', key: 'k.json' }, 'application/json');
    expect(new Headers((spy.mock.calls[0][1] as RequestInit).headers).has('content-type')).toBe(false);
  });
});
