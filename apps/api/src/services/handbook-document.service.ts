import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';

/**
 * Files attached to the staff handbook.
 *
 * The handbook has been a JSON blob of text with nowhere to put a policy PDF
 * or a photo of how the pass should look, so those have lived in somebody's
 * email and reached new starters only if that person remembered to forward
 * them.
 *
 * Bytes go in Postgres rather than an object store: the suite has no bucket
 * wired, these are a handful of small files, and SupplierInvoiceDocument
 * already makes the same call. If the handbook ever grows to hundreds of
 * files this is the thing to revisit.
 */

/**
 * What a browser may upload.
 *
 * Deliberately narrow. A handbook is documents and pictures; anything else
 * arriving here is either a mistake or someone using the venue's compliance
 * system as a file host, and both are worth refusing.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/gif'
]);

/**
 * Express parses JSON up to 6MB, and base64 inflates by a third, so anything
 * over ~4MB of real file would be rejected by the body parser with a far less
 * helpful message than this one.
 */
export const HANDBOOK_MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Enough attachments to be useful, few enough that an email still sends. */
const MAX_ONBOARDING_ATTACHMENTS = 5;
const MAX_ONBOARDING_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function decodeDataUrl(value: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(value.trim());
  if (!match) throw new HttpError(400, 'Expected a base64 data URL.');
  const mimeType = match[1]!.toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpError(400, `${mimeType} can't go in the handbook. Upload a PDF or an image.`);
  }
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length === 0) throw new HttpError(400, 'That file is empty.');
  if (bytes.length > HANDBOOK_MAX_FILE_BYTES) {
    throw new HttpError(
      413,
      `That file is ${(bytes.length / 1024 / 1024).toFixed(1)}MB. The limit is ${HANDBOOK_MAX_FILE_BYTES / 1024 / 1024}MB — try compressing it.`
    );
  }
  return { mimeType, bytes };
}

export const handbookDocumentService = {
  /** Everything on file, without the bytes — a list must not ship megabytes. */
  async list(venue?: string | null) {
    const scoped = (venue ?? '').trim();
    return prisma.handbookDocument.findMany({
      where: scoped && scoped !== 'all' ? { OR: [{ venue: scoped }, { venue: null }] } : {},
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        description: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        venue: true,
        sendOnOnboarding: true,
        position: true,
        createdAt: true,
        updatedAt: true
      }
    });
  },

  async upload(input: unknown, uploadedByStaffId?: string | null) {
    const data = (input ?? {}) as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const fileName = typeof data.fileName === 'string' ? data.fileName.trim() : '';
    const file = typeof data.file === 'string' ? data.file : '';
    if (!title) throw new HttpError(400, 'Give the document a title.');
    if (!file) throw new HttpError(400, 'No file was attached.');

    const { mimeType, bytes } = decodeDataUrl(file);
    const last = await prisma.handbookDocument.findFirst({ orderBy: { position: 'desc' }, select: { position: true } });

    const created = await prisma.handbookDocument.create({
      data: {
        title,
        description: typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null,
        fileName: fileName || `${title}${mimeType === 'application/pdf' ? '.pdf' : ''}`,
        mimeType,
        sizeBytes: bytes.length,
        data: new Uint8Array(bytes),
        venue: typeof data.venue === 'string' && data.venue.trim() && data.venue !== 'all' ? data.venue.trim() : null,
        sendOnOnboarding: data.sendOnOnboarding === true,
        position: (last?.position ?? 0) + 1,
        uploadedByStaffId: uploadedByStaffId ?? null
      },
      select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, sendOnOnboarding: true }
    });
    return created;
  },

  /** The bytes, for download or inline display. */
  async file(id: string) {
    const doc = await prisma.handbookDocument.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, data: true }
    });
    if (!doc) throw new HttpError(404, 'That handbook document no longer exists.');
    return doc;
  },

  async update(id: string, input: unknown) {
    const data = (input ?? {}) as Record<string, unknown>;
    const existing = await prisma.handbookDocument.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, 'That handbook document no longer exists.');
    return prisma.handbookDocument.update({
      where: { id },
      data: {
        ...(typeof data.title === 'string' && data.title.trim() ? { title: data.title.trim() } : {}),
        ...(typeof data.description === 'string' ? { description: data.description.trim() || null } : {}),
        ...(typeof data.sendOnOnboarding === 'boolean' ? { sendOnOnboarding: data.sendOnOnboarding } : {}),
        ...(typeof data.venue === 'string' ? { venue: data.venue.trim() && data.venue !== 'all' ? data.venue.trim() : null } : {})
      },
      select: { id: true, title: true, sendOnOnboarding: true, venue: true }
    });
  },

  async remove(id: string) {
    const existing = await prisma.handbookDocument.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!existing) throw new HttpError(404, 'That handbook document no longer exists.');
    await prisma.handbookDocument.delete({ where: { id } });
    return { removed: existing.title };
  },

  /**
   * The documents a new starter at this venue should receive.
   *
   * Capped on both count and total size: a welcome email that bounces because
   * it carries 40MB of PDFs has told the new starter nothing at all. Whatever
   * is dropped is reported so the caller can say so rather than pretend.
   */
  async onboardingAttachments(venue: string | null | undefined) {
    const scoped = (venue ?? '').trim();
    const candidates = await prisma.handbookDocument.findMany({
      where: {
        sendOnOnboarding: true,
        ...(scoped ? { OR: [{ venue: scoped }, { venue: null }] } : {})
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { title: true, fileName: true, mimeType: true, sizeBytes: true, data: true }
    });

    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    const skipped: string[] = [];
    let total = 0;
    for (const doc of candidates) {
      if (attachments.length >= MAX_ONBOARDING_ATTACHMENTS || total + doc.sizeBytes > MAX_ONBOARDING_ATTACHMENT_BYTES) {
        skipped.push(doc.title);
        continue;
      }
      total += doc.sizeBytes;
      attachments.push({ filename: doc.fileName, content: Buffer.from(doc.data), contentType: doc.mimeType });
    }
    return { attachments, skipped, totalBytes: total };
  }
};
