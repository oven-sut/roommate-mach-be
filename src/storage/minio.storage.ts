import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { StorageService, decodeUpload } from './storage.service';

/** MinIO-backed storage: local development and any container deployment. */
@Injectable()
export class MinioStorageService
  extends StorageService
  implements OnModuleInit
{
  private minioClient: Minio.Client;
  private bucketName: string;
  private readonly logger = new Logger(MinioStorageService.name);

  constructor(private configService: ConfigService) {
    super();
    const endPoint = this.configService.get<string>(
      'MINIO_ENDPOINT',
      'localhost',
    );
    const port = Number(this.configService.get<number>('MINIO_PORT', 9000));
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const accessKey = this.configService.get<string>(
      'MINIO_ACCESS_KEY',
      'minioadmin',
    );
    const secretKey = this.configService.get<string>(
      'MINIO_SECRET_KEY',
      'minioadmin',
    );
    this.bucketName = this.configService.get<string>(
      'MINIO_BUCKET_NAME',
      'roommate-match',
    );

    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName);
        this.logger.log(`Created bucket: ${this.bucketName}`);

        // Set public read policy for the bucket so that the app/client can view uploaded images.
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucketName}/*`],
            },
          ],
        };
        await this.minioClient.setBucketPolicy(
          this.bucketName,
          JSON.stringify(policy),
        );
        this.logger.log(`Set public read policy on bucket: ${this.bucketName}`);
      } else {
        this.logger.log(`Bucket ${this.bucketName} already exists`);
      }
    } catch (err) {
      this.logger.error('Error initializing MinIO bucket', err);
    }
  }

  /**
   * Uploads a file (buffer or base64) to MinIO and returns the public URL.
   */
  async uploadFile(
    fileData: string | Buffer,
    fileName: string,
    mimeType: string = 'image/jpeg',
  ): Promise<string> {
    const upload = decodeUpload(fileData, mimeType);
    const buffer = upload.buffer;

    const metaData = {
      'Content-Type': upload.mimeType,
    };

    await this.minioClient.putObject(
      this.bucketName,
      fileName,
      buffer,
      buffer.length,
      metaData,
    );

    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const endPoint = this.configService.get<string>(
      'MINIO_ENDPOINT',
      'localhost',
    );
    const port = this.configService.get<number>('MINIO_PORT', 9000);
    const protocol = useSSL ? 'https' : 'http';

    const publicUrlPrefix = this.configService.get<string>(
      'MINIO_PUBLIC_URL_PREFIX',
    );
    if (publicUrlPrefix) {
      return `${publicUrlPrefix.replace(/\/$/, '')}/${fileName}`;
    }

    return `${protocol}://${endPoint}:${port}/${this.bucketName}/${fileName}`;
  }

  /**
   * Removes an object, taking either a bare object name or the public URL that
   * `uploadFile` returned. Missing objects are not an error - the goal is that
   * the file is gone.
   */
  async deleteFile(fileNameOrUrl: string): Promise<void> {
    const objectName = this.toObjectName(fileNameOrUrl);
    if (!objectName) return;
    try {
      await this.minioClient.removeObject(this.bucketName, objectName);
    } catch (err) {
      this.logger.warn(
        `Could not delete ${objectName} from storage: ${String(err)}`,
      );
    }
  }

  /** Strips scheme, host and bucket prefix off a stored URL. */
  private toObjectName(fileNameOrUrl: string): string | null {
    if (!fileNameOrUrl) return null;
    if (!/^https?:\/\//i.test(fileNameOrUrl)) {
      return fileNameOrUrl.replace(/^\//, '');
    }
    try {
      const path = new URL(fileNameOrUrl).pathname.replace(/^\//, '');
      const prefix = `${this.bucketName}/`;
      return path.startsWith(prefix) ? path.slice(prefix.length) : path;
    } catch {
      return null;
    }
  }

  /** Cheap round-trip used by the readiness probe. */
  async ping(): Promise<void> {
    await this.minioClient.bucketExists(this.bucketName);
  }
}
