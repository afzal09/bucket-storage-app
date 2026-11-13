// Wire shapes from bucket-storage-service/docs/API-CONTRACT-SYNC.md ("Shared wire shapes").

export type Timestamp = string;
/** BIGINT sizes arrive as decimal strings on DB-backed reads, numbers on fresh writes. */
export type RuntimeSize = number | string;
export type StringMap = Record<string, string>;

export type StorageClass = 'STANDARD' | 'INFREQUENT_ACCESS' | 'ARCHIVE';
export type VersioningStatus = 'DISABLED' | 'ENABLED' | 'SUSPENDED';

export interface EncryptionConfig {
  algorithm: 'SSE_S3' | 'SSE_KMS';
  kmsKeyId?: string;
}

export interface LifecycleRule {
  id: string;
  prefix?: string;
  transitionAfterDays?: number;
  targetStorageClass?: 'INFREQUENT_ACCESS' | 'ARCHIVE';
  expireAfterDays?: number;
}

export interface CorsRule {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
}

export interface Bucket {
  id: string;
  name: string;
  region: string;
  ownerId: string;
  versioningStatus: VersioningStatus;
  defaultEncryption: EncryptionConfig | null;
  lifecycleRules: LifecycleRule[] | null;
  corsConfig: CorsRule[] | null;
  replicationTarget: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PolicyEffect = 'ALLOW' | 'DENY';

export interface PolicyStatement {
  principal: string;
  action: string;
  resourcePattern?: string;
  effect: PolicyEffect;
}

export interface PolicyRow {
  id: string;
  bucketName: string;
  principal: string;
  action: string;
  resourcePattern: string;
  effect: PolicyEffect;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ObjectMetadata {
  key: string;
  size: RuntimeSize;
  etag: string;
  contentType: string;
  versionId: string;
  storageClass: StorageClass;
  lastModified: Timestamp;
  userMetadata: StringMap;
}

export interface PutResult {
  key: string;
  etag: string;
  versionId: string;
  size: number;
}

export interface DeleteResult {
  key: string;
  deleteMarker: boolean;
  versionId?: string;
}

export interface CopyResult {
  etag: string;
  versionId: string;
  lastModified: Timestamp;
}

export interface ListObjectsResult {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  isTruncated: boolean;
  nextMarker?: string;
  contents: ObjectMetadata[];
  commonPrefixes: string[];
}

export interface VersionMetadata extends ObjectMetadata {
  isLatest: boolean;
  isDeleteMarker: boolean;
}

export interface ListVersionsResult {
  bucket: string;
  versions: VersionMetadata[];
}

export interface PartRow {
  id: string;
  uploadRecordId: string;
  partNumber: number;
  etag: string;
  size: RuntimeSize;
  storagePointer: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface AccessKey {
  accessKeyId: string;
  secretKey: string;
}

export interface ClientConfig {
  /** HTTP(S) origin of the service, e.g. http://localhost:4000 */
  endpoint: string;
  accessKeyId?: string;
  secretKey?: string;
}

export interface ObjectRef {
  bucket: string;
  key: string;
}
