import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { StorageModule } from './storage.module';
import { StorageService, decodeUpload } from './storage.service';
import { MinioStorageService } from './minio.storage';
import { SupabaseStorageService } from './supabase.storage';
import { S3StorageService } from './s3.storage';

const SUPABASE_ENV = {
  SUPABASE_S3_ENDPOINT: 'https://project.storage.supabase.co/storage/v1/s3',
  SUPABASE_S3_ACCESS_KEY_ID: 'test-access-key',
  SUPABASE_S3_SECRET_ACCESS_KEY: 'test-secret-key',
  SUPABASE_S3_REGION: 'ap-southeast-1',
  SUPABASE_STORAGE_BUCKET: 'roommate-match',
};

const AWS_S3_ENV = {
  AWS_S3_BUCKET: 'access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias',
  AWS_REGION: 'ap-southeast-1',
  AWS_ACCESS_KEY_ID: 'test-aws-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-aws-secret-key',
};

/** Builds the module with a specific environment in place. */
async function resolveStorage(env: Record<string, string | undefined>) {
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        StorageModule,
      ],
    }).compile();
    return moduleRef.get(StorageService);
  } finally {
    process.env = previous;
  }
}

describe('StorageModule', () => {
  const clean: Record<string, undefined> = {
    STORAGE_DRIVER: undefined,
    SUPABASE_S3_ENDPOINT: undefined,
    SUPABASE_S3_ACCESS_KEY_ID: undefined,
    SUPABASE_S3_SECRET_ACCESS_KEY: undefined,
    AWS_S3_BUCKET: undefined,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,
  };

  it('uses MinIO when no Supabase or AWS credentials are present', async () => {
    const storage = await resolveStorage(clean);
    expect(storage).toBeInstanceOf(MinioStorageService);
  });

  it('switches to AWS S3 as soon as its bucket/credentials are configured', async () => {
    const storage = await resolveStorage({ ...clean, ...AWS_S3_ENV });
    expect(storage).toBeInstanceOf(S3StorageService);
  });

  it('switches to Supabase as soon as its credentials are configured', async () => {
    const storage = await resolveStorage({ ...clean, ...SUPABASE_ENV });
    expect(storage).toBeInstanceOf(SupabaseStorageService);
  });

  it('honours an explicit driver over the credentials present', async () => {
    const storage = await resolveStorage({
      ...clean,
      ...SUPABASE_ENV,
      STORAGE_DRIVER: 'minio',
    });
    expect(storage).toBeInstanceOf(MinioStorageService);
  });

  it('honours explicit driver=s3 even if Supabase is also present', async () => {
    const storage = await resolveStorage({
      ...clean,
      ...SUPABASE_ENV,
      ...AWS_S3_ENV,
      STORAGE_DRIVER: 's3',
    });
    expect(storage).toBeInstanceOf(S3StorageService);
  });
});

describe('SupabaseStorageService', () => {
  const build = () => {
    const config = {
      get: (key: string, fallback?: string) =>
        (SUPABASE_ENV as Record<string, string>)[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = (SUPABASE_ENV as Record<string, string>)[key];
        if (!value) throw new Error(`${key} is not set`);
        return value;
      },
    };
    return new SupabaseStorageService(
      config as unknown as import('@nestjs/config').ConfigService,
    );
  };

  it('hands back the public object URL, not the S3 write endpoint', async () => {
    const service = build();
    // Replace the transport so nothing leaves the machine.
    (service as unknown as { client: { send: jest.Mock } }).client = {
      send: jest.fn().mockResolvedValue({}),
    };

    const url = await service.uploadFile(
      'data:image/png;base64,aGVsbG8=',
      'avatars/user-1/avatar_1.png',
    );

    expect(url).toBe(
      'https://project.storage.supabase.co/storage/v1/object/public/roommate-match/avatars/user-1/avatar_1.png',
    );
  });

  it('sends the decoded bytes and the content type from the data URI', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.uploadFile('data:image/webp;base64,aGVsbG8=', 'a/b.webp');

    const input = send.mock.calls[0][0].input as {
      Body: Buffer;
      ContentType: string;
      Key: string;
      Bucket: string;
    };
    expect(input.ContentType).toBe('image/webp');
    expect(input.Body.toString()).toBe('hello');
    expect(input.Key).toBe('a/b.webp');
    expect(input.Bucket).toBe('roommate-match');
  });

  it('turns a stored public URL back into an object key when deleting', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.deleteFile(
      'https://project.storage.supabase.co/storage/v1/object/public/roommate-match/avatars/user-1/avatar_1.png',
    );

    expect((send.mock.calls[0][0].input as { Key: string }).Key).toBe(
      'avatars/user-1/avatar_1.png',
    );
  });

  it('accepts a bare key as well as a URL', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.deleteFile('avatars/user-1/avatar_1.png');

    expect((send.mock.calls[0][0].input as { Key: string }).Key).toBe(
      'avatars/user-1/avatar_1.png',
    );
  });

  it('ignores a delete of nothing', async () => {
    const service = build();
    const send = jest.fn();
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await expect(service.deleteFile('')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not let a failed delete break the caller', async () => {
    const service = build();
    (service as unknown as { client: { send: jest.Mock } }).client = {
      send: jest.fn().mockRejectedValue(new Error('network down')),
    };

    await expect(service.deleteFile('a/b.png')).resolves.toBeUndefined();
  });
});

describe('S3StorageService', () => {
  const build = (customConfig: Record<string, string> = {}) => {
    const values = { ...AWS_S3_ENV, ...customConfig };
    const config = {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = values[key];
        if (!value) throw new Error(`${key} is not set`);
        return value;
      },
    };
    return new S3StorageService(
      config as unknown as import('@nestjs/config').ConfigService,
    );
  };

  it('hands back the public S3 virtual-hosted URL with access point alias', async () => {
    const service = build();
    (service as unknown as { client: { send: jest.Mock } }).client = {
      send: jest.fn().mockResolvedValue({}),
    };

    const url = await service.uploadFile(
      'data:image/png;base64,aGVsbG8=',
      'avatars/user-1/avatar_1.png',
    );

    expect(url).toBe(
      'https://access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias.s3.ap-southeast-1.amazonaws.com/avatars/user-1/avatar_1.png',
    );
  });

  it('uses custom AWS_S3_PUBLIC_URL when set', async () => {
    const service = build({
      AWS_S3_PUBLIC_URL: 'https://images.example.com',
    });
    (service as unknown as { client: { send: jest.Mock } }).client = {
      send: jest.fn().mockResolvedValue({}),
    };

    const url = await service.uploadFile(
      'data:image/png;base64,aGVsbG8=',
      'avatars/user-1/avatar_1.png',
    );

    expect(url).toBe('https://images.example.com/avatars/user-1/avatar_1.png');
  });

  it('sends the decoded bytes and the content type from the data URI', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.uploadFile('data:image/webp;base64,aGVsbG8=', 'a/b.webp');

    const input = send.mock.calls[0][0].input as {
      Body: Buffer;
      ContentType: string;
      Key: string;
      Bucket: string;
    };
    expect(input.ContentType).toBe('image/webp');
    expect(input.Body.toString()).toBe('hello');
    expect(input.Key).toBe('a/b.webp');
    expect(input.Bucket).toBe(
      'access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias',
    );
  });

  it('turns a stored public URL back into an object key when deleting', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.deleteFile(
      'https://access-ojuwfnoorf3tq9sxq5odgpat8dapcaps1a-s3alias.s3.ap-southeast-1.amazonaws.com/avatars/user-1/avatar_1.png',
    );

    expect((send.mock.calls[0][0].input as { Key: string }).Key).toBe(
      'avatars/user-1/avatar_1.png',
    );
  });

  it('accepts a bare key as well as a URL', async () => {
    const service = build();
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await service.deleteFile('avatars/user-1/avatar_1.png');

    expect((send.mock.calls[0][0].input as { Key: string }).Key).toBe(
      'avatars/user-1/avatar_1.png',
    );
  });

  it('ignores a delete of nothing', async () => {
    const service = build();
    const send = jest.fn();
    (service as unknown as { client: { send: jest.Mock } }).client = { send };

    await expect(service.deleteFile('')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not let a failed delete break the caller', async () => {
    const service = build();
    (service as unknown as { client: { send: jest.Mock } }).client = {
      send: jest.fn().mockRejectedValue(new Error('network down')),
    };

    await expect(service.deleteFile('a/b.png')).resolves.toBeUndefined();
  });
});

describe('decodeUpload', () => {
  it('reads the content type out of a data URI', () => {
    const png = Buffer.from('hello').toString('base64');
    const { buffer, mimeType } = decodeUpload(`data:image/png;base64,${png}`);

    expect(mimeType).toBe('image/png');
    expect(buffer.toString()).toBe('hello');
  });

  it('falls back to the given type for a bare base64 string', () => {
    const { buffer, mimeType } = decodeUpload(
      Buffer.from('hello').toString('base64'),
      'image/webp',
    );

    expect(mimeType).toBe('image/webp');
    expect(buffer.toString()).toBe('hello');
  });

  it('passes a Buffer straight through', () => {
    const source = Buffer.from('raw bytes');
    const { buffer, mimeType } = decodeUpload(source);

    expect(buffer).toBe(source);
    expect(mimeType).toBe('image/jpeg');
  });
});
