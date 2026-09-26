// The one place that decides whether a marketing channel can send for real,
// pure so the API, the marketing app's banner and controls, and the tests
// all read the SAME answer. Covered by marketing-send-mode.test.ts.
//
// Background: the marketing app showed "Email campaigns can now send live"
// in its banner and "Recipient preview and simulation only. No external
// send." on the Campaigns card at the same time. Both were static strings;
// neither knew whether an email provider was actually configured, and the
// Send live button was enabled either way (the API then refused with 503).
// Now the API reports the execution mode per channel and the UI derives
// every sentence and every control from it.

export type MarketingChannelMode = 'LIVE' | 'SIMULATION' | 'SETUP_REQUIRED';

export type MarketingChannelSendMode = {
  mode: MarketingChannelMode;
  provider: string | null;
  /** One plain sentence an operator can act on. */
  detail: string;
};

export type MarketingSendModes = {
  email: MarketingChannelSendMode;
  sms: MarketingChannelSendMode;
  social: MarketingChannelSendMode;
  /** The banner sentence, derived from the three modes above. */
  summary: string;
};

export type MarketingSendModeEnv = {
  resendApiKey?: string | null;
  resendFrom?: string | null;
  mailFrom?: string | null;
  smtpHost?: string | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  socialLivePublishEnabled: boolean;
};

/** Same rule mail.service uses to pick a transport, without touching it. */
export function emailProviderFor(env: MarketingSendModeEnv): 'resend' | 'smtp' | null {
  if (env.resendApiKey && (env.resendFrom || env.mailFrom)) return 'resend';
  if (env.smtpHost && env.smtpUser && env.smtpPass && (env.mailFrom || env.smtpUser)) return 'smtp';
  return null;
}

export function resolveMarketingSendModes(env: MarketingSendModeEnv): MarketingSendModes {
  const provider = emailProviderFor(env);
  const email: MarketingChannelSendMode = provider
    ? {
        mode: 'LIVE',
        provider,
        detail: `Email sends for real through ${provider === 'resend' ? 'Resend' : 'SMTP'}. Live sends need a test send first, an explicit confirmation, and an admin.`
      }
    : {
        mode: 'SETUP_REQUIRED',
        provider: null,
        detail: 'No email provider is configured (RESEND_API_KEY + RESEND_FROM, or SMTP_HOST/USER/PASS). Campaigns can be simulated only.'
      };
  // There is no SMS provider in the suite; the channel exists as a
  // simulation target only.
  const sms: MarketingChannelSendMode = {
    mode: 'SIMULATION',
    provider: null,
    detail: 'No SMS provider is wired. SMS campaigns are simulation only — nothing is sent.'
  };
  const social: MarketingChannelSendMode = env.socialLivePublishEnabled
    ? { mode: 'LIVE', provider: 'meta', detail: 'Social posts publish for real where an account is connected and validated.' }
    : { mode: 'SIMULATION', provider: null, detail: 'Social publishing is simulation only until MARKETING_SOCIAL_LIVE_PUBLISH_ENABLED=true and page tokens are wired.' }
  ;

  const emailSentence =
    email.mode === 'LIVE'
      ? `Email can send live via ${email.provider === 'resend' ? 'Resend' : 'SMTP'} (test first, then an admin confirms).`
      : 'Email is simulation only — no provider is configured.';
  const socialSentence = social.mode === 'LIVE' ? 'Social posts can publish live.' : 'Social posts are simulated.';
  return {
    email,
    sms,
    social,
    summary: `${emailSentence} SMS is simulated. ${socialSentence}`
  };
}

/** Whether a campaign on this channel can actually leave the building right now. */
export function channelCanSendLive(modes: Pick<MarketingSendModes, 'email' | 'sms'>, channel: string): boolean {
  if (channel === 'EMAIL') return modes.email.mode === 'LIVE';
  if (channel === 'SMS') return modes.sms.mode === 'LIVE';
  return false;
}
