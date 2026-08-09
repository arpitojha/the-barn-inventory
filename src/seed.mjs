/**
 * Sample data modelled on The Barn's existing consumption spreadsheet.
 *
 * `pulled` is the beginning inventory that section of the sheet starts with and
 * `left` is what was counted after the last event, so the app opens on numbers
 * the GM will recognise. Instead of hard-coding a history that contradicts the
 * stock levels, we *replay* a month of deliveries and counts through the real
 * domain functions — so every figure on the dashboard reconciles with the
 * activity log, right down to the final event.
 */

import { OZ, BOTTLE, applyCount, isoDate, newId } from './core.mjs';

const CATALOGUE = [
  // name, category, unit, pulled, left, par, cost, price, pourSize
  ['Tito’s Vodka',        'Standard Liquor', OZ, 199.8, 109.8, 200, 0.62, 10, 1.5],
  ['Bacardi (1L)',             'Standard Liquor', OZ, 210.1, 210.1, 200, 0.55, 10, 1.5],
  ['Jack Daniel’s',       'Standard Liquor', OZ, 213.8, 161.7, 200, 0.75, 10, 1.5],
  ['Beefeater (750)',          'Standard Liquor', OZ, 226.7, 226.7, 200, 0.68, 10, 1.5],
  ['Jim Beam',                 'Standard Liquor', OZ, 175.7, 157.2, 175, 0.58, 10, 1.5],
  ['Espolón',             'Standard Liquor', OZ, 221.6, 158.5, 200, 0.82, 10, 1.5],
  ['Dewar’s',             'Standard Liquor', OZ, 181.2, 181.2, 175, 0.70, 10, 1.5],

  ['Grey Goose',               'Premium Liquor',  OZ, 291.7, 140.3, 250, 1.15, 12, 1.0],
  ['Bombay Sapphire Gin',      'Premium Liquor',  OZ, 218.7, 148.7, 200, 0.95, 12, 1.0],
  ['Mount Gay',                'Premium Liquor',  OZ, 226.0, 226.0, 200, 0.88, 12, 1.0],
  ['Teremana',                 'Premium Liquor',  OZ, 207.5,  51.1, 200, 1.05, 12, 1.0],
  ['Casamigos',                'Premium Liquor',  OZ,   0.0,   0.0, 100, 1.55, 12, 1.0],
  ['Woodford Reserve',         'Premium Liquor',  OZ, 233.4,  78.5, 200, 1.25, 12, 1.0],
  ['Crown Royal (Canadian)',   'Premium Liquor',  OZ, 173.7, 173.1, 150, 0.98, 12, 1.0],
  ['Johnnie Walker Black',     'Premium Liquor',  OZ, 189.1, 149.3, 150, 1.32, 12, 1.0],

  ['Nelson’s Green Brier','Local Liquor',    OZ,   0.0,   0.0, 100, 0.90, 11, 1.5],
  ['Belle Meade Bourbon',      'Local Liquor',    OZ,   0.0,   0.0, 100, 1.05, 11, 1.5],
  ['TC Craft Tequila',         'Local Liquor',    OZ,   0.0,   0.0, 100, 1.00, 11, 1.5],
  ['Corsair Gin',              'Local Liquor',    OZ,   0.0,   0.0, 100, 0.92, 11, 1.5],
  ['Pickers Vodka',            'Local Liquor',    OZ,   0.0,   0.0, 100, 0.70, 11, 1.5],

  ['Cabernet',                 'Wine',            BOTTLE, 24, 12, 24, 12.00, 8, 5],
  ['Pinot Grigio',             'Wine',            BOTTLE,  0,  0, 12, 11.00, 8, 5],
  ['Sauvignon Blanc',          'Wine',            BOTTLE, 24,  2, 24, 11.50, 8, 5],
  ['Chardonnay',               'Wine',            BOTTLE, 24, 17, 24, 11.00, 8, 5],
  ['Moscato',                  'Wine',            BOTTLE,  0,  0,  6,  9.50, 8, 5],
  ['Rosé',                'Wine',            BOTTLE,  0,  0,  6, 10.00, 8, 5],
  ['Merlot',                   'Wine',            BOTTLE, 16, 10, 16, 12.50, 8, 5],
  ['Brut',                     'Wine',            BOTTLE,  5,  0, 12, 14.00, 8, 6],

  ['Domestic Beer',            'Beer',            BOTTLE, 576, 292, 480, 1.35, 5, 1],
  ['Craft Beer',               'Beer',            BOTTLE, 156,  74, 144, 2.15, 8, 1],
  ['Seltzer',                  'Beer',            BOTTLE,   0,   0,  96, 1.60, 6, 1],

  ['Paloma',                   'Signature Cocktails', OZ, 113.9, 78.8,  96, 1.10, 12, 1.5],
  ['Espresso Martini',         'Signature Cocktails', OZ, 227.7, 47.9, 192, 1.45, 12, 1.5],
  ['Old Fashioned',            'Signature Cocktails', OZ,   0.0,  0.0,  96, 1.30, 12, 1.5],

  ['Table-Side Red',           'Table-Side Wine', BOTTLE,  0, 0, 12,  9.00, 3, 5],
  ['Table-Side White',         'Table-Side Wine', BOTTLE, 10, 4, 12,  9.00, 3, 5],
  ['Passed Wine',              'Table-Side Wine', BOTTLE,  0, 0, 12,  9.50, 3, 5],

  ['Sodas',                    'Soda & Mixers',   BOTTLE, 192, 28, 192, 0.65, 3, 1],
  ['Tonic Water',              'Soda & Mixers',   BOTTLE,  96, 41,  96, 0.75, 3, 1],
  ['Ginger Beer',              'Soda & Mixers',   BOTTLE,  72, 30,  72, 0.95, 4, 1],
];

/** Deterministic PRNG so the demo data is identical on every device. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = value => Math.round(value * 10) / 10;
const stamp = (daysAgo, hour, minute = 0, now = new Date()) => {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

function restockEntry(items, targets, { at, note }) {
  const lines = [];
  const updated = items.map(item => {
    const target = targets(item);
    const previous = Number(item.onHand);
    const received = round1(target - previous);
    if (received <= 0) return item;
    lines.push({
      itemId: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      previous,
      received,
      onHand: round1(previous + received),
      cost: received * item.cost,
    });
    return { ...item, onHand: round1(previous + received) };
  });

  const entry = {
    id: newId('act'),
    type: 'restock',
    date: at,
    title: 'Delivery received',
    note,
    lines,
    totals: {
      cost: lines.reduce((total, line) => total + line.cost, 0),
      received: lines.length,
    },
  };
  return { items: updated, entry };
}

function countEntry(items, counts, { at, event, note }) {
  const result = applyCount(items, counts);
  return {
    items: result.items,
    entry: {
      id: newId('act'),
      type: 'count',
      date: at,
      title: event ? `${event.name} — event count` : 'Daily count',
      note,
      eventId: event?.id || null,
      eventName: event?.name || null,
      lines: result.lines.filter(line => line.usage > 0 || line.adjustment > 0),
      totals: result.totals,
    },
  };
}

export function buildSeedData(now = new Date()) {
  const random = mulberry32(20250809);

  const catalogue = CATALOGUE.map(([name, category, unit, pulled, left, par, cost, price, pourSize]) => ({
    id: newId('itm'), name, category, unit, pulled, left, par, cost, price, pourSize,
  }));

  // Open the month at roughly 80% of a full pull.
  let items = catalogue.map(row => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    beginning: round1(row.pulled * 0.8),
    onHand: round1(row.pulled * 0.8),
    // Products the venue isn't currently carrying (0 on the sheet) shouldn't
    // clutter the reorder list — only track par for what's actually stocked.
    par: row.pulled > 0 ? row.par : 0,
    cost: row.cost,
    price: row.price,
    pourSize: row.pourSize,
    dni: 0,
  }));

  const events = [
    { id: newId('evt'), name: 'Whitaker Rehearsal Dinner', date: isoDate(new Date(now.getTime() - 27 * 86400000)), notes: '80 guests · beer & wine plus premium bar' },
    { id: newId('evt'), name: 'Harvest Corporate Mixer',   date: isoDate(new Date(now.getTime() - 20 * 86400000)), notes: '140 guests · hosted two hours' },
    { id: newId('evt'), name: 'Delgado Wedding',           date: isoDate(new Date(now.getTime() - 13 * 86400000)), notes: '210 guests · full open bar' },
    { id: newId('evt'), name: 'Founders Night',            date: isoDate(new Date(now.getTime() - 6 * 86400000)),  notes: '95 guests · signature cocktails featured' },
    { id: newId('evt'), name: 'Miller Wedding',            date: isoDate(now), notes: '240 guests · the count shown on the current sheet' },
  ];

  const history = [];
  const push = entry => history.push(entry);

  const timeline = [
    { daysAgo: 29, kind: 'delivery', fill: 0.9,  note: 'Opening month par build' },
    { daysAgo: 27, kind: 'event', event: events[0], intensity: 0.10 },
    { daysAgo: 24, kind: 'count', intensity: 0.03, note: 'Midweek service' },
    { daysAgo: 22, kind: 'delivery', fill: 0.88, note: 'Weekly distributor drop' },
    { daysAgo: 20, kind: 'event', event: events[1], intensity: 0.14 },
    { daysAgo: 17, kind: 'count', intensity: 0.04, note: 'Midweek service' },
    { daysAgo: 15, kind: 'delivery', fill: 0.92, note: 'Weekly distributor drop' },
    { daysAgo: 13, kind: 'event', event: events[2], intensity: 0.20 },
    { daysAgo: 10, kind: 'count', intensity: 0.03, note: 'Midweek service' },
    { daysAgo: 8,  kind: 'delivery', fill: 0.9,  note: 'Weekly distributor drop' },
    { daysAgo: 6,  kind: 'event', event: events[3], intensity: 0.12 },
    { daysAgo: 3,  kind: 'count', intensity: 0.03, note: 'Midweek service' },
  ];

  const byId = new Map(catalogue.map(row => [row.id, row]));

  for (const step of timeline) {
    if (step.kind === 'delivery') {
      const result = restockEntry(items, item => round1(byId.get(item.id).pulled * step.fill), {
        at: stamp(step.daysAgo, 10, 15, now),
        note: step.note,
      });
      items = result.items;
      if (result.entry.lines.length) push(result.entry);
      continue;
    }

    const counts = {};
    for (const item of items) {
      const source = byId.get(item.id);
      if (source.pulled <= 0) continue;
      const draw = step.intensity * (0.55 + random() * 0.9);
      const used = Math.min(item.onHand, round1(source.pulled * draw));
      if (used <= 0) continue;
      counts[String(item.id)] = round1(item.onHand - used);
    }
    if (!Object.keys(counts).length) continue;

    const result = countEntry(items, counts, {
      at: stamp(step.daysAgo, step.kind === 'event' ? 23 : 21, 30, now),
      event: step.event,
      note: step.note || step.event?.notes,
    });
    items = result.items;
    push(result.entry);
  }

  // Top every line up to the exact "Pulled" column from the sheet...
  const prep = restockEntry(items, item => byId.get(item.id).pulled, {
    at: stamp(1, 14, 0, now),
    note: 'Event prep — bar pulled and staged',
  });
  items = prep.items;
  if (prep.entry.lines.length) push(prep.entry);

  // A small breakage adjustment keeps the audit trail honest.
  const cabernet = items.find(item => item.name === 'Cabernet');
  if (cabernet && cabernet.onHand >= 1) {
    const previous = cabernet.onHand;
    items = items.map(item => (item.id === cabernet.id ? { ...item, onHand: previous - 1 } : item));
    push({
      id: newId('act'),
      type: 'adjustment',
      date: stamp(1, 16, 20, now),
      title: 'Inventory adjustment',
      note: 'Bottle broken during setup',
      lines: [{
        itemId: cabernet.id,
        name: cabernet.name,
        category: cabernet.category,
        unit: cabernet.unit,
        previous,
        delta: -1,
        onHand: previous - 1,
        reason: 'Bottle broken during setup',
      }],
      totals: { cost: cabernet.cost },
    });
    // Re-stage so the closing count still matches the sheet.
    const restage = restockEntry(items, item => byId.get(item.id).pulled, {
      at: stamp(1, 17, 0, now),
      note: 'Replacement bottle pulled from storage',
    });
    items = restage.items;
    if (restage.entry.lines.length) push(restage.entry);
  }

  // ...then close the current event on the sheet's exact "Left" column.
  const closingCounts = {};
  for (const item of items) {
    closingCounts[String(item.id)] = byId.get(item.id).left;
  }
  const closing = countEntry(items, closingCounts, {
    at: stamp(0, 23, 45, now),
    event: events[4],
    note: 'Closing count — matches the venue consumption sheet',
  });
  items = closing.items;
  push(closing.entry);

  // Beginning inventory for the open period is the staged "Pulled" figure.
  items = items.map(item => ({ ...item, beginning: byId.get(item.id).pulled }));

  history.sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    items,
    events,
    history,
    settings: { seeded: true, seededAt: new Date(now).toISOString() },
  };
}
