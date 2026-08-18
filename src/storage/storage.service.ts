/**
 * Where uploaded images live.
 *
 * Two implementations back this: MinIO for local development and anywhere the
 * API runs as a long-lived container, and Vercel Blob for the serverless
 * deployment, which has no MinIO to talk to. `StorageModule` picks between
 * them, so nothing that uploads a file needs to know which one it got.
 */
export abstract class StorageService {
  /**
   * Stores a file and returns a public URL for it.
   *
   * `fileData` is either a raw Buffer or a base64 string, with or without a
   * `data:` URI prefix — the prefix is where the content type comes from when
   * one is present.
   */
  abstract uploadFile(
    fileData: string | Buffer,
    fileName: string,
    mimeType?: string,
  ): Promise<string>;

  /**
   * Removes a file, taking either the object name or the public URL that
   * `uploadFile` returned. A file that is already gone is not an error.
   */
  abstract deleteFile(fileNameOrUrl: string): Promise<void>;

  /** Cheap round-trip used by the readiness probe. */
  abstract ping(): Promise<void>;
}

/** Splits a base64 payload into its bytes and, if present, its content type. */
export function decodeUpload(
  fileData: string | Buffer,
  fallbackMimeType = 'image/jpeg',
): { buffer: Buffer; mimeType: string } {
  if (typeof fileData !== 'string') {
    return { buffer: fileData, mimeType: fallbackMimeType };
  }

  const matches = /^data:([A-Za-z-+/]+);base64,(.+)$/.exec(fileData);
  if (matches) {
    return { buffer: Buffer.from(matches[2], 'base64'), mimeType: matches[1] };
  }
  return {
    buffer: Buffer.from(fileData, 'base64'),
    mimeType: fallbackMimeType,
  };
}
