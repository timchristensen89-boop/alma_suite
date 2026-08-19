import { prisma } from '@alma/db';
import {
  wineUpdateInputSchema,
  winePourLinkInputSchema,
  type WineListPayload,
  type WineRow
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

/**
 * The wine list as the printed menu describes it.
 *
 * A wine's money lives on the Recipe each pour points at — this service reads
 * those prices for context and never writes one. Everything it does write is
 * descriptive: grape, region, vintage, the style band, the pairing marks and
 * the tasting note.
 */

const WINE_INCLUDE = {
  pours: {
    orderBy: { ml: 'asc' as const },
    include: { recipe: { select: { title: true, salePriceCents: true } } }
  }
};

function toRow(wine: Awaited<ReturnType<typeof prisma.wine.findFirstOrThrow<{ include: typeof WINE_INCLUDE }>>>): WineRow {
  return {
    id: wine.id,
    venue: wine.venue,
    producer: wine.producer,
    cuvee: wine.cuvee,
    grape: wine.grape,
    region: wine.region,
    origin: wine.origin,
    vintage: wine.vintage,
    section: wine.section,
    styleBand: wine.styleBand,
    pairsWith: wine.pairsWith,
    tastingNote: wine.tastingNote,
    sommelierPour: wine.sommelierPour,
    limitedStock: wine.limitedStock,
    serveChilled: wine.serveChilled,
    sortOrder: wine.sortOrder,
    status: wine.status,
    pours: wine.pours.map((pour) => ({
      id: pour.id,
      recipeId: pour.recipeId,
      ml: pour.ml,
      recipeTitle: pour.recipe.title,
      priceCents: pour.recipe.salePriceCents
    }))
  };
}

/** Wine items in the catalogue, however they happen to be filed. */
const WINE_CATEGORY = {
  OR: [
    { category: { contains: 'Wine', mode: 'insensitive' as const } },
    { category: { contains: 'Sparkling', mode: 'insensitive' as const } },
    { category: { contains: 'Rose', mode: 'insensitive' as const } }
  ]
};

export const winesService = {
  async list(options?: { venue?: string | null }): Promise<WineListPayload> {
    const venue = options?.venue?.trim() || null;
    const [wines, catalogue] = await Promise.all([
      prisma.wine.findMany({
        where: { ...(venue ? { venue } : {}) },
        orderBy: [{ venue: 'asc' }, { sortOrder: 'asc' }],
        include: WINE_INCLUDE
      }),
      prisma.recipe.findMany({
        where: { status: 'ACTIVE', isPrepRecipe: false, ...WINE_CATEGORY, winePour: { is: null } },
        select: { id: true, title: true, venue: true, salePriceCents: true },
        orderBy: { title: 'asc' }
      })
    ]);
    const rows = wines.map(toRow);
    return {
      wines: rows,
      venues: [...new Set(rows.map((wine) => wine.venue))].sort(),
      sections: [...new Set(rows.map((wine) => wine.section).filter((value): value is string => Boolean(value)))].sort(),
      grapes: [...new Set(rows.map((wine) => wine.grape).filter((value): value is string => Boolean(value)))].sort(),
      unlinked: catalogue
        .filter((recipe) => !venue || recipe.venue === venue || recipe.venue === null)
        .map((recipe) => ({ recipeId: recipe.id, title: recipe.title, venue: recipe.venue, priceCents: recipe.salePriceCents }))
    };
  },

  async update(id: string, input: unknown): Promise<WineRow> {
    const data = wineUpdateInputSchema.parse(input);
    const existing = await prisma.wine.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, 'That wine is no longer on the list');
    const wine = await prisma.wine.update({
      where: { id },
      data: {
        ...data,
        // Empty is absent, not an empty string — the register checks for null.
        cuvee: data.cuvee?.trim() || (data.cuvee === undefined ? undefined : null),
        grape: data.grape?.trim() || (data.grape === undefined ? undefined : null),
        region: data.region?.trim() || (data.region === undefined ? undefined : null),
        origin: data.origin?.trim() || (data.origin === undefined ? undefined : null),
        section: data.section?.trim() || (data.section === undefined ? undefined : null),
        styleBand: data.styleBand?.trim() || (data.styleBand === undefined ? undefined : null),
        tastingNote: data.tastingNote?.trim() || (data.tastingNote === undefined ? undefined : null)
      },
      include: WINE_INCLUDE
    });
    return toRow(wine);
  },

  /**
   * Attach a register item to a wine as one of its pour sizes. Moves rather
   * than duplicates: a recipe is one pour of one wine, so re-linking it detaches
   * it from wherever it was.
   */
  async linkPour(wineId: string, input: unknown): Promise<WineRow> {
    const data = winePourLinkInputSchema.parse(input);
    const [wine, recipe] = await Promise.all([
      prisma.wine.findUnique({ where: { id: wineId }, select: { id: true, venue: true } }),
      prisma.recipe.findUnique({ where: { id: data.recipeId }, select: { id: true, venue: true, title: true } })
    ]);
    if (!wine) throw new HttpError(404, 'That wine is no longer on the list');
    if (!recipe) throw new HttpError(404, 'That register item no longer exists');
    // A shared (venue-less) item can serve either venue; a venue-tagged one
    // belongs to its own.
    if (recipe.venue && recipe.venue !== wine.venue) {
      throw new HttpError(400, `${recipe.title} belongs to ${recipe.venue}, not ${wine.venue}`);
    }
    const clash = await prisma.winePour.findFirst({ where: { wineId, ml: data.ml }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      if (clash) await tx.winePour.delete({ where: { id: clash.id } });
      await tx.winePour.deleteMany({ where: { recipeId: data.recipeId } });
      await tx.winePour.create({ data: { wineId, recipeId: data.recipeId, ml: data.ml, sortOrder: data.ml } });
    });
    return toRow(await prisma.wine.findUniqueOrThrow({ where: { id: wineId }, include: WINE_INCLUDE }));
  },

  async unlinkPour(pourId: string): Promise<WineRow> {
    const pour = await prisma.winePour.findUnique({ where: { id: pourId }, select: { wineId: true } });
    if (!pour) throw new HttpError(404, 'That pour is already gone');
    await prisma.winePour.delete({ where: { id: pourId } });
    return toRow(await prisma.wine.findUniqueOrThrow({ where: { id: pour.wineId }, include: WINE_INCLUDE }));
  }
};
