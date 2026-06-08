import type { HelpContent } from '@alma/ui';

/**
 * Per-page "how to" content for the (?) help button in the Stock topbar.
 * Keyed by route path (matches NAV_ITEMS `to`). Keep each entry short and
 * practical — it's a quick reminder, not a manual.
 */
export const STOCK_HELP: Record<string, HelpContent> = {
  '/': {
    title: 'Dashboard',
    intro: 'Your stock at a glance — value on hand, cost of goods, and anything that needs attention.',
    features: [
      { name: 'Stock scope', desc: 'Filter the whole dashboard to a venue or category.' },
      { name: 'Cost of goods', desc: 'Opening stock + purchases − closing stock for the period.' },
      { name: 'Attention tiles', desc: 'Low stock, stale costs and pending counts surface here first.' }
    ],
    tips: ['Numbers follow your latest locked stocktake — lock counts regularly to keep them honest.']
  },
  '/items': {
    title: 'Items',
    intro: 'Your product catalogue — what you buy, the unit you count it in, and what it costs.',
    steps: [
      'Click "Add item" and give it a name.',
      'Set the Purchase unit (how you buy it) and the Sale / recipe unit (how recipes use it).',
      'Set "Units per purchase unit" — the conversion between the two.',
      'Enter the Latest purchase price; the per-unit cost is worked out for you.'
    ],
    features: [
      { name: 'Purchase unit', desc: 'The unit you order in — case, bottle, block, kg.' },
      { name: 'Sale / recipe unit', desc: 'The unit recipes and single-serve costs use — g, mL, each.' },
      { name: 'Units per purchase unit', desc: 'How many recipe units are in one purchase unit.' },
      { name: 'Par / reorder', desc: 'Trigger reorder notices when on-hand drops below these.' }
    ],
    tips: [
      'Bought in 100g blocks? Purchase unit = block, Sale/recipe unit = g, Units per purchase unit = 100, price = cost per block. A "30 g" recipe line then costs the right amount automatically.',
      'On-hand only changes through counts and deliveries — you can\'t type it in directly.'
    ]
  },
  '/stocktake': {
    title: 'Stocktakes',
    intro: 'Count what\'s physically on hand, then submit, review and lock the count.',
    steps: [
      'Start a new stocktake for a venue and date.',
      'Enter counted quantities per item (by area if you like).',
      'Submit, then review the variance against expected on-hand.',
      'Lock it to freeze the count — locked counts drive your stock value and COGS.'
    ],
    features: [
      { name: 'Areas', desc: 'Tag each line with where it was counted (Bar, Kitchen, Cool room).' },
      { name: 'Variance', desc: 'Compare counted vs expected to spot shrinkage or miscounts.' },
      { name: 'Import from Loaded', desc: 'Bring historical counts in from a Loaded CSV export.' },
      { name: 'Export CSV', desc: 'Download any count for your records.' }
    ],
    tips: ['A blank count is "not counted yet" — different from counting zero on hand.']
  },
  '/transfers': {
    title: 'Transfers',
    intro: 'Move stock between venues so each venue\'s on-hand — and its next stocktake variance — stays correct.',
    steps: [
      'Pick the From venue and the To venue.',
      'Choose the item; the current on-hand at each venue is shown.',
      'Enter the quantity (in the item\'s unit) and an optional note.',
      'Transfer — it comes off the From venue and is added to the To venue.'
    ],
    features: [
      { name: 'Per-venue on-hand', desc: 'The quantity shifts between venues; total company stock is unchanged.' },
      { name: 'History', desc: 'Every transfer is logged with who, when, and the resulting balances.' }
    ],
    tips: [
      'Do the transfer when stock physically moves, so the receiving venue\'s count reconciles.',
      'Managers and admins only.'
    ]
  },
  '/suppliers': {
    title: 'Suppliers',
    intro: 'Who you buy from, and the order/contact details for each.',
    features: [
      { name: 'Supplier list', desc: 'Add, edit and archive the vendors you order from.' },
      { name: 'Invoice link', desc: 'Imported invoices attribute their lines to the right supplier.' }
    ]
  },
  '/invoices': {
    title: 'Invoices',
    intro: 'Supplier invoices and bills — imported from Xero or added here — feeding purchases and costs.',
    features: [
      { name: 'Invoice list', desc: 'Every bill with its supplier, date, venue and total.' },
      { name: 'Exclusion rules', desc: 'Skip non-stock lines (e.g. freight, equipment) by rule on import.' },
      { name: 'Cost updates', desc: 'Invoice line prices refresh each item\'s latest cost.' }
    ],
    tips: ['Bills route to the right venue by Xero organisation — check the venue if a total looks off.']
  },
  '/deliveries': {
    title: 'Deliveries',
    intro: 'Check what arrived against what was invoiced, and receipt it into stock.',
    features: [
      { name: 'Delivery checks', desc: 'Match delivered quantities to the invoice.' },
      { name: 'Receipt to stock', desc: 'Receipting adds the quantities to on-hand.' }
    ]
  },
  '/wastage': {
    title: 'Wastage',
    intro: 'Record spoilage, breakages and waste so your stock value and COGS stay accurate.',
    steps: ['Pick the item and venue.', 'Enter the quantity wasted and a reason.', 'Save — it reduces on-hand and shows in reports.'],
    tips: ['Log waste promptly — it\'s the honest explanation for variance at the next count.']
  },
  '/reorder': {
    title: 'Below par',
    intro: 'Items at or below their par / reorder point, ready to turn into an order.',
    features: [
      { name: 'Below par', desc: 'Anything under its reorder threshold is flagged here.' },
      { name: 'Par levels', desc: 'Set per item (and per venue) on the Items page.' }
    ]
  },
  '/recipes': {
    title: 'Menu items',
    intro: 'Build a recipe from stock items; the cost rolls up from each ingredient automatically.',
    steps: [
      'Create a recipe and add ingredient lines from your items.',
      'Set the quantity and unit per line.',
      'Set the portion size (servings) and sale price to see margin.'
    ],
    features: [
      { name: 'Ingredient cost', desc: 'Each line costs at the item\'s per-unit cost, converting units for you.' },
      { name: 'Portion size', desc: 'Servings the recipe yields — leave blank for 1.' }
    ],
    tips: ['Costs follow the latest item prices, so margins update as supplier prices move.']
  },
  '/recipes/margins': {
    title: 'Dish margins',
    intro: 'Menu dishes ranked by cost, sale price and margin — red/amber flag the thin ones.',
    features: [
      { name: 'Margin %', desc: 'Sale price vs recipe cost for each dish.' },
      { name: 'Colour flags', desc: 'Amber and red highlight low-margin dishes to review.' }
    ],
    tips: ['Pair this with Price movement to catch dishes squeezed by rising ingredient costs.']
  },
  '/price-movement': {
    title: 'Supplier price changes',
    intro: 'How supplier prices have changed over time, so cost creep doesn\'t go unnoticed.',
    features: [
      { name: 'Trend', desc: 'Per-item price history from invoice lines.' },
      { name: 'Biggest movers', desc: 'Items with the largest increases bubble up.' }
    ]
  },
  '/recipes/prep': {
    title: 'Prep recipes',
    intro: 'Batch / prep recipes that produce a yield you then use in other recipes.',
    features: [
      { name: 'Output quantity', desc: 'How much the batch yields — costs spread across the yield.' },
      { name: 'Use as ingredient', desc: 'A production recipe can be an ingredient in a dish.' }
    ]
  },
  '/settings': {
    title: 'Setup',
    intro: 'Stock app configuration — categories, count areas, integrations and access.',
    features: [
      { name: 'Categories & areas', desc: 'The groupings used across items and stocktakes.' },
      { name: 'Integrations', desc: 'Xero, imports and other connections.' }
    ]
  }
};
