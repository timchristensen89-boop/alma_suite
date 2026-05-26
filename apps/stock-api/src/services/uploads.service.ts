import { randomBytes } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

// One bucket for all suite uploads — configured via env. Bucket should be
// 'private' (uniform bucket-level access, no public read). Photos are served
// back via short-lived signed read URLs from the API.
const BUCKET_NAME = process.env.UPLOADS_BUCKET || 'alma-uploads';

// Storage client picks up GOOGLE_APPLICATION_CREDENTIALS automatically when
// running locally, or uses the Cloud Run service account in prod.
const storage = new Storage();

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp'
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB ceiling per upload

export type SignedUploadResult = {
  uploadUrl: string;
  objectKey: string;
  publicPath: string;
  expiresAt: string;
  maxBytes: number;
};

export const uploadsService = {
  /**
   * Hand the browser a short-lived signed PUT URL. The browser uploads the
   * file directly to Cloud Storage — never touches the API server, which
   * keeps Cloud Run memory/CPU low and avoids streaming the file twice.
   */
  async signUploadUrl(input: {
    folder: 'deliveries' | 'gift-cards' | 'compliance' | 'marketing';
    mimeType: string;
    filename?: string;
  }): Promise<SignedUploadResult> {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new Error(`Unsupported mime type: ${input.mimeType}`);
    }

    // Slug the original filename (defaulted), prepend a random id so two
    // uploads with the same name don't collide. Folder gives us per-feature
    // organisation in the bucket.
    const safeName = (input.filename ?? 'photo')
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-')
      .slice(0, 60);
    const id = randomBytes(8).toString('hex');
    const objectKey = `${input.folder}/${new Date().getFullYear()}/${id}-${safeName}`;

    const file = storage.bucket(BUCKET_NAME).file(objectKey);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: input.mimeType,
      extensionHeaders: {
        // Enforce the size limit via the signed URL — the browser PUT must
        // include this exact x-goog-content-length-range header to be accepted.
        'x-goog-content-length-range': `0,${MAX_BYTES}`
      }
    });

    // publicPath is the gs:// reference stored on the DB record. We resolve
    // it to a viewable URL via signReadUrl below — never store signed URLs
    // because they expire.
    const publicPath = `gs://${BUCKET_NAME}/${objectKey}`;

    return {
      uploadUrl,
      objectKey,
      publicPath,
      expiresAt: expiresAt.toISOString(),
      maxBytes: MAX_BYTES
    };
  },

  /**
   * Resolve a stored gs:// path to a short-lived signed read URL the
   * browser can use to display the photo. Re-sign on every page load —
   * URLs expire after 1 hour.
   */
  async signReadUrl(publicPath: string): Promise<string | null> {
    if (!publicPath || !publicPath.startsWith('gs://')) return null;
    const without = publicPath.replace(/^gs:\/\//, '');
    const [bucket, ...rest] = without.split('/');
    if (!bucket || rest.length === 0) return null;
    const objectKey = rest.join('/');

    try {
      const [url] = await storage.bucket(bucket).file(objectKey).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000 // 1 hour
      });
      return url;
    } catch (err) {
      console.error('[uploads] failed to sign read URL', { publicPath, err });
      return null;
    }
  },

  /**
   * Delete an uploaded object — used when an operator removes a photo from
   * a delivery line. Best-effort: log on failure but don't fail the request,
   * the DB row already lost its reference.
   */
  async deleteObject(publicPath: string): Promise<void> {
    if (!publicPath || !publicPath.startsWith('gs://')) return;
    const without = publicPath.replace(/^gs:\/\//, '');
    const [bucket, ...rest] = without.split('/');
    if (!bucket || rest.length === 0) return;
    try {
      await storage.bucket(bucket).file(rest.join('/')).delete();
    } catch (err) {
      console.error('[uploads] delete failed (continuing anyway)', { publicPath, err });
    }
  }
};
