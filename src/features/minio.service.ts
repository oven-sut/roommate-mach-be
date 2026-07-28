import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private minioClient: Minio.Client;
  private bucketName: string;
  private readonly logger = new Logger(MinioService.name);

  constructor(private configService: ConfigService) {
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9000));
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY', 'minioadmin');
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY', 'minioadmin');
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME', 'roommate-match');

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
        await this.minioClient.setBucketPolicy(this.bucketName, JSON.stringify(policy));
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
    let buffer: Buffer;
    if (typeof fileData === 'string') {
      // Check if it has data URI prefix
      const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        // Assume it is a raw base64 string
        buffer = Buffer.from(fileData, 'base64');
      }
    } else {
      buffer = fileData;
    }

    const metaData = {
      'Content-Type': mimeType,
    };

    await this.minioClient.putObject(this.bucketName, fileName, buffer, buffer.length, metaData);

    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = this.configService.get<number>('MINIO_PORT', 9000);
    const protocol = useSSL ? 'https' : 'http';

    const publicUrlPrefix = this.configService.get<string>('MINIO_PUBLIC_URL_PREFIX');
    if (publicUrlPrefix) {
      return `${publicUrlPrefix.replace(/\/$/, '')}/${fileName}`;
    }

    return `${protocol}://${endPoint}:${port}/${this.bucketName}/${fileName}`;
  }
}
