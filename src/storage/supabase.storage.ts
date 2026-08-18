import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { StorageService, decodeUpload } from './storage.service';

/**
 * Supabase Storage, through its S3-compatible API.
 *
 * Used by the deployed API, where there is no MinIO to talk to. Supabase serves
 * public buckets from `/storage/v1/object/public/<bucket>/<key>`, which is the
 * URL shape the app already knows how to load — the S3 endpoint is only how we
 * write, not how anyone reads.
 */
@Injectable()
export class SupabaseStorageService
  extends StorageService
  implements OnModuleInit
{
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private config: ConfigService) {
    super();

    const endpoint = this.config.getOrThrow<string>('SUPABASE_S3_ENDPOINT');
    this.bucket = this.config.get<string>(
      'SUPABASE_STORAGE_BUCKET',
      'roommate-match',
    );

    this.client = new S3Client({
      region: this.config.get<string>('SUPABASE_S3_REGION', 'ap-southeast-1'),
      endpoint,
      // Supabase addresses buckets by path, not by subdomain.
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>(
          'SUPABASE_S3_ACCESS_KEY_ID',
        ),
        secretAccessKey: this.config.getOrThrow<string>(
          'SUPABASE_S3_SECRET_ACCESS_KEY',
        ),
      },
    });

    this.publicBaseUrl =
      this.config.get<string>('SUPABASE_PUBLIC_URL') ??
      // .../storage/v1/s3 -> .../storage/v1/object/public
      endpoint.replace(/\/s3\/?$/, '/object/public');
  }

  async onModuleInit() {
    try {
      await this.ping();
      this.logger.log(`Supabase storage bucket "${this.bucket}" is reachable`);
    } catch (error) {
      // A missing bucket must not stop the API from serving everything else;
      // uploads surface it as a 503 with a message that says what to do.
      this.logger.error(
        `Supabase storage bucket "${this.bucket}" is not usable. ` +
          `Create it (public) in the Supabase dashboard. ${String(error)}`,
      );
    }
  }

  async uploadFile(
    fileData: string | Buffer,
    fileName: string,
    mimeType = 'image/jpeg',
  ): Promise<string> {
    const upload = decodeUpload(fileData, mimeType);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileName,
        Body: upload.buffer,
        ContentType: upload.mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return `${this.publicBaseUrl}/${this.bucket}/${fileName}`;
  }

  async deleteFile(fileNameOrUrl: string): Promise<void> {
    const key = this.toObjectKey(fileNameOrUrl);
    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not delete ${key} from storage: ${String(error)}`,
      );
    }
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Accepts a bare key or the public URL that `uploadFile` handed out. */
  private toObjectKey(fileNameOrUrl: string): string | null {
    if (!fileNameOrUrl) return null;
    if (!/^https?:\/\//i.test(fileNameOrUrl)) {
      return fileNameOrUrl.replace(/^\//, '');
    }

    try {
      const path = new URL(fileNameOrUrl).pathname.replace(/^\//, '');
      // Drop everything up to and including the bucket name.
      const marker = `${this.bucket}/`;
      const index = path.indexOf(marker);
      return index >= 0 ? path.slice(index + marker.length) : path;
    } catch {
      return null;
    }
  }
}
