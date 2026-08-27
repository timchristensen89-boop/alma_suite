import { HttpError } from './http.js';

// One outbound-email door for stock-api: the Resend HTTP API, no SDK, no
// nodemailer (matching the pattern stock-operations established). Returns
// false — not an error — when the env vars aren't set, so callers can degrade
// to copy-paste and a venue without email configured still gets its work done.
export async function sendStockEmail(input: { to: string; subject: string; body: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.STOCK_ORDER_EMAIL_FROM ?? process.env.RESEND_FROM ?? process.env.MAIL_FROM ?? process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.body
    })
  });
  if (!response.ok) {
    throw new HttpError(502, 'Supplier email could not be sent.');
  }
  return true;
}
