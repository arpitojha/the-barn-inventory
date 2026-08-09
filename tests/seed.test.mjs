import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedData } from '../src/seed.mjs';
import { OZ, BOTTLE, isLowStock, inventoryValue, buildReport, isoDate, shiftDays } from '../src/core.mjs';

const seed = buildSeedData();

test('the sample data opens on the figures from the venue spreadsheet', () => {
  const find = name => seed.items.find(item => item.name === name);
  assert.equal(find('Tito’s Vodka').onHand, 109.8);
  assert.equal(find('Tito’s Vodka').beginning, 199.8);
  assert.equal(find('Grey Goose').onHand, 140.3);
  assert.equal(find('Teremana').onHand, 51.1);
  assert.equal(find('Cabernet').onHand, 12);
  assert.equal(find('Domestic Beer').onHand, 292);
  assert.equal(find('Espresso Martini').onHand, 47.9);
  assert.equal(find('Sodas').onHand, 28);
});

test('every sample line carries the fields the app depends on', () => {
  for (const item of seed.items) {
    assert.ok(item.id && item.name, 'id and name');
    assert.ok([OZ, BOTTLE].includes(item.unit), `${item.name} has a valid unit`);
    assert.ok(Number.isFinite(item.onHand) && item.onHand >= 0, `${item.name} on-hand`);
    assert.ok(Number.isFinite(item.beginning) && item.beginning >= 0, `${item.name} beginning`);
    assert.ok(Number.isFinite(item.cost) && item.cost >= 0, `${item.name} cost`);
    assert.ok(item.pourSize > 0, `${item.name} pour size`);
  }
});

test('liquor is tracked in ounces and wine, beer and mixers by the bottle', () => {
  const unitFor = category => new Set(seed.items.filter(item => item.category === category).map(item => item.unit));
  assert.deepEqual([...unitFor('Standard Liquor')], [OZ]);
  assert.deepEqual([...unitFor('Premium Liquor')], [OZ]);
  assert.deepEqual([...unitFor('Signature Cocktails')], [OZ]);
  assert.deepEqual([...unitFor('Wine')], [BOTTLE]);
  assert.deepEqual([...unitFor('Beer')], [BOTTLE]);
  assert.deepEqual([...unitFor('Soda & Mixers')], [BOTTLE]);
});

test('the closing count reconciles: pulled minus usage equals what is on hand', () => {
  const closing = seed.history.find(entry => entry.type === 'count' && entry.eventName === 'Miller Wedding');
  assert.ok(closing, 'closing event count exists');
  for (const line of closing.lines) {
    const item = seed.items.find(row => row.id === line.itemId);
    assert.equal(item.onHand, line.counted, `${line.name} on-hand matches its counted figure`);
    assert.equal(
      Number((line.previous - line.usage + line.adjustment).toFixed(1)),
      Number(line.counted.toFixed(1)),
      `${line.name} reconciles`);
  }
});

test('the closing count matches the spreadsheet usage for the headline lines', () => {
  const closing = seed.history.find(entry => entry.type === 'count' && entry.eventName === 'Miller Wedding');
  const usage = name => closing.lines.find(line => line.name === name)?.usage ?? 0;
  assert.equal(Number(usage('Tito’s Vodka').toFixed(1)), 90);      // 199.8 - 109.8
  assert.equal(Number(usage('Grey Goose').toFixed(1)), 151.4);     // 291.7 - 140.3
  assert.equal(Number(usage('Woodford Reserve').toFixed(1)), 154.9);
  assert.equal(usage('Domestic Beer'), 284);
  assert.equal(usage('Sauvignon Blanc'), 22);
  assert.equal(usage('Sodas'), 164);
});

test('the sample history is a full audit trail, newest first', () => {
  const types = new Set(seed.history.map(entry => entry.type));
  assert.ok(types.has('count'));
  assert.ok(types.has('restock'));
  assert.ok(types.has('adjustment'));
  for (let index = 1; index < seed.history.length; index += 1) {
    assert.ok(seed.history[index - 1].date >= seed.history[index].date, 'entries are ordered newest first');
  }
});

test('the sample data shows low stock and a non-trivial inventory value', () => {
  assert.ok(seed.items.some(isLowStock), 'at least one line is below par');
  assert.ok(inventoryValue(seed.items) > 1000, 'inventory value is meaningful');
});

test('a 30-day report over the sample data has usage, events and a full trend', () => {
  const report = buildReport({
    items: seed.items,
    history: seed.history,
    events: seed.events,
    start: shiftDays(-29),
    end: isoDate(),
  });
  assert.ok(report.counts >= 5, 'several counts in range');
  assert.ok(report.servings > 1000, 'servings accumulate');
  assert.ok(report.revenue > 10000, 'revenue accumulates');
  assert.equal(report.trend.length, 30);
  assert.equal(report.byEvent.length, seed.events.length);
  assert.ok(report.top.length > 0);
});
