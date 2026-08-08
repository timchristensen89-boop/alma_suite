-- Editable unit-alias table: spellings of the same unit ("KILO" → kg,
-- "Unit" → each, "Btl" → bottle), consulted by the shared unit conversion.
-- Seeded with the code defaults so every alias is visible and deletable in
-- Stock → Setup → Units.
CREATE TABLE "stock_unit_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_unit_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_unit_aliases_alias_key" ON "stock_unit_aliases"("alias");

-- Keep this list in step with DEFAULT_UNIT_ALIASES in
-- packages/shared/src/stock-units.ts.
INSERT INTO "stock_unit_aliases" ("id", "alias", "canonical", "updatedAt") VALUES
    ('unitalias_gram',       'gram',       'g',      CURRENT_TIMESTAMP),
    ('unitalias_gm',         'gm',         'g',      CURRENT_TIMESTAMP),
    ('unitalias_grm',        'grm',        'g',      CURRENT_TIMESTAMP),
    ('unitalias_gr',         'gr',         'g',      CURRENT_TIMESTAMP),
    ('unitalias_kilogram',   'kilogram',   'kg',     CURRENT_TIMESTAMP),
    ('unitalias_kilo',       'kilo',       'kg',     CURRENT_TIMESTAMP),
    ('unitalias_milligram',  'milligram',  'mg',     CURRENT_TIMESTAMP),
    ('unitalias_millilitre', 'millilitre', 'ml',     CURRENT_TIMESTAMP),
    ('unitalias_milliliter', 'milliliter', 'ml',     CURRENT_TIMESTAMP),
    ('unitalias_litre',      'litre',      'l',      CURRENT_TIMESTAMP),
    ('unitalias_liter',      'liter',      'l',      CURRENT_TIMESTAMP),
    ('unitalias_ltr',        'ltr',        'l',      CURRENT_TIMESTAMP),
    ('unitalias_lt',         'lt',         'l',      CURRENT_TIMESTAMP),
    ('unitalias_centilitre', 'centilitre', 'cl',     CURRENT_TIMESTAMP),
    ('unitalias_centiliter', 'centiliter', 'cl',     CURRENT_TIMESTAMP),
    ('unitalias_decilitre',  'decilitre',  'dl',     CURRENT_TIMESTAMP),
    ('unitalias_deciliter',  'deciliter',  'dl',     CURRENT_TIMESTAMP),
    ('unitalias_ea',         'ea',         'each',   CURRENT_TIMESTAMP),
    ('unitalias_unit',       'unit',       'each',   CURRENT_TIMESTAMP),
    ('unitalias_piece',      'piece',      'each',   CURRENT_TIMESTAMP),
    ('unitalias_pc',         'pc',         'each',   CURRENT_TIMESTAMP),
    ('unitalias_pce',        'pce',        'each',   CURRENT_TIMESTAMP),
    ('unitalias_portion',    'portion',    'each',   CURRENT_TIMESTAMP),
    ('unitalias_serve',      'serve',      'each',   CURRENT_TIMESTAMP),
    ('unitalias_serving',    'serving',    'each',   CURRENT_TIMESTAMP),
    ('unitalias_btl',        'btl',        'bottle', CURRENT_TIMESTAMP),
    ('unitalias_cs',         'cs',         'case',   CURRENT_TIMESTAMP),
    ('unitalias_ctn',        'ctn',        'carton', CURRENT_TIMESTAMP),
    ('unitalias_bx',         'bx',         'box',    CURRENT_TIMESTAMP),
    ('unitalias_boxe',       'boxe',       'box',    CURRENT_TIMESTAMP),
    ('unitalias_bunche',     'bunche',     'bunch',  CURRENT_TIMESTAMP),
    ('unitalias_pk',         'pk',         'pack',   CURRENT_TIMESTAMP),
    ('unitalias_pkt',        'pkt',        'pack',   CURRENT_TIMESTAMP),
    ('unitalias_packet',     'packet',     'pack',   CURRENT_TIMESTAMP),
    ('unitalias_doz',        'doz',        'dozen',  CURRENT_TIMESTAMP);
