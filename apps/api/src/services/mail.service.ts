import nodemailer from 'nodemailer';

type InviteEmailInput = {
  to: string;
  firstName: string;
  roleTitle: string;
  venue?: string | null;
  note?: string | null;
  inviteLink: string;
  expiresAt: Date;
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
  appleWalletUrl?: string | null;
  googleWalletUrl?: string | null;
  expiresAt?: Date | null;
  settings?: {
    emailSubject?: string;
    emailIntro?: string;
    artworkUrl?: string;
    primaryColor?: string;
    accentColor?: string;
  };
};

type PasswordResetEmailInput = {
  to: string;
  firstName?: string | null;
  resetLink: string;
  expiresAt: Date;
  appName?: string | null;
};

type EmailDeliveryResult =
  | { status: 'sent'; to: string; provider: 'resend' | 'smtp' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

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

async function deliverEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailDeliveryResult> {
  if (resendApiKey && resendFrom) {
    try {
      const response = await fetch(resendApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [input.to],
          reply_to: replyTo || undefined,
          subject: input.subject,
          text: input.text,
          html: input.html
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
          from: resendFrom,
          reason: message,
          body: errorBody
        });
        return { status: 'failed', reason: message };
      }

      console.info('[mail] Resend email sent', { to: input.to, subject: input.subject });
      return { status: 'sent', to: input.to, provider: 'resend' };
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
    await transporter.sendMail({
      from: mailFrom,
      replyTo,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html
    });

    return { status: 'sent', to: input.to, provider: 'smtp' };
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
        <p style="font-size:13px;color:#475569;margin:0 0 6px">
          This private link expires on ${escapeHtml(expiry)}.
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          If the button doesn't work, paste this link into your browser:<br>
          <span style="word-break:break-all;color:#475569">${safeInviteLink}</span>
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject, text, html });
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

  async sendGiftCard(input: GiftCardEmailInput): Promise<EmailDeliveryResult> {
    const recipient = input.recipientName?.trim() || input.purchaserName;
    const safeRecipient = escapeHtml(recipient);
    const safeCode = escapeHtml(input.code);
    const safePrintableUrl = escapeHtml(input.printableUrl);
    const safeQrCodeUrl = input.qrCodeUrl ? escapeHtml(input.qrCodeUrl) : '';
    const safeAppleWalletUrl = input.appleWalletUrl ? escapeHtml(input.appleWalletUrl) : '';
    const safeGoogleWalletUrl = input.googleWalletUrl ? escapeHtml(input.googleWalletUrl) : '';
    const safeArtworkUrl = input.settings?.artworkUrl ? escapeHtml(input.settings.artworkUrl) : '';
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
      input.appleWalletUrl ? `Add to Apple Wallet: ${input.appleWalletUrl}` : '',
      input.googleWalletUrl ? `Add to Google Wallet: ${input.googleWalletUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:600px;margin:0 auto;padding:24px">
        <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:18px">
          ALMA Gift Cards
        </div>
        <p style="font-size:16px;margin:0 0 12px">Hi ${safeRecipient},</p>
        <p style="font-size:14px;margin:0 0 18px">${escapeHtml(intro)}</p>
        <div style="border:1px solid #e2d3ad;background:#fff8e7;border-radius:14px;padding:22px;margin:0 0 22px">
          ${safeArtworkUrl ? `<img src="${safeArtworkUrl}" alt="" style="display:block;width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin:0 0 18px" />` : ''}
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.14em;color:${accentColor};margin-bottom:8px">Gift card code</div>
          <div style="font-size:28px;font-weight:900;letter-spacing:0.08em;color:#111827;margin-bottom:12px">${safeCode}</div>
          <div style="font-size:16px;font-weight:800;color:${accentColor}">${escapeHtml(balance)} available</div>
          <div style="font-size:13px;color:#64748b">Original value ${escapeHtml(amount)}${expiry ? ` · Expires ${escapeHtml(expiry)}` : ''}</div>
          ${safeMessage ? `<p style="font-size:14px;color:#334155;border-top:1px solid #eadcb8;padding-top:14px;margin:16px 0 0">${safeMessage}</p>` : ''}
          ${safeQrCodeUrl ? `<div style="border-top:1px solid #eadcb8;margin-top:18px;padding-top:18px"><img src="${safeQrCodeUrl}" alt="Gift card redemption QR code" width="150" height="150" style="display:block;background:#ffffff;border-radius:10px;padding:8px" /><p style="font-size:12px;color:#64748b;margin:8px 0 0">Staff can scan this QR code to open redemption.</p></div>` : ''}
        </div>
        <p style="margin:0 0 22px">
          <a href="${safePrintableUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;font-size:14px">
            Open printable gift card
          </a>
          ${safeAppleWalletUrl ? `<a href="${safeAppleWalletUrl}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;font-size:14px;margin-left:8px">Add to Apple Wallet</a>` : ''}
          ${safeGoogleWalletUrl ? `<a href="${safeGoogleWalletUrl}" style="display:inline-block;background:#ffffff;color:${primaryColor};border:1px solid #d5d0c7;text-decoration:none;font-weight:800;padding:11px 18px;border-radius:8px;font-size:14px;margin-left:8px">Add to Google Wallet</a>` : ''}
        </p>
        <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:14px">
          If the button doesn't work, paste this link into your browser:<br>
          <span style="word-break:break-all;color:#475569">${safePrintableUrl}</span>
        </p>
      </div>
    `;

    return deliverEmail({ to: input.to, subject, text, html });
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
