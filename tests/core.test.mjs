import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OZ, BOTTLE,
  fmt, money, unitLabel, quantityLabel,
  ValidationError, parseNonNegative, parsePositive, normalizeItem,
  itemValue, inventoryValue, totalsByUnit,
  stockRatio, isLowStock, isOutOfStock, lowStockItems, reorderQuantity,
  servingsFrom, revenueFrom, costFrom,
  applyCount, applyRestock, applyAdjustment, rebaseBeginning,
  applyWriteOff, applyDniUse, dniBalance, dniValue, dniItems,
  trendByDay, topConsumed, consumptionByEvent, consumptionByCategory, buildReport,
  buildBackup, parseBackup, isoDate, withinRange, shiftDays,
} from '../src/core.mjs';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const vodka = {
  id: 'a', name: 'Tito’s Vodka', category: 'Standard Liquor', unit: OZ,
  beginning: 200, onHand: 120, par: 200, cost: 0.62, price: 10, pourSize: 1.5,
};
const cabernet = {
  id: 'b', name: 'Cabernet', category: 'Wine', unit: BOTTLE,
  beginning: 24, onHand: 12, par: 24, cost: 12, price: 8, pourSize: 5,
};
const beer = {
  id: 'c', name: 'Domestic Beer', category: 'Beer', unit: BOTTLE,
  beginning: 576, onHand: 292, par: 240, cost: 1.35, price: 5, pourSize: 1,
};
const items = () => [{ ...vodka }, { ...cabernet }, { ...beer }];

/* ------------------------------------------------------------------ *
 * Inventory value
 * ------------------------------------------------------------------ */

test('itemValue multiplies on-hand by cost per unit', () => {
  assert.equal(itemValue(vodka), 120 * 0.62);
  assert.equal(itemValue(cabernet), 144);
});

test('itemValue treats missing or junk figures as zero rather than NaN', () => {
  assert.equal(itemValue({ onHand: 10 }), 0);
  assert.equal(itemValue({ onHand: undefined, cost: 5 }), 0);
  assert.equal(itemValue({ onHand: 'x', cost: 'y' }), 0);
});

test('inventoryValue totals every line', () => {
  assert.equal(Number(inventoryValue(items()).toFixed(2)), Number((74.4 + 144 + 394.2).toFixed(2)));
  assert.equal(inventoryValue([]), 0);
});

test('totalsByUnit keeps ounces and bottles apart', () => {
  const totals = totalsByUnit(items());
  assert.equal(totals[OZ], 120);
  assert.equal(totals[BOTTLE], 304);
});

test('totalsByUnit can total any numeric field', () => {
  const totals = totalsByUnit(items(), 'beginning');
  assert.equal(totals[OZ], 200);
  assert.equal(totals[BOTTLE], 600);
});

/* ------------------------------------------------------------------ *
 * Low stock
 * ------------------------------------------------------------------ */

test('an item at exactly par counts as low', () => {
  assert.equal(isLowStock({ onHand: 24, par: 24 }), true);
});

test('an item above par is not low, below par is low', () => {
  assert.equal(isLowStock({ onHand: 25, par: 24 }), false);
  assert.equal(isLowStock({ onHand: 23.9, par: 24 }), true);
});

test('par of zero means the line is not tracked for reorder', () => {
  assert.equal(isLowStock({ onHand: 0, par: 0 }), false);
  assert.equal(stockRatio({ onHand: 0, par: 0 }), 1);
});

test('out of stock is reported separately from low stock', () => {
  assert.equal(isOutOfStock({ onHand: 0, par: 12 }), true);
  assert.equal(isOutOfStock({ onHand: 0.5, par: 12 }), false);
  assert.equal(isLowStock({ onHand: 0, par: 12 }), true);
});

test('lowStockItems returns the most depleted lines first', () => {
  const list = lowStockItems([
    { id: 1, onHand: 20, par: 24 },   // 0.83
    { id: 2, onHand: 0, par: 12 },    // 0.00
    { id: 3, onHand: 300, par: 240 }, // above par, excluded
    { id: 4, onHand: 6, par: 24 },    // 0.25
  ]);
  assert.deepEqual(list.map(item => item.id), [2, 4, 1]);
});

test('reorderQuantity is the gap to par and never negative', () => {
  assert.equal(reorderQuantity({ onHand: 10, par: 24 }), 14);
  assert.equal(reorderQuantity({ onHand: 300, par: 240 }), 0);
});

/* ------------------------------------------------------------------ *
 * Servings, revenue, cost
 * ------------------------------------------------------------------ */

test('liquor servings divide ounces by the pour size', () => {
  assert.equal(servingsFrom(90, vodka), 60);         // 90 oz at 1.5 oz per pour
  assert.equal(revenueFrom(90, vodka), 600);         // 60 pours at $10
  assert.equal(Number(costFrom(90, vodka).toFixed(2)), 55.8);
});

test('bottled product multiplies bottles by servings per bottle', () => {
  assert.equal(servingsFrom(12, cabernet), 60);      // 12 bottles x 5 glasses
  assert.equal(revenueFrom(12, cabernet), 480);
  assert.equal(servingsFrom(284, beer), 284);
});

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

test('a lower count records consumption and updates on-hand', () => {
  const result = applyCount(items(), { a: 30 });
  assert.equal(result.items[0].onHand, 30);
  assert.equal(result.lines[0].usage, 90);
  assert.equal(result.lines[0].adjustment, 0);
  assert.equal(result.totals.usage[OZ], 90);
  assert.equal(result.totals.usage[BOTTLE], 0);
  assert.equal(result.totals.servings, 60);
  assert.equal(result.totals.revenue, 600);
});

test('a higher count is a positive adjustment, never negative usage', () => {
  const result = applyCount(items(), { a: 150 });
  assert.equal(result.lines[0].usage, 0);
  assert.equal(result.lines[0].adjustment, 30);
  assert.equal(result.totals.usage[OZ], 0);
  assert.equal(result.totals.adjustment[OZ], 30);
  assert.equal(result.items[0].onHand, 150);
});

test('an unchanged count produces no usage and no adjustment', () => {
  const result = applyCount(items(), { a: 120 });
  assert.equal(result.lines[0].usage, 0);
  assert.equal(result.lines[0].adjustment, 0);
  assert.equal(result.totals.revenue, 0);
});

test('counting to zero consumes everything on hand', () => {
  const result = applyCount(items(), { b: 0 });
  assert.equal(result.items[1].onHand, 0);
  assert.equal(result.lines[0].usage, 12);
  assert.equal(result.totals.usage[BOTTLE], 12);
});

test('counts across units are totalled separately', () => {
  const result = applyCount(items(), { a: 30, b: 4, c: 292 });
  assert.equal(result.totals.usage[OZ], 90);
  assert.equal(result.totals.usage[BOTTLE], 8);
  assert.equal(result.totals.counted, 3);
});

test('a partial count leaves untouched lines exactly as they were', () => {
  const before = items();
  const result = applyCount(before, { a: 30 });
  assert.equal(result.lines.length, 1);
  assert.equal(result.items[1].onHand, 12);
  assert.equal(result.items[2].onHand, 292);
});

test('applyCount never mutates the items it was given', () => {
  const before = items();
  applyCount(before, { a: 30 });
  assert.equal(before[0].onHand, 120);
});

test('numeric strings from form inputs are accepted', () => {
  const result = applyCount(items(), { a: '30.5' });
  assert.equal(result.items[0].onHand, 30.5);
  assert.equal(Number(result.lines[0].usage.toFixed(1)), 89.5);
});

test('a negative count is rejected', () => {
  assert.throws(() => applyCount(items(), { a: -1 }), /cannot be negative/);
});

test('a non-numeric count is rejected', () => {
  assert.throws(() => applyCount(items(), { a: 'lots' }), /must be a number/);
});

test('an empty count sheet is rejected', () => {
  assert.throws(() => applyCount(items(), {}), /at least one count/);
});

test('a strict count requires every line', () => {
  assert.throws(() => applyCount(items(), { a: 30 }, { partial: false }), /required for Cabernet/);
});

test('count errors identify the offending field', () => {
  try {
    applyCount(items(), { a: -5 });
    assert.fail('expected a ValidationError');
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.field, 'a');
  }
});

/* ------------------------------------------------------------------ *
 * Restocks
 * ------------------------------------------------------------------ */

test('a restock adds the received quantity to on-hand', () => {
  const result = applyRestock(items(), 'b', 12);
  assert.equal(result.items[1].onHand, 24);
  assert.equal(result.line.previous, 12);
  assert.equal(result.line.received, 12);
  assert.equal(result.line.cost, 144);
});

test('a restock can clear a low-stock flag', () => {
  const before = items()[1];
  assert.equal(isLowStock(before), true);
  const result = applyRestock(items(), 'b', 24);
  assert.equal(isLowStock(result.items[1]), false);
});

test('a restock leaves every other line alone and does not mutate input', () => {
  const before = items();
  const result = applyRestock(before, 'b', 12);
  assert.equal(result.items[0].onHand, 120);
  assert.equal(result.items[2].onHand, 292);
  assert.equal(before[1].onHand, 12);
});

test('fractional ounce deliveries are supported', () => {
  const result = applyRestock(items(), 'a', 25.4);
  assert.equal(Number(result.items[0].onHand.toFixed(1)), 145.4);
});

test('a zero or negative restock is rejected', () => {
  assert.throws(() => applyRestock(items(), 'b', 0), /greater than zero/);
  assert.throws(() => applyRestock(items(), 'b', -5), /cannot be negative/);
});

test('a blank or non-numeric restock quantity is rejected', () => {
  assert.throws(() => applyRestock(items(), 'b', ''), /required/);
  assert.throws(() => applyRestock(items(), 'b', 'a case'), /must be a number/);
});

test('restocking an unknown item is rejected', () => {
  assert.throws(() => applyRestock(items(), 'nope', 5), /Select an inventory item/);
});

/* ------------------------------------------------------------------ *
 * Adjustments
 * ------------------------------------------------------------------ */

test('a negative adjustment removes stock', () => {
  const result = applyAdjustment(items(), 'b', -1, 'Breakage');
  assert.equal(result.items[1].onHand, 11);
  assert.equal(result.line.delta, -1);
  assert.equal(result.line.reason, 'Breakage');
});

test('a positive adjustment adds stock', () => {
  const result = applyAdjustment(items(), 'a', 5.5);
  assert.equal(result.items[0].onHand, 125.5);
});

test('an adjustment cannot push a line below zero', () => {
  assert.throws(() => applyAdjustment(items(), 'b', -13), /Only 12 bottles on hand/);
});

test('a zero adjustment is rejected', () => {
  assert.throws(() => applyAdjustment(items(), 'b', 0), /other than zero/);
});

test('rebaseBeginning resets the period baseline to current on-hand', () => {
  const rebased = rebaseBeginning(items());
  assert.deepEqual(rebased.map(item => item.beginning), [120, 12, 292]);
});

/* ------------------------------------------------------------------ *
 * Do Not Inventory (DNI) — banked write-offs
 * ------------------------------------------------------------------ */

test('a write-off moves stock out of on-hand and into the DNI bank', () => {
  const result = applyWriteOff(items(), 'a', 20, 'Strong cost month');
  assert.equal(result.items[0].onHand, 100);
  assert.equal(result.items[0].dni, 20);
  assert.equal(result.line.previousOnHand, 120);
  assert.equal(result.line.previousDni, 0);
  assert.equal(result.line.cost, 12.4);
  assert.equal(result.line.reason, 'Strong cost month');
});

test('a write-off cannot exceed what is physically on hand', () => {
  assert.throws(() => applyWriteOff(items(), 'a', 121), /Only 120 oz on hand/);
});

test('a write-off leaves other lines and the input untouched', () => {
  const before = items();
  const result = applyWriteOff(before, 'a', 20);
  assert.equal(result.items[1].onHand, 12);
  assert.equal(before[0].onHand, 120);
  assert.equal(before[0].dni, undefined);
});

test('a zero, negative, or blank write-off is rejected', () => {
  assert.throws(() => applyWriteOff(items(), 'a', 0), /greater than zero/);
  assert.throws(() => applyWriteOff(items(), 'a', -5), /cannot be negative/);
  assert.throws(() => applyWriteOff(items(), 'a', ''), /required/);
});

test('write-offs stack in the DNI bank across multiple events', () => {
  let stock = items();
  stock = applyWriteOff(stock, 'a', 20).items;
  stock = applyWriteOff(stock, 'a', 5).items;
  const titos = stock.find(item => item.id === 'a');
  assert.equal(titos.dni, 25);
  assert.equal(titos.onHand, 95);
});

test('using banked stock draws down the DNI bank without touching on-hand', () => {
  const written = applyWriteOff(items(), 'a', 20).items;
  const result = applyDniUse(written, 'a', 8, 'Comped for a VIP table');
  assert.equal(result.items[0].dni, 12);
  assert.equal(result.items[0].onHand, 100); // unchanged by the draw-down
  assert.equal(result.line.previousDni, 20);
  assert.equal(result.line.note, 'Comped for a VIP table');
});

test('using more banked stock than is available is rejected', () => {
  const written = applyWriteOff(items(), 'a', 10).items;
  assert.throws(() => applyDniUse(written, 'a', 11), /Only 10 oz banked/);
});

test('using from an empty DNI bank is rejected', () => {
  assert.throws(() => applyDniUse(items(), 'b', 1), /Only 0 bottles banked/);
});

test('editing a product through normalizeItem preserves its DNI balance', () => {
  const written = applyWriteOff(items(), 'a', 20).items;
  const edited = normalizeItem(
    { name: 'Tito’s Vodka', category: 'Standard Liquor', onHand: 100, par: 200, cost: 0.62 },
    { existing: written, id: 'a' });
  assert.equal(edited.dni, 20);
});

test('a brand-new product starts with no DNI balance', () => {
  const item = normalizeItem({ name: 'Fresh Item', onHand: 10, par: 10, cost: 1 });
  assert.equal(item.dni, 0);
});

test('dniBalance and dniValue total banked stock separately from on-hand', () => {
  let stock = items();
  stock = applyWriteOff(stock, 'a', 20).items; // 20 oz @ 0.62
  stock = applyWriteOff(stock, 'b', 3).items;  // 3 bottles @ 12
  const balance = dniBalance(stock);
  assert.equal(balance[OZ], 20);
  assert.equal(balance[BOTTLE], 3);
  assert.equal(Number(dniValue(stock).toFixed(2)), 12.4 + 36);
});

test('dniItems lists only items with a positive balance, richest first', () => {
  let stock = items();
  stock = applyWriteOff(stock, 'a', 20).items;  // value 12.40
  stock = applyWriteOff(stock, 'b', 3).items;   // value 36.00
  const list = dniItems(stock);
  assert.deepEqual(list.map(item => item.id), ['b', 'a']);
});

test('write-offs and DNI use do not appear as consumption in reports', () => {
  const stock = applyWriteOff(items(), 'a', 20).items;
  const report = buildReport({ items: stock, history: [], events: [], start: '2026-08-01', end: '2026-08-07' });
  assert.equal(report.servings, 0);
  assert.equal(report.consumedCost, 0);
  // But the write-off is reflected immediately in inventory value.
  assert.equal(Number(report.inventoryValue.toFixed(2)), Number(inventoryValue(stock).toFixed(2)));
});

/* ------------------------------------------------------------------ *
 * Item validation
 * ------------------------------------------------------------------ */

test('normalizeItem fills in category defaults and an id', () => {
  const item = normalizeItem({ name: 'Woodford', category: 'Premium Liquor', onHand: 10, par: 20, cost: 1.25 });
  assert.equal(item.unit, OZ);
  assert.equal(item.beginning, 10);
  assert.equal(item.pourSize, 1.5);
  assert.ok(item.id.startsWith('itm_'));
});

test('normalizeItem defaults an unknown category to the first real one', () => {
  const item = normalizeItem({ name: 'Mystery', category: 'Nonsense', onHand: 1, par: 1, cost: 1 });
  assert.equal(item.category, 'Standard Liquor');
});

test('normalizeItem rejects a blank name, negative stock, and negative cost', () => {
  assert.throws(() => normalizeItem({ name: '  ', onHand: 1, par: 1, cost: 1 }), /Item name is required/);
  assert.throws(() => normalizeItem({ name: 'X', onHand: -1, par: 1, cost: 1 }), /cannot be negative/);
  assert.throws(() => normalizeItem({ name: 'X', onHand: 1, par: 1, cost: -2 }), /cannot be negative/);
  assert.throws(() => normalizeItem({ name: 'X', onHand: '', par: 1, cost: 1 }), /On-hand amount is required/);
});

test('normalizeItem rejects a duplicate name but allows renaming an existing item', () => {
  const existing = items();
  assert.throws(
    () => normalizeItem({ name: 'cabernet', onHand: 1, par: 1, cost: 1 }, { existing }),
    /already exists/);
  const same = normalizeItem(
    { name: 'Cabernet', category: 'Wine', onHand: 6, par: 24, cost: 12 },
    { existing, id: 'b' });
  assert.equal(same.id, 'b');
});

test('parse helpers reject blanks and junk', () => {
  assert.throws(() => parseNonNegative('', 'Count'), /Count is required/);
  assert.throws(() => parseNonNegative('abc', 'Count'), /must be a number/);
  assert.throws(() => parsePositive(0, 'Quantity'), /greater than zero/);
  assert.equal(parseNonNegative('0', 'Count'), 0);
  assert.equal(parseNonNegative(' 4.5 ', 'Count'), 4.5);
});

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

test('fmt trims pointless decimals', () => {
  assert.equal(fmt(3), '3');
  assert.equal(fmt(3.5), '3.5');
  assert.equal(fmt(3.04), '3');
  assert.equal(fmt(Number.NaN), '0');
});

test('unit labels pluralise bottles but never ounces', () => {
  assert.equal(unitLabel(OZ, 1), 'oz');
  assert.equal(unitLabel(BOTTLE, 1), 'bottle');
  assert.equal(unitLabel(BOTTLE, 2), 'bottles');
  assert.equal(quantityLabel(2.5, BOTTLE), '2.5 bottles');
});

test('money formats US dollars', () => {
  assert.equal(money(1542.755), '$1,542.76');
  assert.equal(money(0), '$0.00');
});

/* ------------------------------------------------------------------ *
 * Dates and reporting
 * ------------------------------------------------------------------ */

test('withinRange is inclusive on both ends', () => {
  assert.equal(withinRange('2026-08-01T23:00:00.000Z', '2026-08-01', '2026-08-07'), true);
  assert.equal(withinRange('2026-08-07', '2026-08-01', '2026-08-07'), true);
  assert.equal(withinRange('2026-07-31', '2026-08-01', '2026-08-07'), false);
  assert.equal(withinRange('2026-08-08', '2026-08-01', '2026-08-07'), false);
});

test('isoDate uses local time, not UTC', () => {
  const local = new Date(2026, 7, 9, 23, 30);
  assert.equal(isoDate(local), '2026-08-09');
});

const history = [
  {
    id: 'h1', type: 'count', date: '2026-08-01T23:00:00.000Z',
    eventId: 'e1', eventName: 'Delgado Wedding',
    lines: [
      { itemId: 'a', name: 'Tito’s Vodka', category: 'Standard Liquor', unit: OZ, usage: 90, adjustment: 0, servings: 60, revenue: 600, cost: 55.8 },
      { itemId: 'b', name: 'Cabernet', category: 'Wine', unit: BOTTLE, usage: 12, adjustment: 0, servings: 60, revenue: 480, cost: 144 },
    ],
    totals: { usage: { [OZ]: 90, [BOTTLE]: 12 }, adjustment: { [OZ]: 0, [BOTTLE]: 0 }, servings: 120, revenue: 1080, cost: 199.8, counted: 2 },
  },
  {
    id: 'h2', type: 'count', date: '2026-08-03T23:00:00.000Z',
    lines: [
      { itemId: 'a', name: 'Tito’s Vodka', category: 'Standard Liquor', unit: OZ, usage: 15, adjustment: 0, servings: 10, revenue: 100, cost: 9.3 },
    ],
    totals: { usage: { [OZ]: 15, [BOTTLE]: 0 }, adjustment: { [OZ]: 0, [BOTTLE]: 0 }, servings: 10, revenue: 100, cost: 9.3, counted: 1 },
  },
  {
    id: 'h3', type: 'restock', date: '2026-08-04T15:00:00.000Z',
    lines: [{ itemId: 'a', name: 'Tito’s Vodka', unit: OZ, previous: 15, received: 200, onHand: 215, cost: 124 }],
    totals: { cost: 124, received: 1 },
  },
  {
    id: 'h4', type: 'count', date: '2026-09-01T23:00:00.000Z',
    lines: [{ itemId: 'c', name: 'Domestic Beer', category: 'Beer', unit: BOTTLE, usage: 284, adjustment: 0, servings: 284, revenue: 1420, cost: 383.4 }],
    totals: { usage: { [OZ]: 0, [BOTTLE]: 284 }, adjustment: { [OZ]: 0, [BOTTLE]: 0 }, servings: 284, revenue: 1420, cost: 383.4, counted: 1 },
  },
];

test('topConsumed ranks by revenue and ignores untouched products', () => {
  const top = topConsumed(history);
  assert.deepEqual(top.map(row => row.name), ['Domestic Beer', 'Tito’s Vodka', 'Cabernet']);
  assert.equal(top[1].usage, 105); // 90 + 15 across two counts
  assert.equal(top[1].revenue, 700);
});

test('consumptionByCategory groups the mix', () => {
  const mix = consumptionByCategory(history);
  assert.deepEqual(mix.map(row => row.category), ['Beer', 'Standard Liquor', 'Wine']);
});

test('trendByDay produces one bucket per day with no gaps', () => {
  const trend = trendByDay(history, '2026-08-01', '2026-08-05');
  assert.equal(trend.length, 5);
  assert.deepEqual(trend.map(day => day.servings), [120, 0, 10, 0, 0]);
  assert.equal(trend[0].revenue, 1080);
});

test('consumptionByEvent rolls counts up per event and lists events with no count yet', () => {
  const rows = consumptionByEvent(history, [
    { id: 'e1', name: 'Delgado Wedding', date: '2026-08-01' },
    { id: 'e2', name: 'Founders Night', date: '2026-08-06' },
  ]);
  const delgado = rows.find(row => row.eventId === 'e1');
  const founders = rows.find(row => row.eventId === 'e2');
  assert.equal(delgado.servings, 120);
  assert.equal(delgado.revenue, 1080);
  assert.equal(delgado.usage[OZ], 90);
  assert.equal(founders.counts, 0);
  assert.equal(founders.revenue, 0);
});

test('deleting an event drops it from consumptionByEvent even though its history remains', () => {
  const withoutDelgado = consumptionByEvent(history, [
    { id: 'e2', name: 'Founders Night', date: '2026-08-06' },
  ]);
  assert.equal(withoutDelgado.some(row => row.eventId === 'e1'), false);
  assert.equal(withoutDelgado.length, 1);
  // The underlying history entry is untouched — only the grouped-by-event view changes.
  assert.equal(history[0].eventId, 'e1');
  assert.equal(history[0].eventName, 'Delgado Wedding');
});

test('buildReport only counts activity inside the date range', () => {
  const report = buildReport({ items: items(), history, events: [], start: '2026-08-01', end: '2026-08-07' });
  assert.equal(report.counts, 2);
  assert.equal(report.restocks, 1);
  assert.equal(report.servings, 130);
  assert.equal(report.revenue, 1180);
  assert.equal(report.receivedCost, 124);
  assert.equal(report.usage[BOTTLE], 12);
  assert.equal(report.trend.length, 7);
  assert.ok(!report.top.some(row => row.name === 'Domestic Beer')); // September entry excluded
});

test('buildReport reports current inventory value and low stock alongside usage', () => {
  const report = buildReport({ items: items(), history: [], events: [], start: '2026-08-01', end: '2026-08-07' });
  assert.equal(report.servings, 0);
  assert.equal(Number(report.inventoryValue.toFixed(2)), 612.6);
  assert.deepEqual(report.lowStock.map(item => item.name), ['Cabernet', 'Tito’s Vodka']);
});

test('shiftDays walks backwards from today', () => {
  const today = isoDate();
  assert.equal(shiftDays(0), today);
  assert.notEqual(shiftDays(-7), today);
});

/* ------------------------------------------------------------------ *
 * Backup and restore
 * ------------------------------------------------------------------ */

test('a backup round-trips through parseBackup', () => {
  const backup = buildBackup({ items: items(), events: [{ id: 'e1', name: 'Gala', date: '2026-08-01' }], history, settings: { seeded: true } });
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.items.length, 3);
  assert.equal(restored.items[0].name, 'Tito’s Vodka');
  assert.equal(restored.events[0].name, 'Gala');
  assert.equal(restored.history.length, history.length);
});

test('restoring rubbish is refused with a readable message', () => {
  assert.throws(() => parseBackup('not json at all'), /not valid JSON/);
  assert.throws(() => parseBackup('{}'), /no inventory items/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'some-other-app', items: [] })), /different app/);
});

test('restoring drops malformed history rows instead of crashing', () => {
  const restored = parseBackup(JSON.stringify({
    format: 'the-barn-inventory',
    items: [vodka],
    history: [{ type: 'count', date: '2026-08-01T00:00:00.000Z' }, null, { nope: true }],
  }));
  assert.equal(restored.history.length, 1);
});
