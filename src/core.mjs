/**
 * The Barn — pure inventory domain rules.
 *
 * Nothing in this file touches the DOM, the network, or localStorage. Every
 * function takes plain data and returns plain data, so the same rules can run
 * in the browser today and behind a shared API later (see src/storage.mjs).
 */

export const OZ = 'oz';
export const BOTTLE = 'bottle';
export const UNITS = [OZ, BOTTLE];

/**
 * Category catalogue mirrors the venue's existing spreadsheet sections.
 * `unit` is the default measurement for new items in that category:
 * liquor and cocktails are poured, so they are tracked in liquid ounces;
 * wine, beer and sodas are received and counted by the bottle.
 */
export const CATEGORIES = [
  { id: 'standard-liquor', name: 'Standard Liquor', unit: OZ, accent: '#5d7f6d' },
  { id: 'premium-liquor', name: 'Premium Liquor', unit: OZ, accent: '#b08447' },
  { id: 'local-liquor', name: 'Local Liquor', unit: OZ, accent: '#7a6a52' },
  { id: 'wine', name: 'Wine', unit: BOTTLE, accent: '#8d4652' },
  { id: 'beer', name: 'Beer', unit: BOTTLE, accent: '#c08a2e' },
  { id: 'signature-cocktail', name: 'Signature Cocktails', unit: OZ, accent: '#4f7d86' },
  { id: 'table-side-wine', name: 'Table-Side Wine', unit: BOTTLE, accent: '#9a5f77' },
  { id: 'soda-mixers', name: 'Soda & Mixers', unit: BOTTLE, accent: '#547a8c' },
];

export const CATEGORY_NAMES = CATEGORIES.map(category => category.name);

export function categoryMeta(name) {
  return CATEGORIES.find(category => category.name === name)
    || { id: 'other', name: name || 'Other', unit: BOTTLE, accent: '#6b7a70' };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** Trim trailing zeros so "12.0 oz" reads as "12 oz" on a busy shift. */
export function fmt(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  const rounded = Number(number.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function money(value, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

export function moneyShort(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 10000) return `$${Math.round(number / 1000)}k`;
  return money(number, 0);
}

/** "oz" stays "oz"; "bottle" pluralises. */
export function unitLabel(unit, quantity = 2) {
  if (unit === OZ) return 'oz';
  return Math.abs(Number(quantity)) === 1 ? 'bottle' : 'bottles';
}

export function quantityLabel(quantity, unit) {
  return `${fmt(quantity)} ${unitLabel(unit, quantity)}`;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Accepts numbers or numeric strings; rejects blanks, junk, and negatives. */
export function parseNonNegative(value, label = 'Value', field) {
  if (value === '' || value === null || value === undefined) {
    throw new ValidationError(`${label} is required`, field);
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) throw new ValidationError(`${label} must be a number`, field);
  if (number < 0) throw new ValidationError(`${label} cannot be negative`, field);
  return number;
}

export function parsePositive(value, label = 'Value', field) {
  const number = parseNonNegative(value, label, field);
  if (number <= 0) throw new ValidationError(`${label} must be greater than zero`, field);
  return number;
}

export function parseText(value, label = 'Name', field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${label} is required`, field);
  return text;
}

/**
 * Normalise + validate an item coming from a form or an imported backup.
 *
 * `dni` (its banked do-not-inventory balance) is deliberately not a field on
 * the edit form — it only ever changes through applyWriteOff/applyDniUse —
 * so when the caller doesn't supply it, it carries over from the matching
 * item in `existing` rather than silently resetting to zero on every edit.
 */
export function normalizeItem(input, { existing = [], id } = {}) {
  const current = existing.find(item => item.id === id);
  const name = parseText(input.name, 'Item name', 'name');
  const category = CATEGORY_NAMES.includes(input.category) ? input.category : CATEGORY_NAMES[0];
  const unit = UNITS.includes(input.unit) ? input.unit : categoryMeta(category).unit;
  const duplicate = existing.some(item =>
    item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) throw new ValidationError('An item with that name already exists', 'name');

  const onHand = parseNonNegative(input.onHand, 'On-hand amount', 'onHand');
  const beginning = input.beginning === '' || input.beginning === undefined || input.beginning === null
    ? onHand
    : parseNonNegative(input.beginning, 'Beginning inventory', 'beginning');
  const par = parseNonNegative(input.par, 'Par level', 'par');
  const cost = parseNonNegative(input.cost, 'Cost per unit', 'cost');
  const price = parseNonNegative(input.price ?? 0, 'Menu price per serving', 'price');
  const pourSize = unit === OZ
    ? parsePositive(input.pourSize || 1.5, 'Pour size', 'pourSize')
    : parsePositive(input.pourSize || 1, 'Servings per bottle', 'pourSize');
  const dni = input.dni !== undefined && input.dni !== null && input.dni !== ''
    ? parseNonNegative(input.dni, 'Write-off balance', 'dni')
    : (current?.dni ?? 0);

  return {
    id: id || newId('itm'),
    name,
    category,
    unit,
    beginning,
    onHand,
    par,
    cost,
    price,
    pourSize,
    dni,
  };
}

/* ------------------------------------------------------------------ *
 * Identity & dates
 * ------------------------------------------------------------------ */

let counter = 0;
export function newId(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Local (not UTC) YYYY-MM-DD, so a late-night count keeps the right date. */
export function isoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function dateLabel(value) {
  const date = typeof value === 'string' && value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function relativeLabel(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const today = isoDate(now);
  const stamp = isoDate(date);
  if (stamp === today) return `Today, ${timeLabel(date)}`;
  const yesterday = isoDate(new Date(now.getTime() - 86400000));
  if (stamp === yesterday) return `Yesterday, ${timeLabel(date)}`;
  return `${dateLabel(stamp)}, ${timeLabel(date)}`;
}

export function shiftDays(days, from = new Date()) {
  return isoDate(new Date(new Date(from).getTime() + days * 86400000));
}

/** Inclusive date-range test against a YYYY-MM-DD or ISO timestamp. */
export function withinRange(value, start, end) {
  const stamp = String(value).slice(0, 10);
  if (start && stamp < start) return false;
  if (end && stamp > end) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Inventory maths
 * ------------------------------------------------------------------ */

export function itemValue(item) {
  const onHand = Number(item?.onHand) || 0;
  const cost = Number(item?.cost) || 0;
  return onHand * cost;
}

export function inventoryValue(items = []) {
  return items.reduce((total, item) => total + itemValue(item), 0);
}

/** Totals kept per unit — ounces and bottles must never be added together. */
export function totalsByUnit(items = [], field = 'onHand') {
  const totals = { [OZ]: 0, [BOTTLE]: 0 };
  for (const item of items) {
    const unit = UNITS.includes(item.unit) ? item.unit : BOTTLE;
    totals[unit] += Number(item[field]) || 0;
  }
  return totals;
}

/** 0 = empty, 1 = at par, >1 = above par. Items with no par never look low. */
export function stockRatio(item) {
  const par = Number(item?.par) || 0;
  if (par <= 0) return 1;
  return (Number(item?.onHand) || 0) / par;
}

/** Low stock = at or below par. Par 0 means "not tracked for reorder". */
export function isLowStock(item) {
  const par = Number(item?.par) || 0;
  if (par <= 0) return false;
  return (Number(item?.onHand) || 0) <= par;
}

export function isOutOfStock(item) {
  return (Number(item?.onHand) || 0) <= 0;
}

export function lowStockItems(items = []) {
  return items.filter(isLowStock).sort((a, b) => stockRatio(a) - stockRatio(b));
}

/** Units to order to return to par (never negative). */
export function reorderQuantity(item) {
  return Math.max(0, (Number(item?.par) || 0) - (Number(item?.onHand) || 0));
}

/** Servings poured from a usage amount. Bottles use servings-per-bottle. */
export function servingsFrom(usage, item) {
  const size = Number(item?.pourSize) || (item?.unit === OZ ? 1.5 : 1);
  if (size <= 0) return 0;
  return item?.unit === OZ ? (Number(usage) || 0) / size : (Number(usage) || 0) * size;
}

export function revenueFrom(usage, item) {
  return servingsFrom(usage, item) * (Number(item?.price) || 0);
}

export function costFrom(usage, item) {
  return (Number(usage) || 0) * (Number(item?.cost) || 0);
}

/* ------------------------------------------------------------------ *
 * Transactions — each returns new arrays, never mutates the input
 * ------------------------------------------------------------------ */

const emptyTotals = () => ({
  usage: { [OZ]: 0, [BOTTLE]: 0 },
  adjustment: { [OZ]: 0, [BOTTLE]: 0 },
  servings: 0,
  revenue: 0,
  cost: 0,
  counted: 0,
});

/**
 * Apply a physical count.
 *
 * A decrease from the previous on-hand figure is consumption. An increase is
 * recorded as a positive adjustment (product found, mis-keyed prior count)
 * so reported consumption can never go negative.
 *
 * `counts` maps itemId -> counted amount. Items missing from the map are left
 * untouched, which lets staff count one section at a time.
 */
export function applyCount(items = [], counts = {}, { partial = true } = {}) {
  const lines = [];
  const totals = emptyTotals();

  const updated = items.map(item => {
    const key = String(item.id);
    const raw = counts[key];
    if (raw === undefined || raw === null || raw === '') {
      if (partial) return item;
      throw new ValidationError(`A count is required for ${item.name}`, key);
    }
    const counted = parseNonNegative(raw, `Count for ${item.name}`, key);
    const previous = Number(item.onHand) || 0;
    const delta = counted - previous;
    const usage = Math.max(0, -delta);
    const adjustment = Math.max(0, delta);
    const servings = servingsFrom(usage, item);
    const revenue = revenueFrom(usage, item);
    const cost = costFrom(usage, item);

    totals.usage[item.unit] += usage;
    totals.adjustment[item.unit] += adjustment;
    totals.servings += servings;
    totals.revenue += revenue;
    totals.cost += cost;
    totals.counted += 1;

    lines.push({
      itemId: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      previous,
      counted,
      usage,
      adjustment,
      servings,
      revenue,
      cost,
    });

    return { ...item, onHand: counted };
  });

  if (!lines.length) throw new ValidationError('Enter at least one count before saving');
  return { items: updated, lines, totals };
}

/**
 * Record usage directly instead of deriving it from a physical count — for
 * an event where you know what was poured without re-counting the whole
 * shelf. `usage` maps itemId -> amount used (not the new on-hand figure).
 * Produces the same line/total shape as applyCount, so every report,
 * export, and activity-log entry that reads a 'count' history entry works
 * identically regardless of which flow produced it. `adjustment` is always
 * 0 here — this flow has no way to represent "found extra product," only
 * applyCount's physical-recount path does.
 */
export function applyUsage(items = [], usage = {}, { partial = true } = {}) {
  const lines = [];
  const totals = emptyTotals();

  const updated = items.map(item => {
    const key = String(item.id);
    const raw = usage[key];
    if (raw === undefined || raw === null || raw === '') {
      if (partial) return item;
      throw new ValidationError(`Usage is required for ${item.name}`, key);
    }
    const used = parseNonNegative(raw, `Usage for ${item.name}`, key);
    const previous = Number(item.onHand) || 0;
    if (used > previous) {
      throw new ValidationError(
        `Only ${quantityLabel(previous, item.unit)} on hand for ${item.name} — reduce the amount`, key);
    }
    const counted = previous - used;
    const servings = servingsFrom(used, item);
    const revenue = revenueFrom(used, item);
    const cost = costFrom(used, item);

    totals.usage[item.unit] += used;
    totals.servings += servings;
    totals.revenue += revenue;
    totals.cost += cost;
    totals.counted += 1;

    lines.push({
      itemId: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      previous,
      counted,
      usage: used,
      adjustment: 0,
      servings,
      revenue,
      cost,
    });

    return { ...item, onHand: counted };
  });

  if (!lines.length) throw new ValidationError('Enter usage for at least one product before saving');
  return { items: updated, lines, totals };
}

/** Receive a delivery: quantity is added to on-hand. Must be > 0. */
export function applyRestock(items = [], itemId, quantity) {
  const amount = parsePositive(quantity, 'Quantity received', 'quantity');
  const target = items.find(item => String(item.id) === String(itemId));
  if (!target) throw new ValidationError('Select an inventory item', 'itemId');

  const previous = Number(target.onHand) || 0;
  const updated = items.map(item => (
    String(item.id) === String(itemId) ? { ...item, onHand: previous + amount } : item
  ));

  return {
    items: updated,
    line: {
      itemId: target.id,
      name: target.name,
      category: target.category,
      unit: target.unit,
      previous,
      received: amount,
      onHand: previous + amount,
      cost: amount * (Number(target.cost) || 0),
    },
  };
}

/**
 * Manual correction — waste, breakage, transfer, or a fixed typo.
 * `delta` may be negative but can never push on-hand below zero.
 */
export function applyAdjustment(items = [], itemId, delta, reason = '') {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new ValidationError('Enter an adjustment amount other than zero', 'delta');
  }
  const target = items.find(item => String(item.id) === String(itemId));
  if (!target) throw new ValidationError('Select an inventory item', 'itemId');

  const previous = Number(target.onHand) || 0;
  const next = previous + amount;
  if (next < 0) {
    throw new ValidationError(
      `Only ${quantityLabel(previous, target.unit)} on hand — reduce the amount`, 'delta');
  }

  return {
    items: items.map(item => (String(item.id) === String(itemId) ? { ...item, onHand: next } : item)),
    line: {
      itemId: target.id,
      name: target.name,
      category: target.category,
      unit: target.unit,
      previous,
      delta: amount,
      onHand: next,
      reason: String(reason || '').trim(),
    },
  };
}

/** Reset beginning inventory to current on-hand — start of a new period. */
export function rebaseBeginning(items = []) {
  return items.map(item => ({ ...item, beginning: Number(item.onHand) || 0 }));
}

/* ------------------------------------------------------------------ *
 * Do Not Inventory (DNI) — banked write-offs
 *
 * A write-off removes stock from official on-hand (so it stops counting
 * toward inventory value, par, and reorder alerts — the point of writing it
 * off in the first place) and banks the same quantity on the item's `dni`
 * balance. Drawing from that bank later never touches onHand or cost again:
 * it was already expensed at write-off time, so using it is free.
 * ------------------------------------------------------------------ */

/** Write off stock: moves `quantity` from on-hand into the item's DNI bank. */
export function applyWriteOff(items = [], itemId, quantity, reason = '') {
  const amount = parsePositive(quantity, 'Write-off quantity', 'quantity');
  const target = items.find(item => String(item.id) === String(itemId));
  if (!target) throw new ValidationError('Select an inventory item', 'itemId');

  const previousOnHand = Number(target.onHand) || 0;
  if (amount > previousOnHand) {
    throw new ValidationError(
      `Only ${quantityLabel(previousOnHand, target.unit)} on hand — reduce the amount`, 'quantity');
  }
  const previousDni = Number(target.dni) || 0;
  const onHand = previousOnHand - amount;
  const dni = previousDni + amount;

  return {
    items: items.map(item => (String(item.id) === String(itemId) ? { ...item, onHand, dni } : item)),
    line: {
      itemId: target.id,
      name: target.name,
      category: target.category,
      unit: target.unit,
      previousOnHand,
      onHand,
      previousDni,
      dni,
      quantity: amount,
      cost: amount * (Number(target.cost) || 0),
      reason: String(reason || '').trim(),
    },
  };
}

/** Draw down banked stock for use. Never touches on-hand or cost again. */
export function applyDniUse(items = [], itemId, quantity, note = '') {
  const amount = parsePositive(quantity, 'Quantity to use', 'quantity');
  const target = items.find(item => String(item.id) === String(itemId));
  if (!target) throw new ValidationError('Select an inventory item', 'itemId');

  const previousDni = Number(target.dni) || 0;
  if (amount > previousDni) {
    throw new ValidationError(
      `Only ${quantityLabel(previousDni, target.unit)} banked — reduce the amount`, 'quantity');
  }
  const dni = previousDni - amount;

  return {
    items: items.map(item => (String(item.id) === String(itemId) ? { ...item, dni } : item)),
    line: {
      itemId: target.id,
      name: target.name,
      category: target.category,
      unit: target.unit,
      previousDni,
      dni,
      quantity: amount,
      note: String(note || '').trim(),
    },
  };
}

export function dniBalance(items = []) {
  return totalsByUnit(items, 'dni');
}

export function dniValue(items = []) {
  return items.reduce((total, item) => total + (Number(item.dni) || 0) * (Number(item.cost) || 0), 0);
}

/** Items currently holding a banked balance, largest value first. */
export function dniItems(items = []) {
  return items
    .filter(item => (Number(item.dni) || 0) > 0)
    .sort((a, b) => (Number(b.dni) * b.cost) - (Number(a.dni) * a.cost));
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export function entriesInRange(history = [], start, end) {
  return history.filter(entry => withinRange(entry.date, start, end));
}

/** Aggregate consumption per item across count entries in range. */
export function consumptionByItem(history = []) {
  const map = new Map();
  for (const entry of history) {
    if (entry.type !== 'count') continue;
    for (const line of entry.lines || []) {
      const key = String(line.itemId);
      const row = map.get(key) || {
        itemId: line.itemId,
        name: line.name,
        category: line.category,
        unit: line.unit,
        usage: 0,
        servings: 0,
        revenue: 0,
        cost: 0,
      };
      row.usage += Number(line.usage) || 0;
      row.servings += Number(line.servings) || 0;
      row.revenue += Number(line.revenue) || 0;
      row.cost += Number(line.cost) || 0;
      map.set(key, row);
    }
  }
  return [...map.values()];
}

export function topConsumed(history = [], limit = 5) {
  return consumptionByItem(history)
    .filter(row => row.usage > 0)
    .sort((a, b) => (b.revenue - a.revenue) || (b.usage - a.usage))
    .slice(0, limit);
}

export function consumptionByCategory(history = []) {
  const map = new Map();
  for (const row of consumptionByItem(history)) {
    const current = map.get(row.category) || { category: row.category, unit: row.unit, usage: 0, servings: 0, revenue: 0 };
    current.usage += row.usage;
    current.servings += row.servings;
    current.revenue += row.revenue;
    map.set(row.category, current);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/** One bucket per calendar day in the range, so the chart has no gaps. */
export function trendByDay(history = [], start, end) {
  const days = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return days;

  const buckets = new Map();
  for (const entry of history) {
    if (entry.type !== 'count') continue;
    const key = String(entry.date).slice(0, 10);
    const bucket = buckets.get(key) || { servings: 0, revenue: 0, oz: 0, bottle: 0 };
    bucket.servings += Number(entry.totals?.servings) || 0;
    bucket.revenue += Number(entry.totals?.revenue) || 0;
    bucket.oz += Number(entry.totals?.usage?.[OZ]) || 0;
    bucket.bottle += Number(entry.totals?.usage?.[BOTTLE]) || 0;
    buckets.set(key, bucket);
  }

  let guard = 0;
  while (cursor <= last && guard < 400) {
    const key = isoDate(cursor);
    days.push({ date: key, ...(buckets.get(key) || { servings: 0, revenue: 0, oz: 0, bottle: 0 }) });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return days;
}

/**
 * Grouped by *currently existing* events only. A deleted event's counts
 * still keep their eventName label in the raw activity log — this view
 * just stops surfacing it as its own row, at any date range, once it's
 * gone, rather than only hiding it from the count-context picker.
 */
export function consumptionByEvent(history = [], events = []) {
  const validIds = new Set(events.map(event => String(event.id)));
  const map = new Map();
  for (const entry of history) {
    if (entry.type !== 'count' || !entry.eventId) continue;
    const key = String(entry.eventId);
    if (!validIds.has(key)) continue;
    const row = map.get(key) || {
      eventId: entry.eventId,
      name: entry.eventName || 'Event',
      date: String(entry.date).slice(0, 10),
      counts: 0,
      servings: 0,
      revenue: 0,
      usage: { [OZ]: 0, [BOTTLE]: 0 },
      lines: [],
    };
    row.counts += 1;
    row.servings += Number(entry.totals?.servings) || 0;
    row.revenue += Number(entry.totals?.revenue) || 0;
    row.usage[OZ] += Number(entry.totals?.usage?.[OZ]) || 0;
    row.usage[BOTTLE] += Number(entry.totals?.usage?.[BOTTLE]) || 0;
    row.lines.push(...(entry.lines || []));
    if (String(entry.date).slice(0, 10) < row.date) row.date = String(entry.date).slice(0, 10);
    map.set(key, row);
  }

  for (const event of events) {
    const key = String(event.id);
    if (!map.has(key)) {
      map.set(key, {
        eventId: event.id,
        name: event.name,
        date: event.date,
        counts: 0,
        servings: 0,
        revenue: 0,
        usage: { [OZ]: 0, [BOTTLE]: 0 },
        lines: [],
      });
    }
  }

  return [...map.values()].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
}

/** Everything the Reports view needs for a given date range. */
export function buildReport({ items = [], history = [], events = [], start, end }) {
  const scoped = entriesInRange(history, start, end);
  const counts = scoped.filter(entry => entry.type === 'count');
  const restocks = scoped.filter(entry => entry.type === 'restock');

  const usage = { [OZ]: 0, [BOTTLE]: 0 };
  let servings = 0;
  let revenue = 0;
  let consumedCost = 0;
  for (const entry of counts) {
    usage[OZ] += Number(entry.totals?.usage?.[OZ]) || 0;
    usage[BOTTLE] += Number(entry.totals?.usage?.[BOTTLE]) || 0;
    servings += Number(entry.totals?.servings) || 0;
    revenue += Number(entry.totals?.revenue) || 0;
    consumedCost += Number(entry.totals?.cost) || 0;
  }

  const receivedCost = restocks.reduce((total, entry) => total + (Number(entry.totals?.cost) || 0), 0);

  return {
    start,
    end,
    entries: scoped,
    counts: counts.length,
    restocks: restocks.length,
    usage,
    servings,
    revenue,
    consumedCost,
    receivedCost,
    inventoryValue: inventoryValue(items),
    lowStock: lowStockItems(items),
    top: topConsumed(scoped, 6),
    byCategory: consumptionByCategory(scoped),
    byEvent: consumptionByEvent(scoped, events),
    trend: trendByDay(scoped, start, end),
  };
}

/* ------------------------------------------------------------------ *
 * Backups
 * ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 'the-barn-inventory';
export const SCHEMA_VERSION = 1;

export function buildBackup(state, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    items: state.items || [],
    events: state.events || [],
    history: state.history || [],
    settings: state.settings || {},
  };
}

/** Strict enough to refuse a stranger's JSON, loose enough for old exports. */
export function parseBackup(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ValidationError('That file is not valid JSON');
    }
  }
  if (!data || typeof data !== 'object') throw new ValidationError('That file is not a Barn backup');
  if (data.format && data.format !== BACKUP_FORMAT) {
    throw new ValidationError('That backup came from a different app');
  }
  if (!Array.isArray(data.items)) throw new ValidationError('That backup has no inventory items');

  const items = data.items.map(item => normalizeItem(item, { id: item.id || newId('itm') }));
  const events = Array.isArray(data.events)
    ? data.events.map(event => ({
        id: event.id || newId('evt'),
        name: parseText(event.name, 'Event name'),
        date: String(event.date || isoDate()).slice(0, 10),
        notes: String(event.notes || ''),
      }))
    : [];
  const history = Array.isArray(data.history)
    ? data.history.filter(entry => entry && typeof entry === 'object' && entry.type && entry.date)
    : [];

  return { items, events, history, settings: data.settings && typeof data.settings === 'object' ? data.settings : {} };
}
