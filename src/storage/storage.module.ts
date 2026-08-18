import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { MinioStorageService } from './minio.storage';
import { SupabaseStorageService } from './supabase.storage';

/**
 * Picks the storage backend from the environment.
 *
 * Supabase is used whenever its S3 credentials are present, which is the case
 * on the deployed API and not the case on a developer's machine, so neither has
 * to be configured specially. `STORAGE_DRIVER` (`supabase` or `minio`) forces
 * one either way.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const requested = config.get<string>('STORAGE_DRIVER')?.toLowerCase();
        const hasSupabaseKeys = Boolean(
          config.get<string>('SUPABASE_S3_ENDPOINT') &&
          config.get<string>('SUPABASE_S3_ACCESS_KEY_ID'),
        );
        const useSupabase = requested
          ? requested === 'supabase'
          : hasSupabaseKeys;

        const logger = new Logger('StorageModule');
        if (useSupabase && !hasSupabaseKeys) {
          logger.warn(
            'STORAGE_DRIVER=supabase but the SUPABASE_S3_* settings are missing; uploads will fail',
          );
        }
        logger.log(
          `Using ${useSupabase ? 'Supabase Storage' : 'MinIO'} for file storage`,
        );

        return useSupabase
          ? new SupabaseStorageService(config)
          : new MinioStorageService(config);
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
