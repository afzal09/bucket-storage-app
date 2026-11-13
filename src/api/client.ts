import { ApiError } from './errors';
import { authorizationHeader, importSecret } from './sign';
import type {
  AccessKey,
  Bucket,
  ClientConfig,
  CompletedPart,
  CopyResult,
  CorsRule,
  DeleteResult,
  EncryptionConfig,
  LifecycleRule,
  ListObjectsResult,
  ListVersionsResult,
  ObjectRef,
  PartRow,
  PolicyRow,
  PolicyStatement,
  PutResult,
  StringMap,
  VersioningStatus,
} from './types';

type Query = Record<string, string | number | undefined>;

interface SendOptions {
  query?: Query;
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  unsigned?: boolean;
  signal?: AbortSignal;
}

export interface UploadOptions {
  query?: Query;
  headers?: Record<string, string>;
  body: Blob;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Browser client for the Object Storage Service HTTP contract.
 *
 * Notes that come straight from the contract:
 * - Successful JSON is returned directly (no envelope); errors are `{ error: { code, message, requestId } }`.
 * - The server's CORS setup exposes no custom response headers, so version IDs and ETags
 *   are always read from JSON bodies, never from headers.
 * - `Host` is signed but cannot be set from a browser; the browser sends the same host
 *   that we sign because requests go straight to the configured origin.
 */
export class StorageClient {
  readonly endpoint: URL;
  private readonly accessKeyId?: string;
  private readonly secretKey?: string;
  private keyPromise?: Promise<CryptoKey>;

  constructor(config: ClientConfig) {
    this.endpoint = parseEndpoint(config.endpoint);
    this.accessKeyId = config.accessKeyId || undefined;
    this.secretKey = config.secretKey || undefined;
  }

  get hasCredentials(): boolean {
    return Boolean(this.accessKeyId && this.secretKey);
  }

  // ---------------------------------------------------------------- auth

  readonly auth = {
    createAccessKey: (ownerId: string, signal?: AbortSignal): Promise<AccessKey> =>
      this.json('POST', '/auth/keys', { json: { ownerId }, unsigned: true, signal }),
    revokeAccessKey: (accessKeyId: string): Promise<void> =>
      this.empty('DELETE', `/auth/keys/${encodeURIComponent(accessKeyId)}`),
  };

  // ------------------------------------------------------------- buckets

  readonly buckets = {
    list: (signal?: AbortSignal): Promise<Bucket[]> => this.json('GET', '/', { signal }),
    create: (bucket: string, region: string): Promise<Bucket> =>
      this.json('PUT', bucketPath(bucket), { json: { region } }),
    delete: (bucket: string): Promise<void> => this.empty('DELETE', bucketPath(bucket)),

    getPolicy: (bucket: string): Promise<PolicyRow[]> =>
      this.json('GET', bucketPath(bucket), { query: { policy: '' } }),
    setPolicy: (bucket: string, statements: PolicyStatement[]): Promise<void> =>
      this.empty('PUT', bucketPath(bucket), { query: { policy: '' }, json: { statements } }),

    getVersioning: (bucket: string): Promise<{ status: VersioningStatus }> =>
      this.json('GET', bucketPath(bucket), { query: { versioning: '' } }),
    setVersioning: (bucket: string, status: 'ENABLED' | 'SUSPENDED'): Promise<Bucket> =>
      this.json('PUT', bucketPath(bucket), { query: { versioning: '' }, json: { status } }),

    getLifecycle: (bucket: string): Promise<{ rules: LifecycleRule[] }> =>
      this.json('GET', bucketPath(bucket), { query: { lifecycle: '' } }),
    setLifecycle: (bucket: string, rules: LifecycleRule[]): Promise<Bucket> =>
      this.json('PUT', bucketPath(bucket), { query: { lifecycle: '' }, json: rules }),

    getEncryption: (bucket: string): Promise<EncryptionConfig | Record<string, never>> =>
      this.json('GET', bucketPath(bucket), { query: { encryption: '' } }),
    setEncryption: (bucket: string, config: EncryptionConfig): Promise<Bucket> =>
      this.json('PUT', bucketPath(bucket), { query: { encryption: '' }, json: config }),

    getCors: (bucket: string): Promise<{ rules: CorsRule[] }> =>
      this.json('GET', bucketPath(bucket), { query: { cors: '' } }),
    setCors: (bucket: string, rules: CorsRule[]): Promise<Bucket> =>
      this.json('PUT', bucketPath(bucket), { query: { cors: '' }, json: rules }),
  };

  // ------------------------------------------------------------- objects

  readonly objects = {
    list: (
      bucket: string,
      opts: { prefix?: string; delimiter?: string; marker?: string; signal?: AbortSignal } = {},
    ): Promise<ListObjectsResult> =>
      // `maxKeys` is intentionally never sent: the contract says string values misbehave.
      this.json('GET', bucketPath(bucket), {
        query: { prefix: opts.prefix || undefined, delimiter: opts.delimiter, marker: opts.marker },
        signal: opts.signal,
      }),

    listVersions: (
      bucket: string,
      opts: { prefix?: string; signal?: AbortSignal } = {},
    ): Promise<ListVersionsResult> =>
      this.json('GET', bucketPath(bucket), {
        query: { versions: '', prefix: opts.prefix || undefined },
        signal: opts.signal,
      }),

    /** Ordinary upload for small files. Prefer `uploadXhr` when progress is needed. */
    put: (
      ref: ObjectRef,
      body: Blob,
      opts: { contentType?: string; userMetadata?: StringMap; signal?: AbortSignal } = {},
    ): Promise<PutResult> =>
      this.json('PUT', objectPath(ref), {
        body,
        headers: uploadHeaders(opts.contentType, opts.userMetadata),
        signal: opts.signal,
      }),

    /** Fetch the bytes of an object (latest, or a specific public version). */
    getBlob: async (
      ref: ObjectRef,
      opts: { versionId?: string; signal?: AbortSignal } = {},
    ): Promise<Blob> => {
      const response = await this.send('GET', objectPath(ref), {
        query: { versionId: opts.versionId },
        signal: opts.signal,
      });
      return response.blob();
    },

    delete: (ref: ObjectRef, versionId?: string): Promise<DeleteResult> =>
      this.json('DELETE', objectPath(ref), { query: { versionId } }),

    copy: (
      source: ObjectRef,
      destination: ObjectRef,
    ): Promise<CopyResult> => {
      // Source path parsing on the server is literal (not URL-decoded), so send it raw.
      objectPath(source);
      return this.json('PUT', objectPath(destination), {
        headers: { 'x-amz-copy-source': `/${source.bucket}/${source.key}` },
      });
    },

    getTags: (ref: ObjectRef): Promise<{ tags: StringMap }> =>
      this.json('GET', objectPath(ref), { query: { tagging: '' } }),
    setTags: (ref: ObjectRef, tags: StringMap): Promise<void> =>
      this.empty('POST', objectPath(ref), { query: { tagging: '' }, json: { tags } }),

    /**
     * Returns an absolute presigned URL. It can be used without an Authorization
     * header, but only with the exact method it was signed for and without extra
     * query parameters (so it cannot select a historical version).
     */
    presign: async (
      ref: ObjectRef,
      method: 'GET' | 'PUT' = 'GET',
      expiresIn = 3600,
    ): Promise<string> => {
      const result = await this.json<{ url: string }>('GET', objectPath(ref), {
        query: { presign: method, expiresIn },
      });
      const url = new URL(result.url, this.endpoint);
      if (url.origin !== this.endpoint.origin) {
        throw new Error('Server returned a presigned URL for a different origin');
      }
      return url.href;
    },
  };

  // ----------------------------------------------------------- multipart

  readonly multipart = {
    initiate: (ref: ObjectRef, contentType?: string): Promise<{ uploadId: string }> =>
      this.json('POST', objectPath(ref), {
        query: { uploads: '' },
        // application/json would be consumed by the JSON control middleware, so never
        // use it as a content-type selector here.
        headers: contentType && !contentType.includes('json') ? { 'content-type': contentType } : undefined,
      }),
    listParts: (ref: ObjectRef, uploadId: string): Promise<{ parts: PartRow[] }> =>
      this.json('GET', objectPath(ref), { query: { uploadId } }),
    complete: (ref: ObjectRef, uploadId: string, parts: CompletedPart[]): Promise<PutResult> => {
      if (!parts.length) throw new TypeError('parts must not be empty');
      return this.json('POST', objectPath(ref), { query: { uploadId }, json: { parts } });
    },
    abort: (ref: ObjectRef, uploadId: string): Promise<void> =>
      this.empty('DELETE', objectPath(ref), { query: { uploadId } }),
  };

  // ------------------------------------------------------- upload (XHR)

  /** Single-request upload with progress events (fetch has no upload progress). */
  async uploadXhr<T>(method: 'PUT', path: string, options: UploadOptions): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = { ...(options.headers ?? {}) };
    headers.authorization = await this.authorize(method, url);

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url.href);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
      };
      xhr.onerror = () => reject(networkError());
      xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(new ApiError('Server returned an unreadable response', xhr.status, 'BadResponse'));
          }
        } else {
          reject(parseFailure(xhr.status, xhr.statusText, xhr.responseText));
        }
      };
      const abort = () => xhr.abort();
      if (options.signal) {
        if (options.signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
        options.signal.addEventListener('abort', abort, { once: true });
      }
      xhr.send(options.body);
    });
  }

  uploadObject(
    ref: ObjectRef,
    body: Blob,
    opts: {
      contentType?: string;
      userMetadata?: StringMap;
      signal?: AbortSignal;
      onProgress?: (loaded: number, total: number) => void;
    },
  ): Promise<PutResult> {
    return this.uploadXhr<PutResult>('PUT', objectPath(ref), {
      body,
      headers: uploadHeaders(opts.contentType, opts.userMetadata),
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
  }

  uploadPart(
    ref: ObjectRef,
    uploadId: string,
    partNumber: number,
    body: Blob,
    opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<{ etag: string; size: number }> {
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new TypeError('partNumber must be a positive integer');
    }
    return this.uploadXhr('PUT', objectPath(ref), {
      query: { uploadId, partNumber },
      body,
      headers: { 'content-type': 'application/octet-stream' },
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
  }

  // ------------------------------------------------------------ plumbing

  private buildUrl(path: string, query?: Query): URL {
    const url = new URL(path, this.endpoint);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url;
  }

  private async authorize(method: string, url: URL): Promise<string> {
    if (!this.accessKeyId || !this.secretKey) {
      throw new ApiError('This operation requires an access key and secret.', 401, 'MissingCredentials');
    }
    this.keyPromise ??= importSecret(this.secretKey);
    return authorizationHeader(await this.keyPromise, this.accessKeyId, method, url);
  }

  private async send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers(options.headers);
    let body: BodyInit | undefined = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers.set('content-type', 'application/json');
    }
    if (!options.unsigned) headers.set('authorization', await this.authorize(method, url));

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body, signal: options.signal, redirect: 'manual' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw networkError();
    }
    if (!response.ok) {
      throw parseFailure(response.status, response.statusText, await response.text());
    }
    return response;
  }

  private async json<T>(method: string, path: string, options?: SendOptions): Promise<T> {
    const response = await this.send(method, path, options);
    return (await response.json()) as T;
  }

  private async empty(method: string, path: string, options?: SendOptions): Promise<void> {
    const response = await this.send(method, path, options);
    await response.arrayBuffer();
  }
}

// ---------------------------------------------------------------- helpers

export function parseEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError('Endpoint must be a full URL such as http://localhost:4000');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Endpoint must be an HTTP(S) origin with no path, query or credentials');
  }
  return url;
}

export function bucketPath(bucket: string): string {
  if (!bucket || bucket === '.' || bucket === '..' || bucket.includes('/')) {
    throw new TypeError('bucket must be a nonempty bucket name');
  }
  return `/${encodeURIComponent(bucket)}`;
}

export function objectPath(ref: ObjectRef): string {
  if (!ref.key || ref.key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('key must be nonempty and must not contain dot path segments');
  }
  return `${bucketPath(ref.bucket)}/${ref.key.split('/').map(encodeURIComponent).join('/')}`;
}

function uploadHeaders(contentType?: string, userMetadata: StringMap = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': contentType || 'application/octet-stream',
  };
  for (const [name, value] of Object.entries(userMetadata)) headers[`x-amz-meta-${name}`] = value;
  return headers;
}

function networkError(): ApiError {
  return new ApiError(
    'Could not reach the storage service. Check that it is running, the endpoint is correct, and that it allows requests from this origin (CORS).',
    0,
    'NetworkError',
  );
}

/** Request IDs come from the JSON error body: the server's CORS setup does not expose `x-request-id` to browsers. */
function parseFailure(status: number, statusText: string, text: string): ApiError {
  let details: { code?: unknown; message?: unknown; requestId?: unknown } | undefined;
  try {
    details = JSON.parse(text)?.error;
  } catch {
    /* HEAD responses and non-JSON failures fall back to the HTTP status. */
  }
  return new ApiError(
    typeof details?.message === 'string' ? details.message : `HTTP ${status} ${statusText}`.trim(),
    status,
    typeof details?.code === 'string' ? details.code : `HTTP_${status}`,
    typeof details?.requestId === 'string' ? details.requestId : undefined,
  );
}
