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
 * Amazon S3 (or S3 Access Point) storage service.
 *
 * Supports standard S3 buckets as well as Amazon S3 Access Point aliases
 * (such as `access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias`).
 */
@Injectable()
export class S3StorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl: string;

  constructor(private config: ConfigService) {
    super();

    this.bucket =
      this.config.get<string>('AWS_S3_BUCKET') ||
      this.config.get<string>('S3_BUCKET') ||
      'access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias';

    this.region =
      this.config.get<string>('AWS_REGION') ||
      this.config.get<string>('AWS_S3_REGION') ||
      'ap-southeast-1';

    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('AWS_S3_ENDPOINT');
    const forcePathStyle =
      this.config.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true';

    this.client = new S3Client({
      region: this.region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });

    const customPublicUrl =
      this.config.get<string>('AWS_S3_PUBLIC_URL') ||
      this.config.get<string>('S3_PUBLIC_URL');

    this.publicBaseUrl =
      customPublicUrl?.replace(/\/$/, '') ||
      `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  async onModuleInit() {
    try {
      await this.ping();
      this.logger.log(
        `AWS S3 storage bucket/access-point "${this.bucket}" is reachable`,
      );
    } catch (error) {
      this.logger.error(
        `AWS S3 storage "${this.bucket}" is not usable. ` +
          `Verify AWS credentials and access point/bucket policies. ${String(error)}`,
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

    return `${this.publicBaseUrl}/${fileName.replace(/^\//, '')}`;
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
      const url = new URL(fileNameOrUrl);
      let path = url.pathname.replace(/^\//, '');

      // If URL has bucket prefix (path-style), drop it
      const marker = `${this.bucket}/`;
      if (path.startsWith(marker)) {
        path = path.slice(marker.length);
      }

      return path;
    } catch {
      return null;
    }
  }
}
