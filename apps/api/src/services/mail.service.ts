import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { rosterShiftLine } from '@alma/shared';

/**
 * The ALMA wordmark, in the ink that suits the surface behind it. Always the
 * real artwork — never a font-and-letter-spacing recreation of it.
 */
function brandLogo(variant: 'cream' | 'ink') {
  const fileName = `alma-group-logo-${variant}.png`;
  const candidates = [
    join(process.cwd(), 'apps/giftcards-web/public/images/brand', fileName),
    join(process.cwd(), 'apps/giftcards-web/dist/images/brand', fileName)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    console.warn('[mail] Brand logo missing, falling back to the type lockup', { fileName });
    return null;
  }
  return readFileSync(found);
}

type InviteEmailInput = {
  to: string;
  firstName: string;
  roleTitle: string;
  venue?: string | null;
  note?: string | null;
  inviteLink: string;
  expiresAt: Date;
  /**
   * Handbook documents to send with the invite.
   *
   * A new starter gets one email before their first shift, so whatever they
   * need to read has to be in it. The caller decides which documents apply to
   * their venue; this just carries them.
   */
  attachments?: EmailAttachment[];
};

type GiftCardEmailInput = {
  to: string;
  purchaserName: string;
  recipientName?: string | null;
  code: string;
  amountCents: number;
  balanceCents: number;
  message?: string | null;
  printableUrl: string;
  qrCodeUrl?: string | null;
  redeemUrl?: string | null;
  appleWalletUrl?: string | null;
  googleWalletUrl?: string | null;
  design?: string | null;
  expiresAt?: Date | null;
  settings?: {
    emailSubject?: string;
    emailIntro?: string;
    artworkUrl?: string;
    primaryColor?: string;
    accentColor?: string;
  };
  // "Create your own": the customer's rendered card image. When present it
  // replaces the generated SVG attachment and appears inline via the hosted
  // URL (data-URI images get stripped by Gmail/Outlook; hosted URLs don't).
  customArtwork?: { data: Buffer; mimeType: string; url: string };
};

type PasswordResetEmailInput = {
  to: string;
  firstName?: string | null;
  resetLink: string;
  expiresAt: Date;
  appName?: string | null;
};

type WelcomeEmailInput = {
  to: string;
  firstName?: string | null;
  loginUrl?: string | null;
  resetLink: string;
  expiresAt: Date;
  appName?: string | null;
};

type EmailDeliveryResult =
  | { status: 'sent'; to: string; provider: 'resend' | 'smtp'; providerMessageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
  /**
   * Set to embed the attachment in the body as `cid:<contentId>` rather than
   * listing it as a download. Inline images render without the recipient
   * having to click "load remote images", which a hosted URL would need.
   */
  contentId?: string;
};

const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM ?? process.env.MAIL_FROM;
const resendApiUrl = process.env.RESEND_API_URL ?? 'https://api.resend.com/emails';
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
const mailFrom = process.env.MAIL_FROM ?? smtpUser;
const replyTo = process.env.MAIL_REPLY_TO ?? mailFrom;

// Brand red — matches the compliance accent in apps/web/src/styles.css and the
// AlmaLogo gradient. Centralised here so it can't drift from the rest of the
// app the next time the brand colour shifts.
const BRAND_ACCENT = '#B3262E';

function isResendConfigured() {
  return Boolean(resendApiKey && resendFrom);
}

function isSmtpConfigured() {
  return Boolean(smtpHost && smtpUser && smtpPass && mailFrom);
}

const transporter = isSmtpConfigured()
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })
  : null;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

/**
 * Designs the email knows how to colour — the current set plus the retired
 * ones, which an older row can still name. Anything else falls through to the
 * settings colours rather than being forced into a design it is not.
 */
const EMAIL_KNOWN_DESIGNS = [
  'heritage', 'bold', 'minimal', 'thanks', 'birthday', 'congrats', 'love', 'celebrate',
  'forest', 'shell', 'avalon', 'stalma', 'summer'
];

function normaliseGiftCardDesign(value: string | null | undefined) {
  return EMAIL_KNOWN_DESIGNS.includes(value ?? '') ? value! : 'heritage';
}

/**
 * Email colours for a design.
 *
 * The email cannot use the real artwork — mail clients have no CSS masks and
 * no background-clip — so it renders a simplified card in the design's own
 * colours. Kept in step with cardArt/palettes.ts by hand; the two cannot share
 * code across the API/web boundary, so the pairing is stated here explicitly.
 *
 * Retired designs still map, because an old row can still name one.
 */
/** Relative luminance test, so ink colour follows whatever sits behind it. */
function isDarkHex(hex: string) {
  const value = hex.replace('#', '');
  if (value.length !== 6) return true;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

function giftCardPalette(design: string | null | undefined, primaryColor: string, accentColor: string) {
  const heritage = { background: '#1a2717', foreground: '#efe0cf', accent: '#e7cd8b', label: 'Heritage' };
  const bold = { background: '#f5dcce', foreground: '#22301f', accent: '#4a5c40', label: 'Bold' };
  const minimal = { background: '#efe8db', foreground: '#4a3f3a', accent: '#8a736b', label: 'Minimal' };

  switch (normaliseGiftCardDesign(design)) {
    case 'bold':
    case 'birthday':
    case 'celebrate':
    // Retired, mapped the same way the web artwork maps them.
    case 'summer':
      return bold;
    case 'minimal':
    case 'congrats':
    case 'shell':
    case 'stalma':
      return minimal;
    case 'heritage':
    case 'thanks':
    case 'love':
    case 'forest':
    case 'avalon':
      return heritage;
    default:
      return {
        background: primaryColor || heritage.background,
        foreground: heritage.foreground,
        accent: accentColor || heritage.accent,
        label: heritage.label
      };
  }
}

function giftCardArtworkSvg(input: GiftCardEmailInput, amount: string, balance: string, expiry: string | null) {
  const palette = giftCardPalette(input.design, input.settings?.primaryColor ?? '#1f3524', input.settings?.accentColor ?? '#b98216');
  const recipient = input.recipientName?.trim() || input.purchaserName;
  const safeRecipient = escapeHtml(recipient);
  const safeCode = escapeHtml(input.code);
  const safeAmount = escapeHtml(amount);
  const safeBalance = escapeHtml(balance);
  const safeExpiry = expiry ? escapeHtml(expiry) : '3 years from issue';
  const safeLabel = escapeHtml(palette.label);
  // Cream ink on the dark heritage card, dark ink on the light designs. Read
  // from the background itself so a custom brand colour picks correctly too.
  const logo = brandLogo(isDarkHex(palette.background) ? 'cream' : 'ink');
  const wordmark = logo
    ? `<image x="94" y="188" width="340" height="175" href="data:image/png;base64,${logo.toString('base64')}"/>`
    : `<text x="94" y="272" fill="${palette.foreground}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="118" font-weight="900" letter-spacing="-5">alma</text>
  <text x="104" y="330" fill="${palette.foreground}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="26">GROUP</text>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="756" viewBox="0 0 1200 756">
  <rect width="1200" height="756" rx="34" fill="${palette.background}"/>
  <rect x="30" y="30" width="1140" height="696" rx="22" fill="none" stroke="${palette.accent}" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="1020" cy="620" r="280" fill="${palette.accent}" opacity="0.08"/>
  <text x="94" y="110" fill="${palette.foreground}" opacity="0.7" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" letter-spacing="9">GIFT CARD</text>
  ${wordmark}
  <text x="94" y="438" fill="${palette.foreground}" opacity="0.8" font-family="Georgia, serif" font-size="34" font-style="italic">For ${safeRecipient}</text>
  <text x="94" y="510" fill="${palette.foreground}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="8">${safeLabel}</text>
  <rect x="812" y="84" width="260" height="88" rx="44" fill="${palette.foreground}" opacity="0.14"/>
  <text x="942" y="140" text-anchor="middle" fill="${palette.foreground}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800">${safeAmount}</text>
  <rect x="94" y="584" width="450" height="76" rx="18" fill="${palette.foreground}" opacity="0.12" stroke="${palette.accent}" stroke-opacity="0.4"/>
  <text x="122" y="633" fill="${palette.foreground}" font-family="Courier New, monospace" font-size="31" font-weight="700" letter-spacing="8">${safeCode}</text>
  <text x="812" y="618" fill="${palette.foreground}" opacity="0.7" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="7">BALANCE</text>
  <text x="812" y="666" fill="${palette.foreground}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800">${safeBalance}</text>
  <text x="94" y="704" fill="${palette.foreground}" opacity="0.62" font-family="Arial, Helvetica, sans-serif" font-size="20">Redeem at Alma Avalon and St Alma Freshwater. Expires ${safeExpiry}.</text>
</svg>`.trim();
}

async function deliverEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  /**
   * Overrides the house sender for this message.
   *
   * The default is the operational address staff mail goes out from, which is
   * right for a roster reminder and wrong for a customer who just paid for a
   * gift card — they should hear from the venue, not from onboarding@.
   */
  from?: string;
  /**
   * Overrides the house reply-to for this message. A guest answering an
   * enquiry has to land back in the enquiries mailbox the poller reads, not
   * in whatever address staff mail replies to.
   */
  replyTo?: string;
  /**
   * Extra RFC 5322 headers. `In-Reply-To` and `References` are what make a
   * reply attach to the guest's existing conversation instead of starting a
   * fresh one in their client.
   */
  headers?: Record<string, string>;
}): Promise<EmailDeliveryResult> {
  const sender = input.from?.trim() || resendFrom;
  if (resendApiKey && sender) {
    try {
      const attachments = input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.isBuffer(attachment.content)
          ? attachment.content.toString('base64')
          : Buffer.from(attachment.content).toString('base64'),
        content_type: attachment.contentType,
        ...(attachment.contentId
          ? { content_id: attachment.contentId, disposition: 'inline' as const }
          : {})
      }));
      const response = await fetch(resendApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: sender,
          to: [input.to],
          reply_to: input.replyTo?.trim() || replyTo || undefined,
          subject: input.subject,
          text: input.text,
          html: input.html,
          headers: input.headers && Object.keys(input.headers).length > 0 ? input.headers : undefined,
          attachments
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message =
          typeof errorBody?.message === 'string'
            ? errorBody.message
            : `Resend returned HTTP ${response.status}`;
        console.error('[mail] Resend delivery failed', {
          status: response.status,
          to: input.to,
          subject: input.subject,
          from: sender,
          reason: message,
          body: errorBody
        });
        return { status: 'failed', reason: message };
      }

      // The provider's id becomes our Message-ID once Resend sends it, so a
      // threaded conversation can point later replies back at this message.
      const sentBody = (await response.json().catch(() => null)) as { id?: string } | null;
      console.info('[mail] Resend email sent', { to: input.to, subject: input.subject });
      return {
        status: 'sent',
        to: input.to,
        provider: 'resend',
        ...(typeof sentBody?.id === 'string' ? { providerMessageId: sentBody.id } : {})
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown Resend error';
      console.error('[mail] Resend request threw', { to: input.to, subject: input.subject, reason });
      return { status: 'failed', reason };
    }
  }

  if (!transporter || !mailFrom) {
    console.warn('[mail] No email provider configured — RESEND_API_KEY/RESEND_FROM or SMTP_* env vars required');
    return { status: 'skipped', reason: 'Resend or SMTP is not configured' };
  }

  try {
    const info = await transporter.sendMail({
      from: input.from?.trim() || mailFrom,
      replyTo: input.replyTo?.trim() || replyTo,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        ...(attachment.contentId ? { cid: attachment.contentId, contentDisposition: 'inline' as const } : {})
      }))
    });

    return {
      status: 'sent',
      to: input.to,
      provider: 'smtp',
      ...(typeof info?.messageId === 'string' ? { providerMessageId: info.messageId } : {})
    };
  } catch (err) {
    // Don't 500 the parent request — the source record is already persisted,
    // and the UI can surface the delivery failure for manual follow-up.
    const reason = err instanceof Error ? err.message : 'Unknown SMTP error';
    return { status: 'failed', reason };
  }
}

export const mailService = {
  isConfigured() {
    return isResendConfigured() || isSmtpConfigured();
  },

  // Generic HTML email — used for sending report documents (e.g. Monthly Recap).
  async sendDocument(input: { to: string; subject: string; text: string; html: string }): Promise<EmailDeliveryResult> {
    return deliverEmail(input);
  },

  /**
   * A staff reply to a guest enquiry, sent from the enquiries mailbox so the
   * guest's answer comes back to the address the inbound poller reads.
   *
   * The body is what the person typed — plain prose, wrapped in the lightest
   * possible HTML. An enquiry reply reads as a person writing back, so it
   * deliberately skips the campaign chrome (logos, buttons, footers).
   *
   * `inReplyTo`/`references` are the guest's own Message-IDs: passing them
   * makes the reply land inside their existing thread instead of opening a
   * new one in their client.
   */
  async sendEnquiryReply(input: {
    to: string;
    subject: string;
    body: string;
    from?: string;
    replyTo?: string;
    inReplyTo?: string | null;
    references?: string[];
  }): Promise<EmailDeliveryResult> {
    const paragraphs = input.body
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p style="margin:0 0 16px;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
      .join('');
    const headers: Record<string, string> = {};
    if (input.inReplyTo) headers['In-Reply-To'] = input.inReplyTo;
    const references = (input.references ?? []).filter(Boolean);
    if (references.length > 0) headers.References = references.join(' ');

    return deliverEmail({
      to: input.to,
      subject: input.subject,
      text: input.body,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1c1c;">${paragraphs}</div>`,
      from: input.from,
      replyTo: input.replyTo,
      headers
    });
  },

  async sendStaffInvite(input: InviteEmailInput): Promise<EmailDeliveryResult> {
    const venueLine = input.venue ? ` for ${input.venue}` : '';
    const expiry = input.expiresAt.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const note = input.note?.trim();
    const safeFirstName = escapeHtml(input.firstName);
    const safeRoleTitle = escapeHtml(input.roleTitle);
    const safeInviteLink = escapeHtml(input.inviteLink);
    const safeNote = note ? escapeHtml(note) : '';
    const attachments = input.attachments ?? [];
    const attachmentNames = attachments.map((file) => file.filename);
    const subject = 'Complete your ALMA onboarding';
    const text = [
      `Hi ${input.firstName},`,
      '',
      `You've been invited to complete your ALMA onboarding${venueLine}.`,
      `Role: ${input.roleTitle}`,
      note ? `Note: ${note}` : '',
      '',
      'Open your private onboarding link:',
      input.inviteLink,
      '',
      // Attachments are easy to miss on a phone, so they are named in the body.
      attachmentNames.length
        ? `Attached to this email, please read before your first shift:\n${attachmentNames.map((name) => `- ${name}`).join('\n')}\n`
        : '',
      `This link expires on ${expiry}. If you didn't expect this email you can ignore it.`
    ]
      .filter(Boolean)
      .join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ALMA Suites · Staff
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${safeFirstName},</p>
        <p style="font-size:14px;margin:0 0 18px">
          You've been invited to complete your <strong>ALMA Staff</strong> onboarding${escapeHtml(venueLine)}.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 22px">
          <tr>
            <td style="font-size:12px;color:#64748b;padding:0 18px 4px 0">Role</td>
            <td style="font-size:14px;color:#0f172a;font-weight:600">${safeRoleTitle}</td>
          </tr>
          ${
            safeNote
              ? `<tr>
            <td style="font-size:12px;color:#64748b;padding:6px 18px 4px 0;vertical-align:top">Note</td>
            <td style="font-size:13px;color:#0f172a">${safeNote}</td>
          </tr>`
              : ''
          }
        </table>
        <p style="margin:0 0 22px">
          <a href="${safeInviteLink}" style="display:inline-block;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;font-size:14px;letter-spacing:0.02em">
            Complete onboarding
          </a>
        </p>
        ${
          attachmentNames.length
            ? `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 22px;background:#f8fafc">
          <div style="font-size:12px;font-weight:700;color:#0f172a;margin:0 0 8px">Attached — please read before your first shift</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#475569">
            ${attachmentNames.map((name) => `<li style="margin:0 0 4px">${escapeHtml(name)}</li>`).join('')}
          </ul>
        </div>`
            : ''
        }
        <p style="font-size:13px;color:#475569;margin:0 0 6px">
          This private link expires on ${escapeHtml(expiry)}.
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          If the button doesn't work, paste this link into your browser:<br>
          <span style="word-break:break-all;color:#475569">${safeInviteLink}</span>
        </p>
      </div>
    `;

    return deliverEmail({
      to: input.to,
      subject,
      text,
      html,
      ...(attachments.length ? { attachments } : {})
    });
  },

  /**
   * Nudge a new starter who has not finished their onboarding form.
   *
   * 20 of 33 invites expired unused because the link was sent once and never
   * mentioned again. Short, specific, and it says how long they have left —
   * a reminder that does not give a deadline reads as optional.
   */

  /**
   * "Here is your week, and here is the link that keeps it up to date."
   *
   * Sent once per person when a roster is published, listing only the shifts
   * that just went live. Two things have to survive being read on a phone in
   * ten seconds: the days they are on, and the calendar link — so those are
   * the only two things given any weight.
   *
   * The subscribe link matters more than the list. The list is right today;
   * the subscription is right after Tim moves a shift on Thursday.
   */
  async sendRosterPublished(input: {
    to: string;
    firstName: string;
    shifts: Array<{
      startsAt: string;
      endsAt: string;
      venue?: string | null;
      area?: string | null;
      roleTitle?: string | null;
      breakMinutes?: number | null;
    }>;
    feedUrl: string;
    subscribeUrl: string;
  }): Promise<EmailDeliveryResult> {
    const count = input.shifts.length;
    if (count === 0) {
      return { status: 'skipped', reason: 'No shifts to send' };
    }

    // Formatted by the shared helper so what is tested is what is sent — the
    // day and the time are rendered in venue time there, explicitly, which is
    // the part that goes silently wrong on a UTC server twice a year.
    const rows = input.shifts.map((shift) => rosterShiftLine(shift));

    const first = rows[0]!;
    const span = count === 1 ? first.day : `${first.day} – ${rows.at(-1)!.day}`;
    const subject = count === 1 ? `Your shift: ${first.day}` : `Your ${count} shifts — ${span}`;

    const text = [
      `Hi ${input.firstName},`,
      '',
      count === 1 ? 'A shift has just gone up for you:' : `${count} shifts have just gone up for you:`,
      '',
      ...rows.map((row) => `  ${row.day}   ${row.hours}   ${row.where}${row.area ? ` (${row.area})` : ''}`),
      '',
      'Add these to your phone once and they stay right — if a shift moves, your calendar moves with it:',
      input.subscribeUrl,
      '',
      "If that link does not open, paste this one into your calendar app instead:",
      input.feedUrl,
      '',
      'Check with your manager if anything looks wrong.'
    ].join('\n');

    const rowsHtml = rows
      .map(
        (row) => `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;white-space:nowrap">
              ${escapeHtml(row.day)}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;white-space:nowrap">
              ${escapeHtml(row.hours)}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569">
              ${escapeHtml(row.where)}${row.area ? `<br><span style="font-size:12px;color:#94a3b8">${escapeHtml(row.area)}</span>` : ''}
            </td>
          </tr>`
      )
      .join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ALMA Suites · Roster
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${escapeHtml(input.firstName)},</p>
        <p style="font-size:14px;margin:0 0 18px">
          ${count === 1 ? 'A shift has just gone up for you.' : `${count} shifts have just gone up for you.`}
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 22px">
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin:0 0 10px">
          <a href="${escapeHtml(input.subscribeUrl)}" style="display:inline-block;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;font-size:14px">
            Add to my calendar
          </a>
        </p>
        <p style="font-size:13px;color:#475569;margin:0 0 18px">
          Add it once and it stays right — if a shift moves, your calendar moves with it. If the button does not open,
          paste <a href="${escapeHtml(input.feedUrl)}" style="color:${BRAND_ACCENT}">this link</a> into your calendar app.
        </p>
        <p style="font-size:13px;color:#475569;margin:0">
          Check with your manager if anything looks wrong.
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject, text, html });
  },

  async sendOnboardingReminder(input: {
    to: string;
    firstName: string;
    inviteLink: string;
    daysLeft: number;
    venue?: string | null;
    attachments?: EmailAttachment[];
  }): Promise<EmailDeliveryResult> {
    const deadline =
      input.daysLeft <= 0
        ? 'today'
        : input.daysLeft === 1
          ? 'tomorrow'
          : `in ${input.daysLeft} days`;
    const venueLine = input.venue ? ` at ${input.venue}` : '';
    const subject = `Finish your ALMA onboarding — link expires ${deadline}`;
    const text = [
      `Hi ${input.firstName},`,
      '',
      `Your onboarding form${venueLine} is still waiting. It takes about five minutes, and we need it before your first pay run — tax file number, super and bank details.`,
      '',
      input.inviteLink,
      '',
      `The link expires ${deadline}. If it has already expired, ask your manager to send a new one.`
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ALMA Suites · Staff
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${escapeHtml(input.firstName)},</p>
        <p style="font-size:14px;margin:0 0 18px">
          Your onboarding form${escapeHtml(venueLine)} is still waiting. It takes about five minutes, and we
          need it before your first pay run — tax file number, super and bank details.
        </p>
        <p style="margin:0 0 22px">
          <a href="${escapeHtml(input.inviteLink)}" style="display:inline-block;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;font-size:14px">
            Finish onboarding
          </a>
        </p>
        <p style="font-size:13px;color:#475569;margin:0">
          The link expires ${escapeHtml(deadline)}. If it has already expired, ask your manager for a new one.
        </p>
      </div>
    `;
    return deliverEmail({
      to: input.to,
      subject,
      text,
      html,
      ...(input.attachments?.length ? { attachments: input.attachments } : {})
    });
  },

  /**
   * Tell a manager which onboarding invites are about to die, and which
   * already have.
   *
   * The failure this exists for is silence: an invite expiring changed nothing
   * anybody could see, so nineteen people ended up on the roster with no tax
   * or bank details and payroll chased them by hand.
   */
  async sendOnboardingChaseDigest(input: {
    to: string;
    expiring: Array<{ name: string; email: string | null; daysLeft: number }>;
    expired: Array<{ name: string; email: string | null; daysAgo: number }>;
  }): Promise<EmailDeliveryResult> {
    const total = input.expiring.length + input.expired.length;
    const subject =
      input.expired.length > 0
        ? `${input.expired.length} onboarding link${input.expired.length === 1 ? '' : 's'} expired unused`
        : `${total} onboarding link${total === 1 ? '' : 's'} about to expire`;

    const lines = [
      'Onboarding links that need a decision:',
      '',
      ...input.expiring.map(
        (row) => `- ${row.name} (${row.email ?? 'no email'}) — expires in ${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'}`
      ),
      ...input.expired.map(
        (row) => `- ${row.name} (${row.email ?? 'no email'}) — EXPIRED ${row.daysAgo} day${row.daysAgo === 1 ? '' : 's'} ago, never completed`
      ),
      '',
      'Resend from Staff → People → Invites. Anyone already rostered without finishing this has no tax file number or bank details on file.'
    ];

    const row = (name: string, email: string | null, detail: string, urgent: boolean) => `
      <tr>
        <td style="padding:8px 12px 8px 0;font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(name)}</td>
        <td style="padding:8px 12px 8px 0;font-size:13px;color:#475569">${escapeHtml(email ?? 'no email')}</td>
        <td style="padding:8px 0;font-size:13px;color:${urgent ? '#991b1b' : '#854d0e'};font-weight:600">${escapeHtml(detail)}</td>
      </tr>`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:640px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ALMA Suites · Staff
        </div>
        <p style="font-size:16px;margin:0 0 16px">Onboarding links that need a decision</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 20px">
          ${input.expired.map((r) => row(r.name, r.email, `Expired ${r.daysAgo}d ago — never completed`, true)).join('')}
          ${input.expiring.map((r) => row(r.name, r.email, `Expires in ${r.daysLeft}d`, false)).join('')}
        </table>
        <p style="font-size:13px;color:#475569;margin:0">
          Resend from Staff → People → Invites. Anyone already rostered without finishing this has no tax file
          number or bank details on file.
        </p>
      </div>
    `;
    return deliverEmail({ to: input.to, subject, text: lines.join('\n'), html });
  },

  async sendPasswordReset(input: PasswordResetEmailInput): Promise<EmailDeliveryResult> {
    const appName = input.appName?.trim() || 'ALMA';
    const firstName = input.firstName?.trim() || 'there';
    const expiry = input.expiresAt.toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    const safeAppName = escapeHtml(appName);
    const safeFirstName = escapeHtml(firstName);
    const safeResetLink = escapeHtml(input.resetLink);
    const subject = `${appName} password reset`;
    const text = [
      `Hi ${firstName},`,
      '',
      `We received a request to reset your ${appName} password.`,
      'Open this private link to choose a new password:',
      input.resetLink,
      '',
      `This link expires at ${expiry}. If you did not request this reset, you can ignore this email.`
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ${safeAppName}
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${safeFirstName},</p>
        <p style="font-size:14px;margin:0 0 18px">
          We received a request to reset your <strong>${safeAppName}</strong> password.
        </p>
        <p style="margin:0 0 22px">
          <a href="${safeResetLink}" style="display:inline-block;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;font-size:14px;letter-spacing:0.02em">
            Reset password
          </a>
        </p>
        <p style="font-size:13px;color:#475569;margin:0 0 6px">
          This private link expires at ${escapeHtml(expiry)}. If you did not request this reset, you can ignore this email.
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          If the button doesn't work, paste this link into your browser:<br>
          <span style="word-break:break-all;color:#475569">${safeResetLink}</span>
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject, text, html });
  },

  // Sent once a staff member's onboarding is approved: tells them the account
  // is active, where to sign in, and gives a "set / reset your password" link
  // in case they've forgotten the one they chose during onboarding.
  async sendWelcomeActivation(input: WelcomeEmailInput): Promise<EmailDeliveryResult> {
    const appName = input.appName?.trim() || 'ALMA Staff';
    const firstName = input.firstName?.trim() || 'there';
    const loginUrl = input.loginUrl?.trim() || 'https://alma-staff.web.app';
    const expiry = input.expiresAt.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    const safeAppName = escapeHtml(appName);
    const safeFirstName = escapeHtml(firstName);
    const safeLoginUrl = escapeHtml(loginUrl);
    const safeResetLink = escapeHtml(input.resetLink);
    const subject = `Your ${appName} account is ready — sign in`;
    const text = [
      `Hi ${firstName},`,
      '',
      `Your ${appName} onboarding has been approved and your account is now active.`,
      '',
      `Sign in here: ${loginUrl}`,
      `Use your email address and the password you set during onboarding.`,
      '',
      `Forgot it, or never set one? Use this private link to set a new password:`,
      input.resetLink,
      `(This link expires at ${expiry}.)`
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ${safeAppName}
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${safeFirstName},</p>
        <p style="font-size:14px;margin:0 0 18px">
          Your onboarding has been approved and your <strong>${safeAppName}</strong> account is now active. You're ready to sign in.
        </p>
        <p style="margin:0 0 22px">
          <a href="${safeLoginUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;font-size:14px;letter-spacing:0.02em">
            Sign in
          </a>
        </p>
        <p style="font-size:14px;margin:0 0 8px">
          Use your email address and the password you set during onboarding.
        </p>
        <p style="font-size:13px;color:#475569;margin:0 0 18px">
          Forgot it (or never set one)? <a href="${safeResetLink}" style="color:${BRAND_ACCENT};font-weight:600">Set a new password here</a> — this private link expires at ${escapeHtml(expiry)}.
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          If the buttons don't work, paste these into your browser:<br>
          Sign in: <span style="word-break:break-all;color:#475569">${safeLoginUrl}</span><br>
          Set password: <span style="word-break:break-all;color:#475569">${safeResetLink}</span>
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject, text, html });
  },

  async sendGiftCard(input: GiftCardEmailInput): Promise<EmailDeliveryResult> {
    const recipient = input.recipientName?.trim() || input.purchaserName;
    const safeRecipient = escapeHtml(recipient);
    const safeCode = escapeHtml(input.code);
    const safePrintableUrl = escapeHtml(input.printableUrl);
    const safeRedeemUrl = input.redeemUrl ? escapeHtml(input.redeemUrl) : '';
    const safeQrCodeUrl = input.qrCodeUrl ? escapeHtml(input.qrCodeUrl) : '';
    const safeAppleWalletUrl = input.appleWalletUrl ? escapeHtml(input.appleWalletUrl) : '';
    const safeGoogleWalletUrl = input.googleWalletUrl ? escapeHtml(input.googleWalletUrl) : '';
    const safeMessage = input.message?.trim() ? escapeHtml(input.message.trim()) : '';
    const amount = formatMoney(input.amountCents);
    const balance = formatMoney(input.balanceCents);
    const primaryColor = input.settings?.primaryColor ?? '#1f3524';
    const accentColor = input.settings?.accentColor ?? '#b98216';
    const intro = input.settings?.emailIntro?.trim() || 'Your ALMA gift card is ready.';
    const expiry = input.expiresAt
      ? input.expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const subject = (input.settings?.emailSubject?.trim() || 'Your ALMA gift card {{code}}').replace(/\{\{\s*code\s*\}\}/gi, input.code);
    const text = [
      `Hi ${recipient},`,
      '',
      intro,
      `Code: ${input.code}`,
      `Value: ${amount}`,
      `Balance: ${balance}`,
      expiry ? `Expiry: ${expiry}` : '',
      input.message?.trim() ? `Message: ${input.message.trim()}` : '',
      '',
      'Open or print your gift card:',
      input.printableUrl,
      input.qrCodeUrl ? `Redemption QR: ${input.qrCodeUrl}` : '',
      input.redeemUrl ? `Redeem/check balance: ${input.redeemUrl}` : '',
      input.appleWalletUrl ? `Add to Apple Wallet: ${input.appleWalletUrl}` : '',
      input.googleWalletUrl ? `Add to Google Wallet: ${input.googleWalletUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    // Custom-designed cards attach the customer's own rendered image; stock
    // designs keep the generated SVG artwork.
    const attachments: EmailAttachment[] = input.customArtwork
      ? [
          {
            filename: `alma-gift-card-${input.code}.${input.customArtwork.mimeType === 'image/jpeg' ? 'jpg' : input.customArtwork.mimeType === 'image/webp' ? 'webp' : 'png'}`,
            content: input.customArtwork.data,
            contentType: input.customArtwork.mimeType
          }
        ]
      : [
          {
            filename: `alma-gift-card-${input.code}.svg`,
            content: giftCardArtworkSvg(input, amount, balance, expiry),
            contentType: 'image/svg+xml'
          }
        ];
    if (input.redeemUrl) {
      try {
        attachments.push({
          filename: `alma-gift-card-${input.code}-qr.svg`,
          content: await QRCode.toString(input.redeemUrl, {
            type: 'svg',
            margin: 1,
            width: 360,
            color: {
              dark: primaryColor,
              light: '#ffffff'
            }
          }),
          contentType: 'image/svg+xml'
        });
      } catch (error) {
        console.warn('[mail] Gift card QR attachment generation failed', {
          code: input.code,
          reason: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    // Cream wordmark on the green header, attached inline. The type lockup is
    // only a fallback for a deployment that is missing the asset.
    const headerLogo = brandLogo('cream');
    if (headerLogo) {
      attachments.push({
        filename: 'alma-group.png',
        content: headerLogo,
        contentType: 'image/png',
        contentId: 'almagrouplogo'
      });
    }
    const headerMark = headerLogo
      ? '<img src="cid:almagrouplogo" alt="ALMA Group" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0" />'
      : `<div style="font-size:34px;font-weight:900;letter-spacing:-0.04em;line-height:0.95">alma</div>
         <div style="font-size:13px;font-weight:800;letter-spacing:0.52em;margin-left:3px;margin-top:8px">GROUP</div>`;

    // Centred with a table scaffold, not `margin:0 auto` — Outlook and several
    // webmail clients drop auto margins on a div, which drifts the whole card
    // to one side. The align="center" attribute is honoured everywhere.
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0;padding:0;width:100%;background:#faf8f3">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#faf8f3">
        <tr>
          <td align="center" style="padding:24px 12px">
      <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse">
        <tr>
          <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#1f3524;text-align:left;background:#faf8f3">
        <div style="background:${primaryColor};color:#fff1e6;padding:32px 30px 30px;border-radius:18px 18px 0 0">
          ${headerMark}
        </div>
        <div style="padding:30px;background:#faf8f3;border:1px solid #e6ded0;border-top:0;border-radius:0 0 18px 18px">
          <p style="font-size:17px;margin:0 0 10px">Hi ${safeRecipient},</p>
          <p style="font-size:15px;margin:0 0 22px;color:#4c5d4d">${escapeHtml(intro)}</p>
          ${input.customArtwork ? `<img src="${escapeHtml(input.customArtwork.url)}" alt="Your gift card" width="620" style="display:block;width:100%;max-width:620px;height:auto;border-radius:16px;margin:0 0 22px" />` : ''}
          <div style="background:${primaryColor};background-image:linear-gradient(160deg,#233628 0%,#14241A 100%);border-radius:16px;padding:26px 28px;margin:0 0 22px;color:#F5DCCE">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              <tr>
                <td style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:rgba(245,220,206,0.6)">Gift Card</td>
                <td align="right">
                  <span style="display:inline-block;border:1px solid rgba(245,220,206,0.4);border-radius:999px;padding:5px 14px;font-size:14px;font-weight:700;color:#F5DCCE">${escapeHtml(amount)}</span>
                </td>
              </tr>
            </table>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:rgba(245,220,206,0.6);margin:24px 0 8px">Card code</div>
            <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:0.12em;color:#F5DCCE;background:rgba(245,220,206,0.08);border:1px solid rgba(245,220,206,0.18);border-radius:10px;padding:14px 16px;text-align:center">${safeCode}</div>
            <div style="margin-top:16px;font-size:15px;font-weight:700;color:#F5DCCE">${escapeHtml(balance)} balance</div>
            <div style="font-size:12px;color:rgba(245,220,206,0.6);margin-top:2px">Original value ${escapeHtml(amount)}${expiry ? ` · Expires ${escapeHtml(expiry)}` : ''}</div>
            ${safeMessage ? `<p style="font-size:14px;font-style:italic;color:rgba(245,220,206,0.85);border-top:1px solid rgba(245,220,206,0.18);padding-top:16px;margin:18px 0 0">${safeMessage}</p>` : ''}
            ${safeQrCodeUrl ? `<div style="border-top:1px solid rgba(245,220,206,0.18);margin-top:18px;padding-top:18px"><img src="${safeQrCodeUrl}" alt="Gift card redemption QR code" width="140" height="140" style="display:block;background:#ffffff;border-radius:10px;padding:8px" /><p style="font-size:11px;color:rgba(245,220,206,0.6);margin:8px 0 0">The QR code and gift card artwork are attached to this email.</p></div>` : ''}
          </div>
          <p style="margin:0 0 22px">
            <a href="${safePrintableUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:8px;font-size:14px;margin:0 8px 8px 0">
              Open printable gift card
            </a>
            ${safeAppleWalletUrl ? `<a href="${safeAppleWalletUrl}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:8px;font-size:14px;margin:0 8px 8px 0">Add to Apple Wallet</a>` : ''}
            ${safeGoogleWalletUrl ? `<a href="${safeGoogleWalletUrl}" style="display:inline-block;background:#ffffff;color:${primaryColor};border:1px solid #d5d0c7;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;font-size:14px;margin:0 8px 8px 0">Add to Google Wallet</a>` : ''}
          </p>
          ${safeRedeemUrl ? `<p style="font-size:12px;color:#64705f;margin:0 0 10px">Staff redemption link: <span style="word-break:break-all">${safeRedeemUrl}</span></p>` : ''}
          <p style="font-size:12px;color:#8d968a;margin:18px 0 0;border-top:1px solid #e6ded0;padding-top:14px">
            If the button doesn't work, paste this link into your browser:<br>
            <span style="word-break:break-all;color:#64705f">${safePrintableUrl}</span>
          </p>
        </div>
          </td>
        </tr>
      </table>
          </td>
        </tr>
      </table>
      </body>
      </html>
    `;

    // A gift card is the one email here a customer receives, so it goes out
    // from the venue's own address rather than the staff operations one.
    // GIFTCARD_FROM overrides; otherwise the house sender still applies.
    return deliverEmail({
      to: input.to,
      subject,
      text,
      html,
      attachments,
      from: process.env.GIFTCARD_FROM?.trim() || undefined
    });
  },

  /**
   * Generic alert email — used by notification triggers for critical events
   * (temperature out of range, overdue compliance, etc).
   */
  async sendAlert(input: {
    to: string;
    subject: string;
    title: string;
    body: string;
    venue?: string | null;
    severity?: 'critical' | 'warning' | 'info';
    ctaUrl?: string;
    ctaLabel?: string;
  }): Promise<EmailDeliveryResult> {
    const severity = input.severity ?? 'warning';
    const accent = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb';
    const eyebrow = severity === 'critical' ? 'Critical alert' : severity === 'warning' ? 'Action needed' : 'Alma Suite';
    const safeTitle = escapeHtml(input.title);
    const safeBody = escapeHtml(input.body);
    const safeVenue = input.venue ? escapeHtml(input.venue) : '';
    const safeCta = input.ctaUrl ? escapeHtml(input.ctaUrl) : '';
    const safeCtaLabel = escapeHtml(input.ctaLabel ?? 'Open in Alma Suite');

    const text = [
      `[${eyebrow}] ${input.title}`,
      input.venue ? `Venue: ${input.venue}` : '',
      '',
      input.body,
      '',
      input.ctaUrl ? `Open: ${input.ctaUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${accent};font-weight:700;margin-bottom:14px">
          ${escapeHtml(eyebrow)}${safeVenue ? ` · ${safeVenue}` : ''}
        </div>
        <h2 style="font-size:22px;font-weight:600;margin:0 0 12px;color:#0f172a">${safeTitle}</h2>
        <p style="font-size:14px;margin:0 0 18px;color:#334155;white-space:pre-line">${safeBody}</p>
        ${input.ctaUrl ? `
          <p style="margin:18px 0 0">
            <a href="${safeCta}" style="display:inline-block;padding:11px 24px;border-radius:999px;background:${accent};color:#fff;font-weight:700;font-size:13px;text-decoration:none;letter-spacing:0.04em">
              ${safeCtaLabel}
            </a>
          </p>
        ` : ''}
        <p style="font-size:12px;color:#94a3b8;margin:28px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          This alert was generated automatically by Alma Suite. Manage notification settings in Admin → General settings.
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject: input.subject, text, html });
  },

  // Campaign email send — used for both test sends and live sends by the
  // Marketing service. Renders a wrapper that includes the unsubscribe
  // link + business address (CAN-SPAM / AU Spam Act compliance) so we
  // don't have to remember to include it in every campaign body.
  async sendCampaignEmail(input: {
    to: string;
    subject: string;
    previewText?: string | null;
    htmlBody: string;
    textBody?: string | null;
    venue?: string | null;
    unsubscribeUrl?: string | null;
    senderName?: string | null;
    businessAddress?: string | null;
    isTest?: boolean;
  }): Promise<EmailDeliveryResult> {
    const venueLine = input.venue ? escapeHtml(input.venue) : 'Alma Group';
    const safeSubject = input.isTest ? `[TEST] ${input.subject}` : input.subject;
    const safeUnsub = input.unsubscribeUrl ? escapeHtml(input.unsubscribeUrl) : '';
    const safeAddress = input.businessAddress ? escapeHtml(input.businessAddress) : 'Alma Group · Sydney NSW';
    const safeSender = input.senderName ? escapeHtml(input.senderName) : venueLine;
    const safePreview = input.previewText ? escapeHtml(input.previewText) : '';

    // The body comes from the campaign — already HTML. We append the
    // compliance footer rather than wrapping it heavily so editorial
    // designs aren't fought.
    const html = `
      <div style="font-family:'Cormorant Garamond',Georgia,serif;line-height:1.55;color:#0f172a;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
        ${safePreview ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${safePreview}</div>` : ''}
        ${input.isTest ? `
          <div style="background:#FAE8E0;border-left:3px solid #B3262E;padding:10px 14px;font-size:12px;color:#3D1814;letter-spacing:0.08em;text-transform:uppercase;font-family:'Avenir LT Std',Manrope,sans-serif;font-weight:700;margin-bottom:18px;border-radius:4px">
            Test send · Real recipients won't receive this
          </div>
        ` : ''}
        <div>${input.htmlBody}</div>
        <div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:18px;font-family:'Avenir LT Std',Manrope,sans-serif;font-size:11px;color:#64748b;line-height:1.5">
          You're receiving this because you've opted in to hear from ${safeSender}.<br />
          ${safeAddress}<br />
          ${safeUnsub ? `<a href="${safeUnsub}" style="color:#64748b;text-decoration:underline">Unsubscribe</a>` : 'To unsubscribe, reply with the word UNSUBSCRIBE.'}
        </div>
      </div>
    `;

    const text = [
      input.textBody?.trim() || stripHtmlToText(input.htmlBody),
      '',
      '---',
      `From ${input.senderName || venueLine}`,
      input.businessAddress || 'Alma Group · Sydney NSW',
      input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : 'To unsubscribe, reply with the word UNSUBSCRIBE.'
    ].join('\n');

    return deliverEmail({ to: input.to, subject: safeSubject, text, html });
  },

  // Reservation confirmation with a signed manage/cancel deep link.
  // Plain HTML to play nicely with every mail client; manage link uses
  // a single CTA button so the guest can re-find it later.
  async sendReservationConfirmation(input: {
    to: string;
    guestFirstName: string;
    venue: string;
    startsAt: Date;
    covers: number;
    manageUrl: string;
  }): Promise<EmailDeliveryResult> {
    const whenLabel = input.startsAt.toLocaleString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit'
    });
    const subject = `Booking confirmed — ${input.venue}, ${whenLabel}`;
    const text = `Hi ${input.guestFirstName || 'there'},

Your booking at ${input.venue} is confirmed for ${whenLabel}, ${input.covers} ${input.covers === 1 ? 'guest' : 'guests'}.

Need to change or cancel?
${input.manageUrl}

(You can cancel online up to 24 hours before. Inside 24 hours please call the venue directly.)

See you soon,
Alma Group`;
    // Public widget accepts arbitrary text for guest first name + the
    // venue label comes from a public payload, so escape every
    // user-controlled value before dropping it into HTML. Otherwise a
    // booking could inject markup or a misleading link into the
    // confirmation email (which may also be addressed to a third party).
    const safeFirstName = escapeHtml(input.guestFirstName || 'there');
    const safeVenue = escapeHtml(input.venue);
    const safeWhen = escapeHtml(whenLabel);
    const safeManageUrl = escapeHtml(input.manageUrl);
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#14241A">
<p>Hi ${safeFirstName},</p>
<p>Your booking at <strong>${safeVenue}</strong> is confirmed for <strong>${safeWhen}</strong>, ${input.covers} ${input.covers === 1 ? 'guest' : 'guests'}.</p>
<p style="margin:32px 0"><a href="${safeManageUrl}" style="display:inline-block;padding:14px 22px;background:#14241A;color:#FAF6EE;border-radius:9999px;text-decoration:none;font-weight:700;letter-spacing:0.18em;font-size:11px;text-transform:uppercase">View or cancel booking</a></p>
<p style="font-size:13px;color:rgba(20,36,26,0.65)">You can cancel online up to 24 hours before. Inside 24 hours please call the venue directly.</p>
<p>See you soon,<br>Alma Group</p>
</body></html>`;
    return deliverEmail({ to: input.to, subject, text, html });
  }
};

// Lightweight HTML → text fallback used when the campaign doesn't supply
// an explicit textBody. Not a full converter — keeps headings, links and
// paragraph breaks readable enough for inbox previews.
function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(p|div|h[1-6]|br|li)[^>]*>/gi, '\n')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
