import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { channelCanSendLive, emailProviderFor, resolveMarketingSendModes } from './marketing-send-mode.js';

// Pure env → mode. No transport is created and nothing is sent.
const NOTHING = { emailLiveSendEnabled: false, socialLivePublishEnabled: false };
const RESEND = { resendApiKey: 're_x', resendFrom: 'Alma <hello@example.com>' };

describe('resolveMarketingSendModes', () => {
  it('with no provider, email is setup-required and the summary never claims live', () => {
    const modes = resolveMarketingSendModes(NOTHING);
    assert.equal(modes.email.mode, 'SETUP_REQUIRED');
    assert.equal(modes.email.provider, null);
    assert.equal(modes.sms.mode, 'SIMULATION');
    assert.equal(modes.social.mode, 'SIMULATION');
    assert.doesNotMatch(modes.summary, /Email can send live/);
    assert.match(modes.summary, /simulation only/);
    assert.equal(channelCanSendLive(modes, 'EMAIL'), false);
  });

  it('credentials alone never make email live: provider configured, switch off = simulation, and it says why', () => {
    const modes = resolveMarketingSendModes({ ...NOTHING, ...RESEND });
    assert.equal(modes.email.mode, 'SIMULATION');
    assert.equal(modes.email.provider, 'resend');
    assert.match(modes.email.detail, /live campaign sends are switched off/);
    assert.match(modes.summary, /switch is off/);
    assert.equal(channelCanSendLive(modes, 'EMAIL'), false);
  });

  it('the switch alone never makes email live either: no provider = setup required', () => {
    const modes = resolveMarketingSendModes({ ...NOTHING, emailLiveSendEnabled: true });
    assert.equal(modes.email.mode, 'SETUP_REQUIRED');
    assert.equal(channelCanSendLive(modes, 'EMAIL'), false);
  });

  it('with Resend configured AND the switch on, email is live and the summary says so — and only for email', () => {
    const modes = resolveMarketingSendModes({ ...NOTHING, ...RESEND, emailLiveSendEnabled: true });
    assert.equal(modes.email.mode, 'LIVE');
    assert.equal(modes.email.provider, 'resend');
    assert.match(modes.summary, /Email can send live via Resend/);
    assert.match(modes.summary, /SMS is simulated/);
    assert.match(modes.summary, /Social posts are simulated/);
    assert.equal(channelCanSendLive(modes, 'EMAIL'), true);
    assert.equal(channelCanSendLive(modes, 'SMS'), false);
  });

  it('SMTP needs host, user and pass; RESEND needs a from address', () => {
    assert.equal(emailProviderFor({ ...NOTHING, smtpHost: 'smtp', smtpUser: 'u', smtpPass: 'p' }), 'smtp');
    assert.equal(emailProviderFor({ ...NOTHING, smtpHost: 'smtp', smtpUser: 'u' }), null);
    assert.equal(emailProviderFor({ ...NOTHING, resendApiKey: 're_x' }), null);
    assert.equal(emailProviderFor({ ...NOTHING, resendApiKey: 're_x', mailFrom: 'a@b.c' }), 'resend');
  });

  it('SMS is never live: there is no provider in the suite', () => {
    const modes = resolveMarketingSendModes({ ...NOTHING, resendApiKey: 're_x', resendFrom: 'x@y.z', emailLiveSendEnabled: true });
    assert.equal(modes.sms.mode, 'SIMULATION');
  });

  it('social follows the explicit live flag', () => {
    assert.equal(resolveMarketingSendModes({ ...NOTHING, socialLivePublishEnabled: true }).social.mode, 'LIVE');
    assert.match(resolveMarketingSendModes({ ...NOTHING, socialLivePublishEnabled: true }).summary, /Social posts can publish live/);
  });
});
