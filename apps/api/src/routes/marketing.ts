import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { marketingService } from '../services/marketing.service.js';
import { marketingEngagementService } from '../services/marketing-engagement.service.js';

export const marketingRouter = Router();

marketingRouter.get('/overview', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.overview(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/dashboard', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.overview(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/dashboard', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.contentDashboard(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/upload-config', requireManager, async (_req, res, next) => {
  try {
    res.json(await marketingService.contentUploadConfig());
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/helpers', requireManager, async (_req, res, next) => {
  try {
    res.json(await marketingService.contentHelpers());
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/helpers/:helperId/create-post', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(
      await marketingService.createContentPostFromHelper(req.user!, String(req.params.helperId), {
        venue: typeof req.body?.venue === 'string' ? req.body.venue : undefined,
        scheduledAt: typeof req.body?.scheduledAt === 'string' ? req.body.scheduledAt : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/assets', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listContentAssets(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/assets', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createContentAsset(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/assets/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.getContentAsset(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/content/assets/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateContentAsset(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.delete('/content/assets/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.archiveContentAsset(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/posts', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listContentPosts(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createContentPost(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/posts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.getContentPost(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/content/posts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateContentPost(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/assets', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.attachContentAsset(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/create-campaign', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createCampaignFromContentPost(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.delete('/content/posts/:id/assets/:assetId', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.detachContentAsset(req.user!, String(req.params.id), String(req.params.assetId)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/submit-review', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.submitContentPostForReview(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/approve', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.approveContentPost(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/schedule', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.scheduleContentPost(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/cancel', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.cancelContentPost(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/calendar', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.contentCalendar(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/preview-publish', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.previewContentPublish(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/simulate-publish', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.simulateContentPublish(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/posts/:id/publish', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.publishContentPost(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/content/social-accounts', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listSocialAccounts(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/social-accounts', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createSocialAccount(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/content/social-accounts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateSocialAccount(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.delete('/content/social-accounts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.deleteSocialAccount(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/content/social-accounts/:id/validate-readiness', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.validateSocialAccountReadiness(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/guests', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listGuests(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/guests/:guestId', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.getGuest(req.user!, String(req.params.guestId)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/guests/:guestId/timeline', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.getGuestTimeline(req.user!, String(req.params.guestId)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/tags', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listTags(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/tags', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createTag(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/tags/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateTag(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/guests/:guestId/tags', requireManager, async (req, res, next) => {
  try {
    res.json(
      await marketingService.assignGuestTag(
        req.user!,
        String(req.params.guestId),
        String(req.body?.tagId ?? '')
      )
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.delete('/guests/:guestId/tags/:tagId', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.removeGuestTag(req.user!, String(req.params.guestId), String(req.params.tagId)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/auto-tags/recalculate', requireManager, async (req, res, next) => {
  try {
    res.json(
      await marketingService.recalculateAutoTags(req.user!, {
        venue: typeof req.body?.venue === 'string' ? req.body.venue : undefined,
        guestId: typeof req.body?.guestId === 'string' ? req.body.guestId : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/segments', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createSegment(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/segments/preview', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.previewSegment(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/templates', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listTemplates(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/templates', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createTemplate(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/templates/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateTemplate(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/campaigns', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listCampaigns(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createCampaign(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/campaigns/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.getCampaign(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/campaigns/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateCampaign(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns/:id/preview-recipients', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.previewCampaignRecipients(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns/:id/create-content-post', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createContentPostFromCampaign(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns/:id/simulate-send', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.simulateCampaignSend(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Test send — single email to the actor or a specified address. Required
// before live send. Audit: marketingCampaign.simulatedAt is bumped.
marketingRouter.post('/campaigns/:id/test-send', requireManager, async (req, res, next) => {
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to : undefined;
    res.json(await marketingService.testSendCampaign(req.user!, String(req.params.id), { to }));
  } catch (error) {
    next(error);
  }
});

// LIVE send — admin only, requires confirmation token + a recent test send.
marketingRouter.post('/campaigns/:id/live-send', requireManager, async (req, res, next) => {
  try {
    const confirmToken = typeof req.body?.confirmToken === 'string' ? req.body.confirmToken : '';
    const override = Boolean(req.body?.override);
    res.json(await marketingService.liveCampaignSend(req.user!, String(req.params.id), { confirmToken, override }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns/:id/issue-gift-cards', requireManager, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const valueCents = typeof body.valueCents === 'number'
      ? body.valueCents
      : Number(body.valueCents);
    const expiryDays = typeof body.expiryDays === 'number' ? body.expiryDays : undefined;
    res.status(201).json(
      await marketingService.issueCampaignGiftCards(req.user!, String(req.params.id), { valueCents, expiryDays })
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/automations', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listAutomations(req.user!, {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/automations', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createAutomation(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/automations/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateAutomation(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get('/automations/metrics', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.listAutomationMetrics(req.user!));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/automations/:id/simulate', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.simulateAutomation(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Phase 4.7 — Social engagement read-back. Live data flows once Meta page
// tokens are persisted; until then this returns simulated metrics tagged
// `simulated: true` so the surface is real but the values are obviously not.
marketingRouter.get('/social/engagement', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await marketingEngagementService.getOverview({
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      days: typeof req.query.days === 'string' ? Number(req.query.days) : undefined,
      actor: req.user
    }));
  } catch (error) {
    next(error);
  }
});
