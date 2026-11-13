/**
 * End-to-end check of the browser client against a running service.
 *
 *   OSS_LIVE_ENDPOINT=http://localhost:4000 npm test
 *
 * Skipped unless OSS_LIVE_ENDPOINT is set. Creates a uniquely named bucket and removes it afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageClient } from './client';
import { ApiError } from './errors';

const endpoint = process.env.OSS_LIVE_ENDPOINT;

describe.skipIf(!endpoint)('live service', () => {
  const suffix = Date.now().toString(36);
  const owner = `app-test-${suffix}`;
  const bucket = `app-test-${suffix}`;
  let client: StorageClient;
  let accessKeyId = '';

  beforeAll(async () => {
    const key = await new StorageClient({ endpoint: endpoint! }).auth.createAccessKey(owner);
    accessKeyId = key.accessKeyId;
    client = new StorageClient({ endpoint: endpoint!, ...key });
  });

  afterAll(async () => {
    const versions = await client.objects.listVersions(bucket).catch(() => undefined);
    for (const v of versions?.versions ?? []) {
      await client.objects.delete({ bucket, key: v.key }, v.versionId).catch(() => undefined);
    }
    await client.buckets.delete(bucket).catch(() => undefined);
    await client.auth.revokeAccessKey(accessKeyId).catch(() => undefined);
  });

  it('rejects bad credentials with a 401 ApiError', async () => {
    const bad = new StorageClient({ endpoint: endpoint!, accessKeyId, secretKey: 'wrong' });
    await expect(bad.buckets.list()).rejects.toMatchObject({ status: 401, code: 'SignatureDoesNotMatch' });
  });

  it('creates and lists a bucket', async () => {
    const created = await client.buckets.create(bucket, 'us-east-1');
    expect(created).toMatchObject({ name: bucket, ownerId: owner, versioningStatus: 'DISABLED' });
    expect((await client.buckets.list()).map((b) => b.name)).toContain(bucket);
    await expect(client.buckets.create(bucket, 'us-east-1')).rejects.toMatchObject({
      status: 409,
      code: 'BucketAlreadyExists',
    });
  });

  it('uploads, lists with prefix/delimiter, and downloads objects', async () => {
    const put = await client.objects.put({ bucket, key: 'public/hello.txt' }, new Blob(['hello']), {
      contentType: 'text/plain',
      userMetadata: { project: 'demo' },
    });
    expect(put).toMatchObject({ key: 'public/hello.txt', etag: '5d41402abc4b2a76b9719d911017c592', size: 5 });
    await client.objects.put({ bucket, key: 'public/images/a b.txt' }, new Blob(['x']), {
      contentType: 'text/plain',
    });
    await client.objects.put({ bucket, key: 'data.json' }, new Blob(['{"a":1}']), {
      contentType: 'application/json',
    });

    const root = await client.objects.list(bucket, { delimiter: '/' });
    expect(root.contents.map((o) => o.key)).toEqual(['data.json']);
    expect(root.commonPrefixes).toEqual(['public/']);

    const folder = await client.objects.list(bucket, { prefix: 'public/', delimiter: '/' });
    expect(folder.contents[0]).toMatchObject({
      key: 'public/hello.txt',
      contentType: 'text/plain',
      userMetadata: { project: 'demo' },
    });
    expect(folder.commonPrefixes).toEqual(['public/images/']);

    expect(await (await client.objects.getBlob({ bucket, key: 'public/hello.txt' })).text()).toBe('hello');
    expect(await (await client.objects.getBlob({ bucket, key: 'public/images/a b.txt' })).text()).toBe('x');
    expect(await (await client.objects.getBlob({ bucket, key: 'data.json' })).text()).toBe('{"a":1}');
  });

  it('reads and writes tags', async () => {
    const ref = { bucket, key: 'public/hello.txt' };
    await client.objects.setTags(ref, { team: 'demo' });
    expect(await client.objects.getTags(ref)).toEqual({ tags: { team: 'demo' } });
  });

  it('copies objects', async () => {
    const result = await client.objects.copy(
      { bucket, key: 'public/hello.txt' },
      { bucket, key: 'copies/hello-copy.txt' },
    );
    expect(result.etag).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(await (await client.objects.getBlob({ bucket, key: 'copies/hello-copy.txt' })).text()).toBe('hello');
  });

  it('issues presigned URLs that work without Authorization', async () => {
    const url = await client.objects.presign({ bucket, key: 'public/hello.txt' }, 'GET', 60);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });

  it('manages versioning, versions and delete markers', async () => {
    expect((await client.buckets.setVersioning(bucket, 'ENABLED')).versioningStatus).toBe('ENABLED');
    expect(await client.buckets.getVersioning(bucket)).toEqual({ status: 'ENABLED' });

    const ref = { bucket, key: 'public/hello.txt' };
    const second = await client.objects.put(ref, new Blob(['hello v2']), { contentType: 'text/plain' });
    const marker = await client.objects.delete(ref);
    expect(marker.deleteMarker).toBe(true);

    const { versions } = await client.objects.listVersions(bucket, { prefix: 'public/hello.txt' });
    expect(versions[0]).toMatchObject({ isLatest: true, isDeleteMarker: true });
    expect(versions.some((v) => v.versionId === second.versionId && !v.isDeleteMarker)).toBe(true);

    // Historical versions stay readable by versionId (needs a signed fetch, not a presigned link).
    expect(await (await client.objects.getBlob(ref, { versionId: second.versionId })).text()).toBe('hello v2');
    await expect(client.objects.getBlob(ref)).rejects.toMatchObject({ status: 404, code: 'NoSuchKey' });

    // Removing the marker permanently exposes the previous version again.
    await client.objects.delete(ref, marker.versionId);
    expect(await (await client.objects.getBlob(ref)).text()).toBe('hello v2');
  });

  it('round-trips bucket configuration', async () => {
    await client.buckets.setEncryption(bucket, { algorithm: 'SSE_S3' });
    expect(await client.buckets.getEncryption(bucket)).toEqual({ algorithm: 'SSE_S3' });

    await client.buckets.setLifecycle(bucket, [
      { id: 'expire-tmp', prefix: 'tmp/', expireAfterDays: 7 },
    ]);
    expect((await client.buckets.getLifecycle(bucket)).rules).toEqual([
      { id: 'expire-tmp', prefix: 'tmp/', expireAfterDays: 7 },
    ]);

    const cors = [{ allowedOrigins: ['http://localhost:5173'], allowedMethods: ['GET', 'PUT'] }];
    await client.buckets.setCors(bucket, cors);
    expect((await client.buckets.getCors(bucket)).rules).toEqual(cors);

    await client.buckets.setPolicy(bucket, [
      { principal: '*', action: 'GetObject', resourcePattern: `${bucket}/public/*`, effect: 'ALLOW' },
    ]);
    const policy = await client.buckets.getPolicy(bucket);
    expect(policy).toHaveLength(1);
    expect(policy[0]).toMatchObject({ action: 'GetObject', effect: 'ALLOW' });
    await client.buckets.setPolicy(bucket, []);
    expect(await client.buckets.getPolicy(bucket)).toEqual([]);
  });

  it('refuses to delete a non-empty bucket', async () => {
    const error = await client.buckets.delete(bucket).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'BucketNotEmpty' });
  });
});
