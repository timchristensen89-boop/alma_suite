import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@alma/db';
import { canAccessMenuVenue, canPublishMenus } from '@alma/shared';
import { HttpError } from './http.js';

/**
 * Venue scope for the Menus module, enforced at the route.
 *
 * A Menus grant can be limited to a venue in the Staff app ("Limit to St
 * Alma"). The shared rules (`menuVenueScope`, `canAccessMenuVenue`,
 * `canPublishMenus` in packages/shared/src/menus.ts) say what the grant means;
 * these helpers resolve which venue a request is about — from a menu id, a
 * version id, a promotion id or a venue id in the body — and refuse it before
 * the service runs. The frontend hides the same things, but the refusal here
 * is the one that counts.
 *
 * Out-of-scope reads answer 404, not 403: a limited chef should not learn the
 * other venue's menu ids exist. Writes a publisher is refused on their own
 * venue (not a publisher there) answer 403 with the reason.
 */

type VenueRef = { slug: string; name: string } | null;

export const MENU_NOT_FOUND = 'That menu does not exist.';
export const PROMOTION_NOT_FOUND = 'That promotion does not exist.';

async function venueOfMenu(menuId: string): Promise<VenueRef> {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { venue: { select: { slug: true, name: true } } } });
  return menu?.venue ?? null;
}

async function venueOfVersion(versionId: string): Promise<VenueRef> {
  const version = await prisma.menuVersion.findUnique({ where: { id: versionId }, select: { menu: { select: { venue: { select: { slug: true, name: true } } } } } });
  return version?.menu.venue ?? null;
}

async function venueOfPromotion(promotionId: string): Promise<VenueRef> {
  const promotion = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { venue: { select: { slug: true, name: true } } } });
  return promotion?.venue ?? null;
}

async function venueById(venueId: string): Promise<VenueRef> {
  return prisma.venue.findUnique({ where: { id: venueId }, select: { slug: true, name: true } });
}

export type MenuVenueSource =
  | { menuId: string }
  | { versionId: string }
  | { promotionId: string }
  | { venueId: string };

/** The venue a request is about, or null when the record does not exist. */
export async function resolveMenuVenue(source: MenuVenueSource): Promise<VenueRef> {
  if ('menuId' in source) return venueOfMenu(source.menuId);
  if ('versionId' in source) return venueOfVersion(source.versionId);
  if ('promotionId' in source) return venueOfPromotion(source.promotionId);
  return venueById(source.venueId);
}

/**
 * Refuse a request about a venue the user is limited away from. Missing
 * records are left for the service to report (it has the better message),
 * except that an out-of-scope record reads as missing too.
 */
export async function assertMenuVenueAccess(user: Request['user'], source: MenuVenueSource, notFound = MENU_NOT_FOUND): Promise<VenueRef> {
  if (!user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
  const venue = await resolveMenuVenue(source);
  if (venue && !canAccessMenuVenue(user, venue.slug)) throw new HttpError(404, notFound);
  return venue;
}

/** As above, and the user must be a publisher for that venue. */
export async function assertMenuPublisher(user: Request['user'], source: MenuVenueSource, notFound = MENU_NOT_FOUND): Promise<VenueRef> {
  const venue = await assertMenuVenueAccess(user, source, notFound);
  if (!canPublishMenus(user, venue?.slug ?? null)) {
    throw new HttpError(403, 'Publishing a menu is for managers with Menus access and the people they tick as publishers. Save your draft and ask one of them to publish it.');
  }
  return venue;
}

type SourceFrom = (req: Request) => MenuVenueSource | null;

export const fromMenuParam: SourceFrom = (req) => ({ menuId: String(req.params.menuId) });
export const fromVersionParam: SourceFrom = (req) => ({ versionId: String(req.params.versionId) });
export const fromPromotionParam: SourceFrom = (req) => ({ promotionId: String(req.params.promotionId) });
export const fromVenueBody: SourceFrom = (req) => {
  const venueId = (req.body as { venueId?: unknown } | undefined)?.venueId;
  return typeof venueId === 'string' && venueId ? { venueId } : null;
};

/** Route guard: the record's venue must be in the user's scope. */
export function requireMenuVenueAccess(from: SourceFrom, notFound = MENU_NOT_FOUND) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const source = from(req);
      if (source) await assertMenuVenueAccess(req.user, source, notFound);
      else if (!req.user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Route guard: in scope, and a publisher for that venue. */
export function requireMenuPublisherFor(from: SourceFrom, notFound = MENU_NOT_FOUND) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const source = from(req);
      if (source) {
        await assertMenuPublisher(req.user, source, notFound);
      } else {
        // No venue in the request (a create with a bad body): the schema in
        // the service will reject it, but only a publisher somewhere gets that far.
        if (!req.user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
        if (!canPublishMenus(req.user)) throw new HttpError(403, 'Publishing a menu is for managers with Menus access and the people they tick as publishers.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
