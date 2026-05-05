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
            subject,
            text,
            html
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message =
            typeof errorBody?.message === 'string'
              ? errorBody.message
              : `Resend returned HTTP ${response.status}`;
          return { status: 'failed', reason: message };
        }

        return { status: 'sent', to: input.to, provider: 'resend' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown Resend error';
        return { status: 'failed', reason };
      }
    }

    if (!transporter || !mailFrom) {
      return { status: 'skipped', reason: 'Resend or SMTP is not configured' };
    }

    try {
      await transporter.sendMail({
        from: mailFrom,
        replyTo,
        to: input.to,
        subject,
        text,
        html
      });

      return { status: 'sent', to: input.to, provider: 'smtp' };
    } catch (err) {
      // Don't 500 the invite request — the staff record + invite link are
      // already persisted, the UI will show the link, and the admin can
      // share it manually. Surface the failure reason so the UI can show
      // a useful message instead of pretending the email went through.
      const reason = err instanceof Error ? err.message : 'Unknown SMTP error';
      return { status: 'failed', reason };
    }
  }
};
