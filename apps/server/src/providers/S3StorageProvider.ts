import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { Readable } from 'stream'
import type { ByteRange, StorageProvider } from './storage'

// S3-compatible object storage (Railway bucket in prod). On Railway, set these as
// references to the bucket's variables, e.g. S3_BUCKET=${{ bucket.BUCKET }}.
function config() {
  const env = (name: string) => {
    const value = process.env[name]
    if (!value) throw new Error(`STORAGE_PROVIDER=s3 requires ${name}`)
    return value
  }
  return {
    bucket: env('S3_BUCKET'),
    client: new S3Client({
      endpoint: env('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'auto',
      credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
      // Older Railway buckets (and MinIO) need path-style URLs; the bucket's Credentials tab says which.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    }),
  }
}

export class S3StorageProvider implements StorageProvider {
  private bucket: string
  private client: S3Client

  constructor() {
    const { bucket, client } = config()
    this.bucket = bucket
    this.client = client
  }

  async put({ key, body, mimeType }: { key: string; body: Readable; mimeType: string }) {
    // Multipart upload of unknown length: memory stays at ~queueSize × partSize per upload.
    // On failure the multipart upload is aborted, so no partial object remains.
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType },
      queueSize: 2,
      partSize: 5 * 1024 * 1024,
    }).done()
  }

  async read(key: string, range?: ByteRange) {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      )
      return object.Body as Readable
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
