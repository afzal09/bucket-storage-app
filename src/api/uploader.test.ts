import { describe, expect, it, vi } from 'vitest';
import type { StorageClient } from './client';
import { MIN_PART_SIZE, MULTIPART_THRESHOLD, PART_SIZE, uploadFile } from './uploader';

function fakeClient(overrides: { uploadPart?: ReturnType<typeof vi.fn> } = {}) {
  const calls: string[] = [];
  const client = {
    uploadObject: vi.fn(async (ref: { key: string }) => {
      calls.push('uploadObject');
      return { key: ref.key, etag: 'e', versionId: 'v', size: 1 };
    }),
    uploadPart:
      overrides.uploadPart ??
      vi.fn(async (_ref: unknown, _id: string, partNumber: number) => {
        calls.push(`part${partNumber}`);
        return { etag: `etag${partNumber}`, size: 1 };
      }),
    multipart: {
      initiate: vi.fn(async () => {
        calls.push('initiate');
        return { uploadId: 'upload-1' };
      }),
      complete: vi.fn(async (ref: { key: string }) => {
        calls.push('complete');
        return { key: ref.key, etag: 'final', versionId: 'v', size: 1 };
      }),
      abort: vi.fn(async () => {
        calls.push('abort');
      }),
    },
  };
  return { client: client as unknown as StorageClient & typeof client, calls };
}

describe('uploadFile', () => {
  it('keeps every non-final part above the 5 MiB service minimum', () => {
    expect(PART_SIZE).toBeGreaterThanOrEqual(MIN_PART_SIZE);
    expect(MULTIPART_THRESHOLD).toBeGreaterThanOrEqual(MIN_PART_SIZE);
  });

  it('uploads small files with a single request', async () => {
    const { client, calls } = fakeClient();
    await uploadFile(client, { bucket: 'b', key: 'small.txt', file: new Blob(['hi']), contentType: 'text/plain' });
    expect(calls).toEqual(['uploadObject']);
  });

  it('does not use multipart at exactly the threshold', async () => {
    const { client, calls } = fakeClient();
    await uploadFile(client, { bucket: 'b', key: 'k', file: new Blob([new Uint8Array(MULTIPART_THRESHOLD)]) });
    expect(calls).toEqual(['uploadObject']);
  });

  it('splits larger files into ordered parts and completes with the returned etags', async () => {
    const { client, calls } = fakeClient();
    const size = PART_SIZE * 2 + 10;
    await uploadFile(client, { bucket: 'b', key: 'big.bin', file: new Blob([new Uint8Array(size)]) });
    expect(calls).toEqual(['initiate', 'part1', 'part2', 'part3', 'complete']);
    expect(client.multipart.complete).toHaveBeenCalledWith({ bucket: 'b', key: 'big.bin' }, 'upload-1', [
      { partNumber: 1, etag: 'etag1' },
      { partNumber: 2, etag: 'etag2' },
      { partNumber: 3, etag: 'etag3' },
    ]);
    const sizes = client.uploadPart.mock.calls.map((call) => (call[3] as Blob).size);
    expect(sizes).toEqual([PART_SIZE, PART_SIZE, 10]);
  });

  it('aborts the multipart session and rethrows when a part fails', async () => {
    const failure = new Error('part 2 exploded');
    const uploadPart = vi
      .fn()
      .mockResolvedValueOnce({ etag: 'e1', size: 1 })
      .mockRejectedValueOnce(failure);
    const { client, calls } = fakeClient({ uploadPart });
    await expect(
      uploadFile(client, { bucket: 'b', key: 'k', file: new Blob([new Uint8Array(PART_SIZE * 3)]) }),
    ).rejects.toBe(failure);
    expect(calls).toEqual(['initiate', 'abort']);
    expect(client.multipart.complete).not.toHaveBeenCalled();
  });

  it('aborts the session when cancelled between parts', async () => {
    const controller = new AbortController();
    const uploadPart = vi.fn(async () => {
      controller.abort();
      return { etag: 'e1', size: 1 };
    });
    const { client, calls } = fakeClient({ uploadPart });
    await expect(
      uploadFile(client, {
        bucket: 'b',
        key: 'k',
        file: new Blob([new Uint8Array(PART_SIZE * 3)]),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual(['initiate', 'abort']);
    expect(uploadPart).toHaveBeenCalledTimes(1);
  });

  it('still surfaces the original error if abort itself fails', async () => {
    const failure = new Error('boom');
    const uploadPart = vi.fn().mockRejectedValue(failure);
    const { client } = fakeClient({ uploadPart });
    client.multipart.abort.mockRejectedValueOnce(new Error('abort failed'));
    await expect(
      uploadFile(client, { bucket: 'b', key: 'k', file: new Blob([new Uint8Array(PART_SIZE + 1)]) }),
    ).rejects.toBe(failure);
  });
});
