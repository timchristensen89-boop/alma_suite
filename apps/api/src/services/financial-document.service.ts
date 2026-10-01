import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import type { FinancialDocument as FinancialDocumentRow, LegalEntity as LegalEntityRow } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  FINANCIAL_DOCUMENT_STATUSES,
  FINANCIAL_DOCUMENT_TYPES,
  FinancialDocumentError,
  centsToDollars,
  composeCreditLines,
  composeGiftCardSaleLines,
  creditDocumentType,
  creditNoteInputSchema,
  documentSeries,
  emailFinancialDocumentInputSchema,
  formatDocumentNumber,
  invoiceSettingsInputSchema,
  isCreditDocument,
  issueGiftCardDocumentInputSchema,
  legalEntityInputSchema,
  legalEntityUpdateSchema,
  normaliseAbn,
  normaliseInvoiceSettings,
  remainingCreditable,
  saleDocumentType,
  summariseLines,
  venueDayBounds,
  voidFinancialDocumentInputSchema,
  type AuthUser,
  type FinancialDocumentDetail,
  type FinancialDocumentIssueSource,
  type FinancialDocumentLineDraft,
  type FinancialDocumentListResponse,
  type FinancialDocumentSource,
  type FinancialDocumentSummary,
  type FinancialDocumentType,
  type GiftCardDocumentsResponse,
  type InvoiceSettings,
  type InvoiceSettingsResponse,
  type IssueGiftCardDocumentInput,
  type LegalEntity,
  type LegalEntityInput,
  type PaymentProvider,
  type IssuedButNotEmailedDetails
} from '@alma/shared';
import Stripe from 'stripe';
import { ZodError } from 'zod';
import { env } from '../env.js';
import { renderFinancialDocumentPdf } from '../lib/financial-document-pdf.js';
import {
  applyIssuerGstStatus,
  creditSeriesFor,
  giftCardDocumentIneligibleReason,
  giftCardSaleKey,
  maskGiftCardCode,
  paymentMethodSummary,
  paymentProviderForCard,
  planStripeRefundCredits,
  promoCodeForDocument,
  stripeCheckoutSessionIdForDocument,
  stripePaymentIntentIdForCard,
  shouldReconcileRefundsOnIssue,
  stripeRefundCreditReason,
  type StripeRefundFacts
} from '../lib/gift-card-documents.js';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';

// Receipts, tax invoices and credit notes. The GST reasoning lives in
// packages/shared/src/financial-documents.ts; this is the part with a
// database, a clock, Stripe and email. Runbook: docs/invoices.md.
//
// Deliberately does NOT import gift-card.service: that service calls
// issueAfterStripePayment from its checkout handler, so importing it back
// here would be a cycle. The owner check below mirrors its promo-code gate.

const stripe = env.stripe.secretKey
  ? new Stripe(env.stripe.secretKey, {
      apiVersion: env.stripe.apiVersion,
      ...(env.stripe.context && { stripeContext: env.stripe.context })
    })
  : null;

const SETTINGS_ID = 'singleton';
const INVOICE_OWNER_EMAIL = (process.env.GIFT_CARD_OWNER_EMAIL ?? 'tim@almagroup.com.au').trim().toLowerCase();
const LIST_CAP = 200;
const CATCH_UP_BATCH = 100;
const SALE_TYPES: FinancialDocumentType[] = ['RECEIPT', 'TAX_INVOICE'];
const CREDIT_TYPES: FinancialDocumentType[] = ['CREDIT_NOTE', 'ADJUSTMENT_NOTE'];

/** The word for the document in a sentence or a subject line. */
const SHORT_TITLES: Record<FinancialDocumentType, string> = {
  TAX_INVOICE: 'Tax invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
  ADJUSTMENT_NOTE: 'Adjustment note'
};

const summaryInclude = {
  creditsDocument: { select: { number: true } }
} satisfies Prisma.FinancialDocumentInclude;

const detailInclude = {
  creditsDocument: { select: { number: true } },
  lines: { orderBy: { position: 'asc' } },
  credits: { orderBy: { issuedAt: 'desc' }, include: summaryInclude }
} satisfies Prisma.FinancialDocumentInclude;

type SummaryRow = FinancialDocumentRow & { creditsDocument: { number: string } | null };
type DetailRow = Prisma.FinancialDocumentGetPayload<{ include: typeof detailInclude }>;
type DocumentData = Omit<Prisma.FinancialDocumentUncheckedCreateInput, 'number' | 'series' | 'sequence' | 'lines'>;

function isInvoiceOwner(user?: AuthUser | null) {
  return user?.email?.toLowerCase() === INVOICE_OWNER_EMAIL;
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normaliseCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function reasonOf(error: unknown) {
  return error instanceof Error ? error.message : 'unknown';
}

function isUniqueViolation(error: unknown, field?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (!field) return true;
  const target = error.meta?.target;
  return (Array.isArray(target) ? target.join(',') : String(target ?? '')).includes(field);
}

function toLegalEntity(row: LegalEntityRow): LegalEntity {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toSummary(row: SummaryRow): FinancialDocumentSummary {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    gstTreatment: row.gstTreatment,
    sourceType: row.sourceType as FinancialDocumentSource,
    sourceId: row.sourceId,
    sourceReference: row.sourceReference,
    giftCardId: row.giftCardId,
    creditsDocumentId: row.creditsDocumentId,
    creditsDocumentNumber: row.creditsDocument?.number ?? null,
    legalEntityId: row.legalEntityId,
    issuerLegalName: row.issuerLegalName,
    issuerTradingName: row.issuerTradingName,
    issuerAbn: row.issuerAbn,
    customerName: row.customerName,
    customerOrganisation: row.customerOrganisation,
    customerEmail: row.customerEmail,
    currency: row.currency,
    totalCents: row.totalCents,
    taxableCents: row.taxableCents,
    gstCents: row.gstCents,
    paymentProvider: row.paymentProvider as PaymentProvider,
    paymentMethodSummary: row.paymentMethodSummary,
    paidAt: row.paidAt?.toISOString() ?? null,
    issuedAt: row.issuedAt.toISOString(),
    issueSource: row.issueSource as FinancialDocumentIssueSource,
    emailedAt: row.emailedAt?.toISOString() ?? null,
    emailedTo: row.emailedTo,
    emailError: row.emailError,
    emailCount: row.emailCount,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    testMode: row.testMode
  };
}

function toDetail(row: DetailRow, issuedByName: string | null): FinancialDocumentDetail {
  const liveCredits = row.credits.filter((credit) => credit.status === 'ISSUED');
  // Only a live sale document has anything left to credit.
  const remainingCreditableCents =
    isCreditDocument(row.type) || row.status !== 'ISSUED' ? 0 : remainingCreditable(row, liveCredits).totalCents;
  return {
    ...toSummary(row),
    issuerAddress: row.issuerAddress,
    issuerEmail: row.issuerEmail,
    issuerPhone: row.issuerPhone,
    issuerWebsite: row.issuerWebsite,
    issuerGstRegistered: row.issuerGstRegistered,
    customerAbn: row.customerAbn,
    customerReference: row.customerReference,
    paymentReference: row.paymentReference,
    stripePaymentIntentId: row.stripePaymentIntentId,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripeChargeId: row.stripeChargeId,
    stripeRefundId: row.stripeRefundId,
    supplyDate: row.supplyDate?.toISOString() ?? null,
    reason: row.reason,
    note: row.note,
    issuedByName,
    lines: row.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      detail: line.detail,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      amountCents: line.amountCents,
      gstTreatment: line.gstTreatment,
      taxableAmountCents: line.taxableAmountCents,
      gstCents: line.gstCents
    })),
    credits: row.credits.map(toSummary),
    remainingCreditableCents
  };
}

async function readSettings(): Promise<InvoiceSettings> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
    select: { invoiceSettings: true }
  });
  return normaliseInvoiceSettings(row.invoiceSettings);
}

/** Why nothing can be issued yet, or null when the chosen issuer is ready. */
function setupIssueFor(settings: InvoiceSettings, issuer: LegalEntityRow | null): string | null {
  if (!settings.giftCardIssuingEntityId) {
    return 'No company has been chosen to issue gift card receipts yet. Tim needs to add the company (legal name and ABN) under Companies, then choose it as the gift card issuer in Settings.';
  }
  if (!issuer) {
    return 'The company chosen to issue gift card receipts no longer exists. Tim needs to choose the issuing company again in Settings.';
  }
  if (!issuer.active) {
    return `${issuer.legalName} is switched off, so it cannot issue documents. Tim needs to switch it back on under Companies, or choose another issuer in Settings.`;
  }
  return null;
}

async function resolveIssuer(settings: InvoiceSettings) {
  const issuer = settings.giftCardIssuingEntityId
    ? await prisma.legalEntity.findUnique({ where: { id: settings.giftCardIssuingEntityId } })
    : null;
  const setupIssue = setupIssueFor(settings, issuer);
  return { entity: setupIssue ? null : issuer, setupIssue };
}

/**
 * Take the next number in a series and create the document with it, inside
 * the caller's transaction.
 *
 * One statement creates the series row the first time and increments it
 * every time after, and the row lock it takes is held until commit — so two
 * issues at once queue here instead of both reading the same last number. If
 * the document insert then fails (the saleKey latch, say), the transaction
 * rolls back and the number goes back with it. That is what keeps the series
 * gap-free, which a tax invoice series has to be.
 */
async function createNumberedDocument(
  tx: Prisma.TransactionClient,
  series: string,
  data: DocumentData,
  lines: FinancialDocumentLineDraft[]
) {
  const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>`INSERT INTO "FinancialDocumentSequence" ("series", "lastNumber", "updatedAt") VALUES (${series}, 1, NOW()) ON CONFLICT ("series") DO UPDATE SET "lastNumber" = "FinancialDocumentSequence"."lastNumber" + 1, "updatedAt" = NOW() RETURNING "lastNumber"`;
  const sequence = Number(rows[0]?.lastNumber);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new HttpError(500, 'Could not take the next document number. Try again.');
  }
  return tx.financialDocument.create({
    data: {
      ...data,
      series,
      sequence,
      number: formatDocumentNumber(series, sequence),
      lines: { create: lines.map((line, index) => ({ ...line, position: index + 1 })) }
    },
    select: { id: true, number: true }
  });
}

/** Lock a document row until the transaction ends. */
async function lockDocument(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "FinancialDocument" WHERE "id" = ${id} FOR UPDATE`;
}

/** One attempt, not held open: for Stripe calls a waiting flow must not stall on. */
const QUICK_STRIPE_REQUEST: Stripe.RequestOptions = { timeout: 8000, maxNetworkRetries: 0 };

/**
 * The card on a Stripe payment, for "Visa ending 4242", and when the charge
 * was made. Best effort and a single attempt: a slow or failed lookup leaves
 * the brand off the document rather than holding up the gift card flow that
 * is waiting on it.
 *
 * paidAt is the charge's created time — when the money moved — not the
 * PaymentIntent's, which is when checkout began and can be a day earlier.
 */
async function stripeCardDetails(paymentIntentId: string | null, code: string) {
  const none = { brand: null, last4: null, chargeId: null, paidAt: null };
  if (!paymentIntentId || !stripe) return none;
  try {
    const intent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ['latest_charge'] },
      QUICK_STRIPE_REQUEST
    );
    const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const card = charge?.payment_method_details?.card ?? null;
    return {
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      chargeId: charge?.id ?? (typeof intent.latest_charge === 'string' ? intent.latest_charge : null),
      paidAt: charge?.created ? new Date(charge.created * 1000) : null
    };
  } catch (error) {
    console.warn('[invoices] could not read the card from Stripe; issuing without it', {
      code: maskGiftCardCode(code),
      reason: reasonOf(error)
    });
    return none;
  }
}

// The ink wordmark, read once. Relative to the repo root in production and to
// apps/api when run from there in development.
let documentLogo: Uint8Array | null | undefined;
function documentLogoPng(): Uint8Array | null {
  if (documentLogo !== undefined) return documentLogo;
  const fileName = 'alma-group-logo-ink.png';
  const candidates = [
    join(process.cwd(), 'apps/giftcards-web/public/images/brand', fileName),
    join(process.cwd(), 'apps/giftcards-web/dist/images/brand', fileName),
    join(process.cwd(), '../giftcards-web/public/images/brand', fileName),
    join(process.cwd(), '../giftcards-web/dist/images/brand', fileName)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  try {
    documentLogo = found ? new Uint8Array(readFileSync(found)) : null;
  } catch (error) {
    console.warn('[invoices] could not read the brand logo', { file: found, reason: reasonOf(error) });
    documentLogo = null;
  }
  if (!documentLogo) console.warn('[invoices] Brand logo missing; documents print the ALMA wordmark in type', { fileName });
  return documentLogo;
}

function renderPdf(doc: FinancialDocumentDetail) {
  const contact = doc.issuerEmail ?? doc.issuerPhone;
  return renderFinancialDocumentPdf(doc, {
    logoPng: documentLogoPng(),
    footerLines: contact ? [`Questions about this document? Contact ${contact}.`] : []
  });
}

type DeliveryOutcome = { sent: true } | { sent: false; status: 502 | 503; reason: string };

/**
 * Render, send, and record what happened on the document. Never throws for a
 * delivery failure — the caller decides whether that is the user's problem
 * (a manager pressing Email) or only worth a log line (automatic issue).
 */
async function deliverDocument(doc: FinancialDocumentDetail, to: string): Promise<DeliveryOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = await renderPdf(doc);
  } catch (error) {
    console.error(`[invoices] could not render ${doc.number}`, { reason: reasonOf(error) });
    return { sent: false, status: 502, reason: 'The PDF could not be produced.' };
  }
  const result = await mailService.sendFinancialDocument({
    to,
    documentTitle: SHORT_TITLES[doc.type],
    number: doc.number,
    issuerName: doc.issuerTradingName ?? doc.issuerLegalName,
    customerName: doc.customerName,
    totalCents: doc.totalCents,
    gstCents: doc.gstCents,
    isCredit: isCreditDocument(doc.type),
    pdf: Buffer.from(bytes),
    filename: `${doc.number}.pdf`
  });
  if (result.status === 'sent') {
    await prisma.financialDocument.update({
      where: { id: doc.id },
      data: { emailedAt: new Date(), emailedTo: to, emailError: null, emailCount: { increment: 1 } }
    });
    return { sent: true };
  }
  const reason = result.status === 'skipped' ? 'Email is not configured.' : result.reason;
  await prisma.financialDocument.update({ where: { id: doc.id }, data: { emailError: reason.slice(0, 500) } });
  return { sent: false, status: result.status === 'skipped' ? 503 : 502, reason };
}

/**
 * The document exists whatever the email did, so the error says so — a
 * manager who reads only "failed" would issue it again.
 */
function issuedButNotEmailed(doc: FinancialDocumentDetail, reason: string) {
  const because = reason.trim().replace(/[.!?]?$/, '.');
  return new HttpError(
    502,
    `${SHORT_TITLES[doc.type]} ${doc.number} was issued, but the email did not send: ${because} Use Email on the document to try again.`,
    // The web reads THIS, never the status, to decide the document exists:
    // a 502 also comes from a proxy or a Stripe outage that issued nothing.
    { issued: true, documentId: doc.id, documentNumber: doc.number } satisfies IssuedButNotEmailedDetails
  );
}

function parseDay(value: string | undefined, edge: 'gte' | 'lt') {
  if (!value) return undefined;
  const bounds = venueDayBounds(value);
  if (!bounds) throw new HttpError(400, 'Enter dates as YYYY-MM-DD.');
  return bounds[edge];
}

function listWhere(input: {
  query?: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  legalEntityId?: string;
  giftCardCode?: string;
}): Prisma.FinancialDocumentWhereInput {
  const type = blank(input.type)?.toUpperCase();
  if (type && !FINANCIAL_DOCUMENT_TYPES.includes(type as FinancialDocumentType)) {
    throw new HttpError(400, 'Choose a document type from the list.');
  }
  const status = blank(input.status)?.toUpperCase();
  if (status && !FINANCIAL_DOCUMENT_STATUSES.includes(status as (typeof FINANCIAL_DOCUMENT_STATUSES)[number])) {
    throw new HttpError(400, 'Choose a status from the list.');
  }
  // Days are the venue's, like the dates printed on the documents.
  const from = parseDay(blank(input.from) ?? undefined, 'gte');
  const to = parseDay(blank(input.to) ?? undefined, 'lt');
  const query = blank(input.query);
  const giftCardCode = blank(input.giftCardCode);
  const where: Prisma.FinancialDocumentWhereInput = {};
  if (type) where.type = type as FinancialDocumentType;
  if (status) where.status = status as (typeof FINANCIAL_DOCUMENT_STATUSES)[number];
  if (from || to) where.issuedAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  if (blank(input.legalEntityId)) where.legalEntityId = blank(input.legalEntityId)!;
  if (giftCardCode) where.sourceReference = { equals: normaliseCode(giftCardCode), mode: 'insensitive' };
  if (query) {
    where.OR = [
      { number: { contains: query, mode: 'insensitive' } },
      { customerName: { contains: query, mode: 'insensitive' } },
      { customerOrganisation: { contains: query, mode: 'insensitive' } },
      { customerEmail: { contains: query, mode: 'insensitive' } },
      { sourceReference: { contains: query, mode: 'insensitive' } }
    ];
  }
  return where;
}

function entityCreateData(input: LegalEntityInput): Prisma.LegalEntityCreateInput {
  return {
    code: input.code.trim().toUpperCase(),
    legalName: input.legalName.trim(),
    tradingName: blank(input.tradingName),
    abn: normaliseAbn(input.abn),
    gstRegistered: input.gstRegistered,
    address: blank(input.address),
    email: blank(input.email)?.toLowerCase() ?? null,
    phone: blank(input.phone),
    website: blank(input.website),
    documentPrefix: input.documentPrefix,
    active: input.active
  };
}

function entityUpdateData(input: Partial<LegalEntityInput>): Prisma.LegalEntityUpdateInput {
  const data: Prisma.LegalEntityUpdateInput = {};
  if (input.code !== undefined) data.code = input.code.trim().toUpperCase();
  if (input.legalName !== undefined) data.legalName = input.legalName.trim();
  if (input.tradingName !== undefined) data.tradingName = blank(input.tradingName);
  if (input.abn !== undefined) data.abn = normaliseAbn(input.abn);
  if (input.gstRegistered !== undefined) data.gstRegistered = input.gstRegistered;
  if (input.address !== undefined) data.address = blank(input.address);
  if (input.email !== undefined) data.email = blank(input.email)?.toLowerCase() ?? null;
  if (input.phone !== undefined) data.phone = blank(input.phone);
  if (input.website !== undefined) data.website = blank(input.website);
  if (input.documentPrefix !== undefined) data.documentPrefix = input.documentPrefix;
  if (input.active !== undefined) data.active = input.active;
  return data;
}

type CreditNoteOptions = {
  stripeRefundId?: string;
  paidAt?: Date;
  issueSource?: 'MANUAL' | 'STRIPE_REFUND';
};

export const financialDocumentService = {
  isInvoiceOwner,

  async getSettings(user?: AuthUser | null): Promise<InvoiceSettingsResponse> {
    const settings = await readSettings();
    const entities = await prisma.legalEntity.findMany({ orderBy: [{ active: 'desc' }, { legalName: 'asc' }] });
    const issuer = entities.find((entity) => entity.id === settings.giftCardIssuingEntityId) ?? null;
    return {
      settings,
      entities: entities.map(toLegalEntity),
      canManage: isInvoiceOwner(user),
      setupIssue: setupIssueFor(settings, issuer)
    };
  },

  async updateSettings(input: unknown, user?: AuthUser | null): Promise<InvoiceSettingsResponse> {
    const patch = invoiceSettingsInputSchema.parse(input ?? {});
    const current = await readSettings();
    // A patch, not a replacement: a field the form did not send keeps its value.
    const next: InvoiceSettings = {
      giftCardIssuingEntityId:
        patch.giftCardIssuingEntityId !== undefined ? blank(patch.giftCardIssuingEntityId) : current.giftCardIssuingEntityId,
      autoIssueGiftCards: patch.autoIssueGiftCards ?? current.autoIssueGiftCards,
      autoEmail: patch.autoEmail ?? current.autoEmail,
      footerNote: patch.footerNote !== undefined ? blank(patch.footerNote) : current.footerNote,
      autoIssueFrom: current.autoIssueFrom
    };
    if (patch.giftCardIssuingEntityId !== undefined && next.giftCardIssuingEntityId) {
      const entity = await prisma.legalEntity.findUnique({ where: { id: next.giftCardIssuingEntityId } });
      if (!entity || !entity.active) {
        throw new HttpError(400, 'Choose an active company to issue gift card receipts.');
      }
    }
    if (next.autoIssueGiftCards && !next.giftCardIssuingEntityId) {
      throw new HttpError(
        400,
        'Automatic issuing needs a company to issue from. Choose the gift card issuing company, or turn automatic issuing off.'
      );
    }
    // Automatic issuing covers cards paid from the moment it was last turned
    // on, so switching it on — or back on after a pause — never sends
    // receipts for the sales of the weeks it was off.
    if (next.autoIssueGiftCards && (!current.autoIssueGiftCards || !current.autoIssueFrom)) {
      next.autoIssueFrom = new Date().toISOString();
    }
    await prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, invoiceSettings: next as unknown as Prisma.InputJsonValue },
      update: { invoiceSettings: next as unknown as Prisma.InputJsonValue }
    });
    console.info(
      `[invoices] settings updated issuer=${next.giftCardIssuingEntityId ?? 'none'} autoIssue=${next.autoIssueGiftCards} ` +
        `autoEmail=${next.autoEmail} by ${user?.email ?? user?.id ?? 'unknown'}`
    );
    return this.getSettings(user);
  },

  async listEntities(): Promise<LegalEntity[]> {
    const entities = await prisma.legalEntity.findMany({ orderBy: [{ active: 'desc' }, { legalName: 'asc' }] });
    return entities.map(toLegalEntity);
  },

  async createEntity(input: unknown): Promise<LegalEntity> {
    const parsed = legalEntityInputSchema.parse(input);
    try {
      return toLegalEntity(await prisma.legalEntity.create({ data: entityCreateData(parsed) }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'A company with that code already exists.');
      throw error;
    }
  },

  async updateEntity(id: string, input: unknown): Promise<LegalEntity> {
    const parsed = legalEntityUpdateSchema.parse(input ?? {});
    const existing = await prisma.legalEntity.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Company not found.');
    if (parsed.active === false && existing.active) {
      const settings = await readSettings();
      if (settings.giftCardIssuingEntityId === id) {
        throw new HttpError(
          409,
          `${existing.legalName} issues gift card receipts. Choose another issuing company in Settings before switching it off.`
        );
      }
    }
    try {
      return toLegalEntity(await prisma.legalEntity.update({ where: { id }, data: entityUpdateData(parsed) }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'A company with that code already exists.');
      throw error;
    }
  },

  /**
   * Issue the sale document for a gift card, or hand back the one it already
   * has. `created` says whether THIS call made it: the webhook, the success
   * page and the lifecycle sweep can all reach here for the same card at the
   * same moment, and only the one that created the document may email it.
   */
  async issueGiftCardSale(
    code: string,
    input: IssueGiftCardDocumentInput,
    actor: AuthUser | null | undefined,
    issueSource: FinancialDocumentIssueSource
  ): Promise<{ document: FinancialDocumentDetail; created: boolean }> {
    const card = await prisma.giftCard.findUnique({ where: { code: normaliseCode(code) } });
    if (!card) throw new HttpError(404, 'Gift card not found');
    const ineligible = giftCardDocumentIneligibleReason(card);
    if (ineligible) throw new HttpError(422, ineligible);

    const saleKey = giftCardSaleKey(card.id);
    const existing = await prisma.financialDocument.findUnique({ where: { saleKey }, select: { id: true } });
    if (existing) return { document: await this.get(existing.id), created: false };

    const settings = await readSettings();
    const { entity, setupIssue } = await resolveIssuer(settings);
    if (!entity) throw new HttpError(409, setupIssue ?? 'Invoicing is not set up yet.');

    let lines: FinancialDocumentLineDraft[];
    try {
      lines = applyIssuerGstStatus(
        composeGiftCardSaleLines({
          code: card.code,
          faceValueCents: card.initialValueCents,
          discountCents: card.discountCents,
          promoCode: promoCodeForDocument(card.promoCodeSnapshot),
          amountPaidCents: card.amountPaidCents,
          recipientName: card.recipientName
        }),
        entity.gstRegistered
      );
    } catch (error) {
      if (error instanceof FinancialDocumentError) throw new HttpError(422, error.message);
      throw error;
    }
    const totals = summariseLines(lines);
    const type = saleDocumentType(totals, entity.gstRegistered);
    const provider = paymentProviderForCard(card);
    const stripePaymentIntentId = stripePaymentIntentIdForCard(card);
    // Outside the transaction: a network call must never hold the number lock.
    const stripeCard = await stripeCardDetails(stripePaymentIntentId, card.code);
    const customerAbn = blank(input.customerAbn);

    const data: DocumentData = {
      type,
      status: 'ISSUED',
      gstTreatment: totals.gstTreatment,
      sourceType: 'GIFT_CARD',
      sourceId: card.id,
      sourceReference: card.code,
      saleKey,
      giftCardId: card.id,
      creditsDocumentId: null,
      legalEntityId: entity.id,
      // A snapshot: renaming the company later never rewrites an issued document.
      issuerLegalName: entity.legalName,
      issuerTradingName: entity.tradingName,
      issuerAbn: entity.abn,
      issuerAddress: entity.address,
      issuerEmail: entity.email,
      issuerPhone: entity.phone,
      issuerWebsite: entity.website,
      issuerGstRegistered: entity.gstRegistered,
      customerName: blank(input.customerName) ?? card.purchaserName,
      customerOrganisation: blank(input.customerOrganisation),
      customerAbn: customerAbn ? normaliseAbn(customerAbn) : null,
      customerEmail: blank(input.customerEmail)?.toLowerCase() ?? blank(card.purchaserEmail),
      customerReference: blank(input.customerReference),
      currency: card.currency,
      totalCents: totals.totalCents,
      taxableCents: totals.taxableCents,
      gstCents: totals.gstCents,
      paymentProvider: provider,
      paymentReference: blank(card.tenderReference),
      paymentMethodSummary: paymentMethodSummary(provider, stripeCard.brand, stripeCard.last4),
      stripePaymentIntentId,
      stripeCheckoutSessionId: stripeCheckoutSessionIdForDocument(card.stripeCheckoutSessionId),
      stripeChargeId: stripeCard.chargeId,
      stripeRefundId: null,
      // Stripe's charge time when it answered; the card's own paidAt (when
      // the webhook activated it) otherwise. The card row is left as it is.
      paidAt: stripeCard.paidAt ?? card.paidAt,
      supplyDate: stripeCard.paidAt ?? card.paidAt,
      issuedById: actor?.id ?? null,
      issueSource,
      reason: null,
      note: [blank(input.note), settings.footerNote].filter(Boolean).join('\n') || null,
      testMode: card.testMode
    };

    try {
      const created = await prisma.$transaction((tx) =>
        createNumberedDocument(tx, documentSeries(entity.documentPrefix, type), data, lines)
      );
      console.info(`[invoices] issued ${created.number} for gift card code=${maskGiftCardCode(card.code)} (${issueSource})`);
      // A refund made before this document existed is credited now; never on
      // the checkout path, where nothing can have been refunded yet
      // (lib/gift-card-documents.ts shouldReconcileRefundsOnIssue).
      if (stripePaymentIntentId && shouldReconcileRefundsOnIssue({ provider, stripePaymentIntentId, issueSource })) {
        await this.reconcileStripeRefundsQuietly({ id: created.id, number: created.number, stripePaymentIntentId }, card.code);
      }
      return { document: await this.get(created.id), created: true };
    } catch (error) {
      // Lost the race to the saleKey latch. The winner's document is the one;
      // this attempt's number went back with its rollback.
      if (isUniqueViolation(error, 'saleKey')) {
        const winner = await prisma.financialDocument.findUnique({ where: { saleKey }, select: { id: true } });
        if (winner) return { document: await this.get(winner.id), created: false };
      }
      throw error;
    }
  },

  /** Issue by hand from the gift card screens (or on behalf of a job). */
  async issueForGiftCard(
    code: string,
    input: unknown,
    actor?: AuthUser | null,
    issueSource: FinancialDocumentIssueSource = 'MANUAL'
  ): Promise<FinancialDocumentDetail> {
    const parsed = issueGiftCardDocumentInputSchema.parse(input ?? {});
    const { document, created } = await this.issueGiftCardSale(code, parsed, actor, issueSource);
    if (!created) {
      // Someone pressing Issue expects a new document; handing back the old
      // one as if it were new would hide that the details they typed were
      // never used. The automatic paths just want to know one exists.
      if (issueSource === 'MANUAL') {
        throw new HttpError(
          409,
          `${document.number} was already issued for this card. Email it from its row, or void it and issue again to change the details.`
        );
      }
      return document;
    }
    if (issueSource !== 'MANUAL') {
      const settings = await readSettings();
      if (settings.autoEmail) await this.emailQuietly(document);
      return this.get(document.id);
    }
    if (!parsed.email) return document;
    const to = blank(parsed.emailTo) ?? document.customerEmail;
    if (!to) throw issuedButNotEmailed(document, 'there is no email address for this customer');
    const outcome = await deliverDocument(document, to);
    if (!outcome.sent) throw issuedButNotEmailed(document, outcome.reason);
    return this.get(document.id);
  },

  /** Email an automatically issued document; a failure is logged and recorded, never thrown. */
  async emailQuietly(document: FinancialDocumentDetail) {
    try {
      if (!document.customerEmail) {
        console.warn(`[invoices] ${document.number} not emailed: no customer email`);
        return;
      }
      const outcome = await deliverDocument(document, document.customerEmail);
      if (!outcome.sent) console.warn(`[invoices] ${document.number} not emailed: ${outcome.reason}`);
    } catch (error) {
      console.error(`[invoices] ${document.number} email threw`, { reason: reasonOf(error) });
    }
  },

  /**
   * The automatic hook, called from the gift card checkout handler once a card
   * is ACTIVE. It must never break or slow that flow: one best-effort attempt,
   * everything caught and logged. A card it misses is picked up by the
   * catch-up job.
   */
  async issueAfterStripePayment(giftCardId: string): Promise<void> {
    let code = giftCardId;
    try {
      const settings = await readSettings();
      if (!settings.autoIssueGiftCards) return;
      const card = await prisma.giftCard.findUnique({
        where: { id: giftCardId },
        select: { code: true, status: true, testMode: true, amountPaidCents: true, paidAt: true, tender: true }
      });
      if (!card) return;
      code = card.code;
      const { setupIssue } = await resolveIssuer(settings);
      if (setupIssue) {
        console.info(`[invoices] auto-issue skipped for code=${maskGiftCardCode(code)}: no issuing company is set up`);
        return;
      }
      const ineligible = giftCardDocumentIneligibleReason(card);
      if (ineligible) {
        console.info(`[invoices] auto-issue skipped for code=${maskGiftCardCode(code)}: ${ineligible}`);
        return;
      }
      const { document, created } = await this.issueGiftCardSale(code, issueGiftCardDocumentInputSchema.parse({}), null, 'AUTO_STRIPE');
      if (created && settings.autoEmail) await this.emailQuietly(document);
    } catch (error) {
      console.error(`[invoices] auto-issue failed for code=${maskGiftCardCode(code)}`, { reason: reasonOf(error) });
    }
  },

  /**
   * Scheduler entry: issue for paid Stripe cards the automatic hook missed (a
   * webhook that never came, an outage mid-issue). Only cards paid since
   * automatic issuing was switched on, and only cards that have never had a
   * sale document — a voided one included, because voiding is a person's
   * decision the job must not undo by reissuing behind them.
   */
  async catchUpGiftCardDocuments() {
    const generatedAt = new Date().toISOString();
    const settings = await readSettings();
    const skipped = (skippedReason: string) => ({ eligible: 0, issued: 0, failed: 0, skippedReason, generatedAt });
    if (!settings.autoIssueGiftCards) return skipped('Automatic issuing is off.');
    const { setupIssue } = await resolveIssuer(settings);
    if (setupIssue) return skipped(setupIssue);
    if (!settings.autoIssueFrom) return skipped('Automatic issuing has no start date yet.');

    const where: Prisma.GiftCardWhereInput = {
      paidAt: { gte: new Date(settings.autoIssueFrom) },
      testMode: false,
      amountPaidCents: { gt: 0 },
      status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      // The population the automatic hook covers: paid through Stripe
      // Checkout. Counter and POS sales already have their own receipt and
      // are issued by hand when someone asks.
      tender: 'STRIPE',
      stripeCheckoutSessionId: { startsWith: 'cs_' },
      financialDocuments: { none: { type: { in: SALE_TYPES } } }
    };
    const [eligible, cards] = await Promise.all([
      prisma.giftCard.count({ where }),
      prisma.giftCard.findMany({ where, orderBy: { paidAt: 'asc' }, take: CATCH_UP_BATCH, select: { code: true } })
    ]);
    let issued = 0;
    let failed = 0;
    for (const card of cards) {
      try {
        const { document, created } = await this.issueGiftCardSale(card.code, issueGiftCardDocumentInputSchema.parse({}), null, 'CATCH_UP');
        if (!created) continue;
        issued += 1;
        if (settings.autoEmail) await this.emailQuietly(document);
      } catch (error) {
        failed += 1;
        console.error(`[invoices] catch-up could not issue for code=${maskGiftCardCode(card.code)}`, { reason: reasonOf(error) });
      }
    }
    return { eligible, issued, failed, skippedReason: null, generatedAt };
  },

  async list(input: {
    query?: string;
    type?: string;
    status?: string;
    from?: string;
    to?: string;
    legalEntityId?: string;
    giftCardCode?: string;
  }): Promise<FinancialDocumentListResponse> {
    const where = listWhere(input);
    const [rows, count, sales, credits] = await Promise.all([
      prisma.financialDocument.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        take: LIST_CAP,
        include: summaryInclude
      }),
      prisma.financialDocument.count({ where }),
      // Totals over the whole filter, not the capped page, so the strip never
      // quietly sums only the newest 200.
      prisma.financialDocument.aggregate({
        where: { AND: [where, { status: 'ISSUED', type: { in: SALE_TYPES } }] },
        _sum: { totalCents: true, gstCents: true }
      }),
      prisma.financialDocument.aggregate({
        where: { AND: [where, { status: 'ISSUED', type: { in: CREDIT_TYPES } }] },
        _sum: { totalCents: true, gstCents: true }
      })
    ]);
    return {
      documents: rows.map(toSummary),
      totals: {
        count,
        netTotalCents: (sales._sum.totalCents ?? 0) - (credits._sum.totalCents ?? 0),
        netGstCents: (sales._sum.gstCents ?? 0) - (credits._sum.gstCents ?? 0)
      },
      capped: count > rows.length
    };
  },

  async get(id: string): Promise<FinancialDocumentDetail> {
    const row = await prisma.financialDocument.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new HttpError(404, 'Document not found.');
    const issuedBy = row.issuedById
      ? await prisma.staffProfile.findUnique({ where: { id: row.issuedById }, select: { firstName: true, lastName: true } })
      : null;
    return toDetail(row, issuedBy ? `${issuedBy.firstName} ${issuedBy.lastName}`.trim() : null);
  },

  async forGiftCard(code: string): Promise<GiftCardDocumentsResponse> {
    const card = await prisma.giftCard.findUnique({
      where: { code: normaliseCode(code) },
      select: { id: true, code: true, status: true, testMode: true, amountPaidCents: true, paidAt: true, tender: true }
    });
    if (!card) throw new HttpError(404, 'Gift card not found');
    const rows = await prisma.financialDocument.findMany({
      where: { giftCardId: card.id },
      orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
      include: summaryInclude
    });
    return {
      giftCardId: card.id,
      code: card.code,
      ineligibleReason: giftCardDocumentIneligibleReason(card),
      documents: rows.map(toSummary)
    };
  },

  async pdf(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const doc = await this.get(id);
    return { filename: `${doc.number}.pdf`, bytes: await renderPdf(doc) };
  },

  async email(id: string, input: unknown): Promise<FinancialDocumentSummary> {
    const parsed = emailFinancialDocumentInputSchema.parse(input ?? {});
    const doc = await this.get(id);
    const to = blank(parsed.to) ?? doc.customerEmail;
    if (!to) throw new HttpError(400, 'There is no email address on this document. Enter one to send it to.');
    const outcome = await deliverDocument(doc, to);
    if (!outcome.sent) {
      throw new HttpError(outcome.status, outcome.status === 503 ? 'Email is not configured.' : `The email did not send: ${outcome.reason}`);
    }
    const row = await prisma.financialDocument.findUniqueOrThrow({ where: { id }, include: summaryInclude });
    return toSummary(row);
  },

  /**
   * Raise a credit or adjustment note against a sale document. `created` is
   * false when a Stripe refund already has its note (a replayed webhook).
   *
   * A Stripe refund is credited on its refund id, whichever way it arrives:
   * the webhook passes it in `options`, a person types it on the form
   * (creditNoteInputSchema requires it for refund method Stripe). The id is
   * unique on FinancialDocument, so one refund can never be credited twice —
   * by hand and then again when Stripe's event lands.
   */
  async raiseCreditNote(
    saleDocumentId: string,
    input: unknown,
    actor: AuthUser | null | undefined,
    options: CreditNoteOptions = {}
  ): Promise<{ document: FinancialDocumentDetail; created: boolean; email: boolean }> {
    const parsed = creditNoteInputSchema.parse(input);
    const issueSource = options.issueSource ?? 'MANUAL';
    const stripeRefundId = options.stripeRefundId ?? (parsed.refundMethod === 'STRIPE' ? blank(parsed.stripeRefundId) : null);
    // A replayed webhook is told quietly that the note exists; a person is
    // told which note already covers the refund they typed.
    const alreadyCredited = (number: string) =>
      new HttpError(409, `Stripe refund ${stripeRefundId} is already credited by ${number}.`);
    // A form resubmitted after a lost response: the same request id finds the
    // note the first submission raised, so the retry is safe.
    const clientRequestId = issueSource === 'MANUAL' ? parsed.clientRequestId ?? null : null;
    let result: { id: string; created: boolean };
    try {
      result = await prisma.$transaction(async (tx) => {
        // Hold the sale document for the whole transaction. Two credits at
        // once — a manager and a refund webhook, or the three events Stripe
        // sends for one refund — must each see the other, or together they
        // could credit more than was paid.
        await lockDocument(tx, saleDocumentId);
        if (clientRequestId) {
          const repeat = await tx.financialDocument.findUnique({ where: { clientRequestId }, select: { id: true } });
          if (repeat) return { id: repeat.id, created: false };
        }
        if (stripeRefundId) {
          // Only a LIVE note holds the latch; a voided one keeps the refund id
          // for the record but no longer counts as crediting it.
          const already = await tx.financialDocument.findUnique({
            where: { stripeRefundLatch: stripeRefundId },
            select: { id: true, number: true }
          });
          if (already) {
            if (issueSource === 'MANUAL') throw alreadyCredited(already.number);
            return { id: already.id, created: false };
          }
        }
        const original = await tx.financialDocument.findUnique({
          where: { id: saleDocumentId },
          include: { credits: { where: { status: 'ISSUED' }, select: { totalCents: true, taxableCents: true, gstCents: true } } }
        });
        if (!original) throw new HttpError(404, 'Document not found.');
        if (isCreditDocument(original.type)) {
          throw new HttpError(409, 'A credit note can only be raised against a receipt or tax invoice.');
        }
        if (original.status !== 'ISSUED') throw new HttpError(409, `${original.number} is void, so it cannot be credited.`);

        let lines: FinancialDocumentLineDraft[];
        try {
          lines = composeCreditLines(original, original.credits, parsed.amountCents);
        } catch (error) {
          if (error instanceof FinancialDocumentError) throw new HttpError(422, error.message);
          throw error;
        }
        const totals = summariseLines(lines);
        const type = creditDocumentType(original.type);
        // A Stripe refund goes back to the card it came from.
        const stripeRefund = parsed.refundMethod === 'STRIPE';
        const data: DocumentData = {
          type,
          status: 'ISSUED',
          gstTreatment: totals.gstTreatment,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          sourceReference: original.sourceReference,
          saleKey: null,
          giftCardId: original.giftCardId,
          creditsDocumentId: original.id,
          // The original's issuer, not today's settings: the credit reduces
          // that company's sale.
          legalEntityId: original.legalEntityId,
          issuerLegalName: original.issuerLegalName,
          issuerTradingName: original.issuerTradingName,
          issuerAbn: original.issuerAbn,
          issuerAddress: original.issuerAddress,
          issuerEmail: original.issuerEmail,
          issuerPhone: original.issuerPhone,
          issuerWebsite: original.issuerWebsite,
          issuerGstRegistered: original.issuerGstRegistered,
          customerName: original.customerName,
          customerOrganisation: original.customerOrganisation,
          customerAbn: original.customerAbn,
          customerEmail: original.customerEmail,
          customerReference: original.customerReference,
          currency: original.currency,
          totalCents: totals.totalCents,
          taxableCents: totals.taxableCents,
          gstCents: totals.gstCents,
          paymentProvider: parsed.refundMethod,
          paymentReference: blank(parsed.refundReference),
          paymentMethodSummary:
            stripeRefund && original.paymentProvider === 'STRIPE'
              ? original.paymentMethodSummary ?? 'Stripe'
              : paymentMethodSummary(parsed.refundMethod),
          stripePaymentIntentId: stripeRefund ? original.stripePaymentIntentId : null,
          stripeCheckoutSessionId: null,
          stripeChargeId: null,
          stripeRefundId: stripeRefundId ?? null,
          stripeRefundLatch: stripeRefundId ?? null,
          clientRequestId,
          paidAt: options.paidAt ?? new Date(),
          supplyDate: original.supplyDate,
          issuedById: actor?.id ?? null,
          issueSource,
          reason: parsed.reason,
          note: null,
          testMode: original.testMode
        };
        const created = await createNumberedDocument(tx, creditSeriesFor(original.series), data, lines);
        return { id: created.id, created: true };
      });
    } catch (error) {
      if (clientRequestId && isUniqueViolation(error, 'clientRequestId')) {
        const repeat = await prisma.financialDocument.findUnique({ where: { clientRequestId }, select: { id: true } });
        if (repeat) return { document: await this.get(repeat.id), created: false, email: false };
      }
      if (stripeRefundId && isUniqueViolation(error, 'stripeRefundLatch')) {
        const winner = await prisma.financialDocument.findUnique({ where: { stripeRefundLatch: stripeRefundId }, select: { id: true, number: true } });
        if (winner) {
          if (issueSource === 'MANUAL') throw alreadyCredited(winner.number);
          return { document: await this.get(winner.id), created: false, email: false };
        }
      }
      throw error;
    }
    const document = await this.get(result.id);
    if (result.created) {
      console.info(
        `[invoices] credited ${document.creditsDocumentNumber} with ${document.number} (${document.totalCents}c, ${issueSource})`
      );
    }
    return { document, created: result.created, email: parsed.email };
  },

  /**
   * Check a Stripe refund id typed on the credit note form against Stripe:
   * it must be a succeeded refund of this sale's payment, and the credit no
   * more than it. Without Stripe (or for a sale Stripe never saw) the id is
   * taken on its shape alone — the unique id still stops a second note.
   */
  async verifyManualStripeRefund(saleDocumentId: string, refundId: string, amountCents: number): Promise<CreditNoteOptions> {
    const sale = await prisma.financialDocument.findUnique({
      where: { id: saleDocumentId },
      select: { number: true, stripePaymentIntentId: true }
    });
    if (!sale) throw new HttpError(404, 'Document not found.');
    if (!stripe || !sale.stripePaymentIntentId) return { stripeRefundId: refundId };
    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.retrieve(refundId, {}, QUICK_STRIPE_REQUEST);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
        throw new HttpError(422, `Stripe has no refund ${refundId}. Copy the refund id (re_…) from the payment in Stripe.`);
      }
      console.warn(`[invoices] could not check Stripe refund ${refundId} for ${sale.number}`, { reason: reasonOf(error) });
      // 503, not 502: the web reads a 502 from this route as "the note was
      // issued and only the email failed" and closes the form. Nothing has
      // been issued here, so the form must stay open for a retry.
      throw new HttpError(503, 'Could not check the refund with Stripe. Nothing was issued — try again in a moment.');
    }
    const refundIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null;
    if (refundIntent !== sale.stripePaymentIntentId) {
      throw new HttpError(422, `Stripe refund ${refundId} is not a refund of the payment on ${sale.number}.`);
    }
    if (refund.status !== 'succeeded') {
      throw new HttpError(
        422,
        `Stripe refund ${refundId} has not gone through (it is ${refund.status ?? 'unknown'}). Credit it once Stripe shows it as succeeded.`
      );
    }
    if (amountCents > refund.amount) {
      throw new HttpError(
        422,
        `Stripe refund ${refundId} was ${centsToDollars(refund.amount)}, so a credit note for it cannot be more than that.`
      );
    }
    return { stripeRefundId: refundId, paidAt: new Date(refund.created * 1000) };
  },

  /** Credit by hand. Never touches the gift card itself — cancelling it stays its own action. */
  async createCreditNote(
    saleDocumentId: string,
    input: unknown,
    actor?: AuthUser | null,
    options: CreditNoteOptions = {}
  ): Promise<FinancialDocumentDetail> {
    const parsed = creditNoteInputSchema.parse(input);
    const refundId = parsed.refundMethod === 'STRIPE' ? blank(parsed.stripeRefundId) : null;
    // Outside the transaction: a network call must never hold the sale lock.
    const verified =
      refundId && !options.stripeRefundId ? await this.verifyManualStripeRefund(saleDocumentId, refundId, parsed.amountCents) : {};
    const { document, created, email } = await this.raiseCreditNote(saleDocumentId, parsed, actor, { ...verified, ...options });
    if (!created || !email) return document;
    if (!document.customerEmail) throw issuedButNotEmailed(document, 'there is no email address for this customer');
    const outcome = await deliverDocument(document, document.customerEmail);
    if (!outcome.sent) throw issuedButNotEmailed(document, outcome.reason);
    return this.get(document.id);
  },

  /**
   * Credit every refund in `refunds` (all of one payment's Stripe refunds)
   * that has succeeded and has no live credit note, against `sale`. Each
   * note is raised under the sale's row lock and keyed on the refund id, so
   * running this twice at once, or alongside a person crediting by hand,
   * credits each refund once. Business refusals (more than is left to
   * credit, the sale was voided) are logged and skipped.
   *
   * Takes the refunds rather than asking Stripe so it can be exercised
   * without Stripe; reconcileStripeRefunds is the caller that asks.
   */
  async creditStripeRefunds(sale: { id: string; number: string }, refunds: StripeRefundFacts[]) {
    const existing = refunds.length
      ? await prisma.financialDocument.findMany({
          where: { stripeRefundId: { in: refunds.map((refund) => refund.id) } },
          select: { stripeRefundId: true, number: true, status: true }
        })
      : [];
    const plan = planStripeRefundCredits(refunds, existing);
    // Stripe can fail a refund after reporting it succeeded. The note stays
    // (documents are not silently rewritten); the owner decides.
    for (const { refund, noteNumber } of plan.failedButCredited) {
      console.warn(
        `[invoices] Stripe refund ${refund.id} is now ${refund.status} but ${noteNumber} still stands. Void it if the money did not go back.`
      );
    }
    const credited: string[] = [];
    const skipped: Array<{ refundId: string; reason: string }> = [];
    for (const refund of plan.toCredit) {
      try {
        const { document, created } = await this.raiseCreditNote(
          sale.id,
          { amountCents: refund.amount, reason: stripeRefundCreditReason(refund), refundMethod: 'STRIPE', stripeRefundId: refund.id, email: false },
          null,
          { stripeRefundId: refund.id, paidAt: new Date(refund.created * 1000), issueSource: 'STRIPE_REFUND' }
        );
        if (created) credited.push(document.number);
      } catch (error) {
        // A ZodError here is a refund id the credit note schema will not take
        // (Stripe gives some non-card refunds a pyr_ id): it can never be
        // credited automatically, so retrying the webhook would not help.
        if ((error instanceof HttpError && error.statusCode < 500) || error instanceof ZodError) {
          console.warn(`[invoices] Stripe refund ${refund.id} on ${sale.number} not credited: ${error.message}`);
          skipped.push({ refundId: refund.id, reason: error.message });
          continue;
        }
        throw error;
      }
    }
    return { credited, skipped };
  },

  /** Ask Stripe for a payment's refunds and credit the ones with no note. */
  async reconcileStripeRefunds(
    sale: { id: string; number: string; stripePaymentIntentId: string },
    requestOptions?: Stripe.RequestOptions
  ) {
    if (!stripe) return { credited: [] as string[], skipped: [] as Array<{ refundId: string; reason: string }> };
    const refunds = await stripe.refunds.list({ payment_intent: sale.stripePaymentIntentId, limit: 100 }, requestOptions);
    return this.creditStripeRefunds(sale, refunds.data);
  },

  /**
   * reconcileStripeRefunds for a sale document that was just issued. One
   * short attempt, never thrown: it runs inside the issue and checkout flows,
   * and a refund it misses is still credited by the next refund event.
   */
  async reconcileStripeRefundsQuietly(sale: { id: string; number: string; stripePaymentIntentId: string }, code: string) {
    if (!stripe) return;
    try {
      const { credited, skipped } = await this.reconcileStripeRefunds(sale, QUICK_STRIPE_REQUEST);
      if (credited.length || skipped.length) {
        console.info(
          `[invoices] ${sale.number} (code=${maskGiftCardCode(code)}) had earlier Stripe refunds: credited ${credited.join(', ') || 'none'}` +
            (skipped.length ? `, ${skipped.length} not credited` : '')
        );
      }
    } catch (error) {
      console.warn(`[invoices] could not check Stripe for refunds on ${sale.number} (code=${maskGiftCardCode(code)})`, {
        reason: reasonOf(error)
      });
    }
  },

  /**
   * Credit what Stripe refunded. Called for charge.refunded, refund.created
   * and refund.updated — one refund sends all three, so this reconciles the
   * payment's refunds against the notes that exist rather than trusting the
   * event it was handed. Business refusals (already credited by hand, the
   * sale was voided) are logged and skipped: a throw makes Stripe retry for
   * days a request that can never succeed.
   */
  async handleStripeRefund(object: Stripe.Charge | Stripe.Refund) {
    const intent = object.payment_intent;
    const paymentIntentId = typeof intent === 'string' ? intent : intent?.id ?? null;
    if (!paymentIntentId) return { skipped: 'no payment intent' };
    const sale = await prisma.financialDocument.findFirst({
      where: { stripePaymentIntentId: paymentIntentId, status: 'ISSUED', type: { in: SALE_TYPES } },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, number: true }
    });
    if (!sale) return { skipped: 'no document' };
    if (!stripe) {
      console.warn(`[invoices] refund on ${sale.number} not credited: Stripe is not configured`);
      return { skipped: 'stripe not configured' };
    }
    const { credited, skipped } = await this.reconcileStripeRefunds({ ...sale, stripePaymentIntentId: paymentIntentId });
    return { paymentIntentId, document: sale.number, credited, skipped };
  },

  async void(id: string, input: unknown, actor?: AuthUser | null): Promise<FinancialDocumentDetail> {
    const parsed = voidFinancialDocumentInputSchema.parse(input);
    const number = await prisma.$transaction(async (tx) => {
      // Same lock a credit note takes, so a void and a credit cannot cross.
      await lockDocument(tx, id);
      const doc = await tx.financialDocument.findUnique({
        where: { id },
        select: { type: true, status: true, number: true }
      });
      if (!doc) throw new HttpError(404, 'Document not found.');
      if (doc.status !== 'ISSUED') throw new HttpError(409, `${doc.number} is already void.`);
      if (!isCreditDocument(doc.type)) {
        const liveCredits = await tx.financialDocument.count({ where: { creditsDocumentId: id, status: 'ISSUED' } });
        if (liveCredits > 0) {
          throw new HttpError(409, `${doc.number} has credit notes against it. Void its credit notes first.`);
        }
      }
      await tx.financialDocument.update({
        where: { id },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidedById: actor?.id ?? null,
          voidReason: parsed.reason,
          // The latches go; the record stays. Releasing saleKey lets a
          // corrected document be issued for the card. Releasing
          // stripeRefundLatch lets the refund be credited again against the
          // live (or reissued) sale — while stripeRefundId, the link to the
          // real Stripe refund, is kept on this void note for good.
          saleKey: null,
          stripeRefundLatch: null
        }
      });
      return doc.number;
    });
    console.info(`[invoices] voided ${number} by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return this.get(id);
  }
};
