import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { MinioStorageService } from './minio.storage';
import { SupabaseStorageService } from './supabase.storage';
import { S3StorageService } from './s3.storage';

/**
 * Picks the storage backend from the environment.
 *
 * S3 / AWS S3 is used when STORAGE_DRIVER=s3 (or aws) or when AWS S3 settings are present.
 * Supabase is used whenever its S3 credentials are present.
 * MinIO is the default for local development.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const requested = config.get<string>('STORAGE_DRIVER')?.toLowerCase();
        const hasS3Config = Boolean(
          config.get<string>('AWS_S3_BUCKET') ||
          (config.get<string>('AWS_ACCESS_KEY_ID') &&
            !config.get<string>('SUPABASE_S3_ACCESS_KEY_ID')),
        );
        const hasSupabaseKeys = Boolean(
          config.get<string>('SUPABASE_S3_ENDPOINT') &&
          config.get<string>('SUPABASE_S3_ACCESS_KEY_ID'),
        );

        let driver = 'minio';
        if (requested) {
          driver = requested;
        } else if (hasS3Config) {
          driver = 's3';
        } else if (hasSupabaseKeys) {
          driver = 'supabase';
        }

        const logger = new Logger('StorageModule');

        if (driver === 's3' || driver === 'aws') {
          logger.log('Using AWS S3 Storage for file storage');
          return new S3StorageService(config);
        }

        if (driver === 'supabase') {
          if (!hasSupabaseKeys) {
            logger.warn(
              'STORAGE_DRIVER=supabase but the SUPABASE_S3_* settings are missing; uploads will fail',
            );
          }
          logger.log('Using Supabase Storage for file storage');
          return new SupabaseStorageService(config);
        }

        logger.log('Using MinIO for file storage');
        return new MinioStorageService(config);
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
