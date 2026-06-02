// Phase 4.7 — Social post engagement read-back.
//
// Pulls engagement metrics (reach, likes, comments, shares) back from
// Meta Graph API and TikTok for content posts we know about. The publish
// pipeline already records MarketingContentPublishAttempt rows; this
// service reads the externally-provided post IDs out of those rows and
// queries the platform for insights.
//
// Operates in three modes:
//   - LIVE: a Meta page token is stored, Graph API returns data.
//   - SIMULATED: no token; we return mock numbers tagged simulated:true
//     so the UI can show what the surface will look like once Meta is
//     fully wired.
//   - SETUP_REQUIRED: no published posts yet, or we can't reach Meta.
//
// Live-mode pull lives behind a setup gate, so calling this before the
// integration is connected gives a clean payload that the UI can render
// without errors.

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';

type EngagementMode = 'LIVE' | 'SIMULATED' | 'SETUP_REQUIRED';

type PostEngagementRow = {
  postId: string;
  title: string;
  caption: string;
  venue: string;
  publishedAt: string | null;
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'TIKTOK' | 'OTHER';
  externalPostId: string | null;
  metrics: {
    reach: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  // What the platform tells us about engagement rate. We compute when
  // it's not provided directly.
  engagementRate: number | null;
  simulated: boolean;
};

type EngagementPayload = {
  generatedAt: string;
  mode: EngagementMode;
  setup: {
    missingEnvVars: string[];
    connectedAccounts: number;
    publishedPosts: number;
    note: string;
  };
  totals: {
    publishedPosts: number;
    reach: number;
    likes: number;
    comments: number;
  };
  topPosts: PostEngagementRow[];
};

function metaConfigured(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!env.integrations.meta.appId) missing.push('META_APP_ID');
  if (!env.integrations.meta.appSecret) missing.push('META_APP_SECRET');
  if (!env.integrations.meta.redirectUrl) missing.push('META_REDIRECT_URI');
  return { configured: missing.length === 0, missing };
}

function platformFor(value: string): PostEngagementRow['platform'] {
  const lower = value.toUpperCase();
  if (lower.includes('INSTA')) return 'INSTAGRAM';
  if (lower.includes('FACEBOOK') || lower === 'META') return 'FACEBOOK';
  if (lower.includes('TIKTOK')) return 'TIKTOK';
  return 'OTHER';
}

export const marketingEngagementService = {
  async getOverview(options: { venue?: string; days?: number; actor: AuthUser }): Promise<EngagementPayload> {
    if (!(options.actor.isAdmin || options.actor.role === 'ADMIN')) {
      const access = options.actor.appAccess?.find((entry) => entry.appId === 'MARKETING' && entry.status === 'ENABLED');
      if (!access) throw new HttpError(403, 'Marketing engagement read-back is restricted.');
    }

    const days = options.days && options.days > 0 && options.days <= 90 ? options.days : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const venueFilter = options.venue?.trim() || null;

    const [connectedAccounts, publishAttempts] = await Promise.all([
      prisma.marketingSocialAccount.count({
        where: {
          status: 'CONNECTED',
          ...(venueFilter ? { venue: venueFilter } : {})
        }
      }).catch(() => 0),
      prisma.marketingContentPublishAttempt.findMany({
        where: {
          status: 'PUBLISHED',
          createdAt: { gte: since },
          ...(venueFilter ? { post: { venue: venueFilter } } : {})
        },
        include: { post: true, socialAccount: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 100
      }).catch(() => [])
    ]);

    const cfg = metaConfigured();

    // Without a configured Meta integration, return simulated data so the
    // UI can render the surface. The operational debt list elsewhere makes
    // the gap explicit so we're not hiding the fact that this is mock.
    if (!cfg.configured || publishAttempts.length === 0) {
      return buildSimulatedPayload({
        missingEnvVars: cfg.missing,
        connectedAccounts,
        publishedPosts: publishAttempts.length,
        venue: venueFilter
      });
    }

    // LIVE mode would call Meta Graph API per externalPostId here. Since
    // page tokens aren't yet stored, fall through to simulated for now.
    // Once tokens are persisted, replace this branch with the actual
    // /v18.0/{post-id}/insights call.
    return buildSimulatedPayload({
      missingEnvVars: ['META_PAGE_TOKEN_STORAGE'],
      connectedAccounts,
      publishedPosts: publishAttempts.length,
      venue: venueFilter,
      attempts: publishAttempts
    });
  }
};

type SimulationInput = {
  missingEnvVars: string[];
  connectedAccounts: number;
  publishedPosts: number;
  venue: string | null;
  attempts?: Array<{
    id: string;
    platform: string;
    createdAt: Date;
    socialAccount?: { displayName: string } | null;
    post?: { id: string; title: string; caption: string; venue: string; publishedAt: Date | null } | null;
  }>;
};

function buildSimulatedPayload(input: SimulationInput): EngagementPayload {
  const baseSeed = 100;
  // If we have real publish attempts, hang simulated metrics off them so
  // the UI shows the actual post titles. Otherwise emit three example rows.
  const sourceRows = input.attempts && input.attempts.length
    ? input.attempts.slice(0, 8).map((attempt, index) => ({
        postId: attempt.post?.id ?? attempt.id,
        title: attempt.post?.title ?? 'Untitled post',
        caption: (attempt.post?.caption ?? '').slice(0, 140),
        venue: attempt.post?.venue ?? input.venue ?? '—',
        publishedAt: (attempt.post?.publishedAt ?? attempt.createdAt).toISOString(),
        platform: platformFor(attempt.platform),
        externalPostId: null,
        metrics: simulatedMetrics(baseSeed * (index + 1)),
        engagementRate: simulatedEngagementRate(baseSeed * (index + 1)),
        simulated: true
      }))
    : [
        sampleRow('Weekend specials reel', 'INSTAGRAM', input.venue, 0),
        sampleRow('Wine tasting Thursday', 'FACEBOOK', input.venue, 1),
        sampleRow('Behind the pass', 'INSTAGRAM', input.venue, 2)
      ];

  const totals = sourceRows.reduce(
    (acc, row) => ({
      publishedPosts: acc.publishedPosts + 1,
      reach: acc.reach + (row.metrics.reach ?? 0),
      likes: acc.likes + (row.metrics.likes ?? 0),
      comments: acc.comments + (row.metrics.comments ?? 0)
    }),
    { publishedPosts: 0, reach: 0, likes: 0, comments: 0 }
  );

  const mode: EngagementMode = input.publishedPosts > 0 ? 'SIMULATED' : 'SETUP_REQUIRED';
  const note = mode === 'SIMULATED'
    ? 'Showing simulated metrics. Live insights need Meta page tokens stored and the Graph API insights pull wired up (Phase 4.7).'
    : 'No published posts in the selected window yet. Once you publish, simulated metrics will appear here until the live Meta Graph API pull is connected.';

  return {
    generatedAt: new Date().toISOString(),
    mode,
    setup: {
      missingEnvVars: input.missingEnvVars,
      connectedAccounts: input.connectedAccounts,
      publishedPosts: input.publishedPosts,
      note
    },
    totals,
    topPosts: sourceRows
  };
}

function simulatedMetrics(seed: number) {
  // Deterministic-ish from seed so the same run returns the same numbers,
  // which is less jarring than random churn between requests.
  const reach = (seed * 7) % 4800 + 200;
  const impressions = Math.round(reach * 1.4);
  const likes = Math.round(reach * 0.06);
  const comments = Math.round(reach * 0.012);
  const shares = Math.round(reach * 0.008);
  const saves = Math.round(reach * 0.015);
  return { reach, impressions, likes, comments, shares, saves };
}

function simulatedEngagementRate(seed: number) {
  return Math.round(((seed % 47) / 10 + 3.2) * 10) / 10;
}

function sampleRow(title: string, platform: PostEngagementRow['platform'], venue: string | null, index: number): PostEngagementRow {
  return {
    postId: `sample-${index}`,
    title,
    caption: 'Sample content — live data unlocks once Meta Graph insights are wired (Phase 4.7).',
    venue: venue ?? 'All venues',
    publishedAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    platform,
    externalPostId: null,
    metrics: simulatedMetrics(120 * (index + 1)),
    engagementRate: simulatedEngagementRate(120 * (index + 1)),
    simulated: true
  };
}
