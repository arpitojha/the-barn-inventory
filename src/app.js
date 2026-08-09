/**
 * The Barn — application shell.
 *
 * This file owns the DOM and nothing else: every inventory rule lives in
 * core.mjs and every read/write goes through the repository in storage.mjs.
 */

import {
  OZ, BOTTLE, CATEGORIES, CATEGORY_NAMES, categoryMeta,
  fmt, money, moneyShort, unitLabel, quantityLabel,
  ValidationError, normalizeItem, newId,
  isoDate, dateLabel, relativeLabel, shiftDays,
  inventoryValue, itemValue, totalsByUnit, stockRatio, isLowStock, isOutOfStock,
  lowStockItems, reorderQuantity, revenueFrom,
  applyCount, applyRestock, applyAdjustment, rebaseBeginning,
  applyWriteOff, applyDniUse, dniValue, dniItems,
  buildReport, buildBackup, parseBackup,
} from './core.mjs';
import { createRepository, defaultAdapter } from './storage.mjs';
import { buildSeedData } from './seed.mjs';

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const repo = createRepository(defaultAdapter());

const state = {
  items: [],
  events: [],
  history: [],
  settings: {},
  draft: { counts: {}, eventId: '', date: isoDate() },
  ui: {
    page: 'home',
    category: 'All',
    search: '',
    lowOnly: false,
    countCategory: 'All',
    countSearch: '',
    prefill: false,
    dniCategory: 'All',
    dniSearch: '',
    range: 7,
    customStart: shiftDays(-7),
    customEnd: isoDate(),
    activityFilter: 'all',
    expanded: new Set(),
  },
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

const save = () => repo.save({
  items: state.items,
  events: state.events,
  history: state.history,
  settings: state.settings,
  draft: state.draft,
});

async function boot() {
  const stored = await repo.load();
  if (stored && Array.isArray(stored.items) && stored.items.length) {
    state.items = stored.items;
    state.events = stored.events || [];
    state.history = stored.history || [];
    state.settings = stored.settings || {};
    state.draft = { counts: {}, eventId: '', date: isoDate(), ...(stored.draft || {}) };
  } else {
    const seed = buildSeedData();
    state.items = seed.items;
    state.events = seed.events;
    state.history = seed.history;
    state.settings = seed.settings;
    await save();
  }
  if (!state.draft.date) state.draft.date = isoDate();

  $('#count-date').value = state.draft.date;
  $('#report-start').value = state.ui.customStart;
  $('#report-end').value = state.ui.customEnd;
  $('#storage-note').textContent = repo.name === 'memory'
    ? 'Heads up: this browser blocked local storage (private mode?), so data will clear when you close the tab. Export a backup before you finish.'
    : 'Storage in use: browser localStorage on this device.';

  renderAll();
  goToHash();
  registerServiceWorker();
}

const KNOWN_PAGES = ['home', 'inventory', 'count', 'reports', 'dni', 'activity', 'settings'];

/** Lets PWA shortcuts and manual #hash links (e.g. manifest.webmanifest) deep-link a tab. */
function goToHash() {
  const requested = location.hash.slice(1);
  if (KNOWN_PAGES.includes(requested)) go(requested);
}

window.addEventListener('hashchange', goToHash);

/* ------------------------------------------------------------------ *
 * Activity log
 * ------------------------------------------------------------------ */

function logEntry(entry) {
  state.history.unshift({ id: newId('act'), date: new Date().toISOString(), lines: [], totals: {}, ...entry });
  state.history.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const ENTRY_ICON = {
  count: '✓', restock: '↓', adjustment: '↕', event: '✦', item: '＊',
  writeoff: '⊘', dniuse: '↥',
};

/* ------------------------------------------------------------------ *
 * Navigation, toast, modal plumbing
 * ------------------------------------------------------------------ */

function go(page) {
  state.ui.page = page;
  $$('.page').forEach(section => section.classList.toggle('active', section.id === page));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  window.scrollTo({ top: 0, behavior: 'auto' });
  renderPage(page);
  if (location.hash.slice(1) !== page) history.replaceState(null, '', `#${page}`);
}

let toastTimer;
function toast(message, kind = '') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

const modal = $('#modal');
let modalContext = { type: null };

function openModal(type, context = {}) {
  modalContext = { type, ...context };
  const chrome = MODALS[type];
  $('#modal-kicker').textContent = chrome.kicker;
  $('#modal-title').textContent = typeof chrome.title === 'function' ? chrome.title(context) : chrome.title;
  $('#modal-fields').innerHTML = chrome.fields(context);
  $('#modal-actions').innerHTML = chrome.actions
    ? chrome.actions(context)
    : `<button class="button outline" type="button" data-action="close-modal">Cancel</button>
       <button class="button primary" type="submit">${esc(chrome.submit || 'Save')}</button>`;
  clearFormError();
  if (!modal.open) modal.showModal();
  const first = $('#modal-fields input:not([type=hidden]), #modal-fields select');
  if (first && chrome.focus !== false) setTimeout(() => first.focus(), 60);
}

function closeModal() {
  if (modal.open) modal.close();
  modalContext = { type: null };
}

function clearFormError() {
  const error = $('#form-error');
  error.textContent = '';
  error.classList.remove('show');
  $$('#modal-fields .invalid').forEach(field => field.classList.remove('invalid'));
}

function showFormError(error) {
  const element = $('#form-error');
  element.textContent = error.message || String(error);
  element.classList.add('show');
  if (error.field) {
    const field = $(`#modal-fields [name="${CSS.escape(error.field)}"]`);
    if (field) { field.classList.add('invalid'); field.focus(); }
  }
}

/* ------------------------------------------------------------------ *
 * Shared fragments
 * ------------------------------------------------------------------ */

function itemOptions(selectedId) {
  const groups = CATEGORIES.map(category => {
    const rows = state.items.filter(item => item.category === category.name);
    if (!rows.length) return '';
    const options = rows.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selectedId) ? ' selected' : ''}>${esc(item.name)} · ${fmt(item.onHand)} ${unitLabel(item.unit, item.onHand)}</option>`).join('');
    return `<optgroup label="${esc(category.name)}">${options}</optgroup>`;
  }).join('');
  const extras = state.items.filter(item => !CATEGORY_NAMES.includes(item.category));
  const extraOptions = extras.length
    ? `<optgroup label="Other">${extras.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selectedId) ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>`
    : '';
  return groups + extraOptions;
}

function eventOptions(selectedId) {
  return state.events
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(event => `<option value="${esc(event.id)}"${String(event.id) === String(selectedId) ? ' selected' : ''}>${esc(event.name)} · ${esc(dateLabel(event.date))}</option>`)
    .join('');
}

/** Only products holding a banked balance can be drawn down from the DNI bank. */
function dniItemOptions(selectedId) {
  const rows = dniItems(state.items);
  if (!rows.length) return '<option value="" disabled selected>Nothing banked yet</option>';
  return rows
    .map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selectedId) ? ' selected' : ''}>${esc(item.name)} · ${fmt(item.dni)} ${esc(unitLabel(item.unit, item.dni))} banked</option>`)
    .join('');
}

function stockState(item) {
  if (isOutOfStock(item)) return 'out';
  if (isLowStock(item)) return 'low';
  return 'ok';
}

function emptyBlock(title, body) {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(body)}</div>`;
}

/* ------------------------------------------------------------------ *
 * Home
 * ------------------------------------------------------------------ */

function renderHome() {
  $('#welcome-date').textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date()).toUpperCase();

  const onHand = totalsByUnit(state.items);
  const low = lowStockItems(state.items);

  $('#home-stats').innerHTML = [
    { label: 'Inventory value', value: moneyShort(inventoryValue(state.items)), note: `${state.items.length} products at cost` },
    { label: 'Liquor on hand', value: `${fmt(onHand[OZ], 0)}`, note: 'liquid ounces poured stock' },
    { label: 'Bottles on hand', value: `${fmt(onHand[BOTTLE], 0)}`, note: 'wine, beer & mixers' },
    { label: 'Low stock', value: String(low.length), note: low.length ? 'at or below par' : 'everything above par', alert: low.length > 0 },
  ].map(stat => `
    <article class="stat${stat.alert ? ' alert' : ''}">
      <p class="eyebrow">${esc(stat.label)}</p>
      <div><strong>${esc(stat.value)}</strong><small>${esc(stat.note)}</small></div>
    </article>`).join('');

  const attention = $('#attention-slot');
  if (low.length) {
    attention.innerHTML = `
      <section class="attention-card">
        <div class="attention-head">
          <span class="attention-badge" aria-hidden="true">!</span>
          <div><p class="eyebrow">Needs ordering</p><h2>${low.length} line${low.length === 1 ? '' : 's'} below par</h2></div>
        </div>
        <div class="attention-list">
          ${low.slice(0, 4).map(item => `
            <button class="attention-row" data-restock-item="${esc(item.id)}">
              <span class="grow">
                <strong>${esc(item.name)}</strong>
                <small>${esc(item.category)} · order ${fmt(reorderQuantity(item))} ${esc(unitLabel(item.unit, reorderQuantity(item)))} to reach par</small>
              </span>
              <span class="pill ${stockState(item)}">${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))}</span>
            </button>`).join('')}
        </div>
        ${low.length > 4 ? `<button class="text-button" data-action="view-low" style="margin-top:8px">See all ${low.length} <span aria-hidden="true">→</span></button>` : ''}
      </section>`;
  } else {
    attention.innerHTML = `
      <section class="attention-card">
        <div class="attention-head">
          <span class="attention-badge" style="background:var(--ok-tint);color:var(--ok);border-color:#cfe3d4" aria-hidden="true">✓</span>
          <div><p class="eyebrow">Reorder watch</p><h2>Every line is above par</h2></div>
        </div>
        <p class="muted">Nothing to order right now. Par levels are checked after every count and delivery.</p>
      </section>`;
  }

  const recent = state.history.slice(0, 4);
  $('#recent-activity').innerHTML = recent.length
    ? recent.map(entryHtml).join('')
    : emptyBlock('No activity yet', 'Save your first count to start the audit trail.');
}

function entryHtml(entry) {
  const expanded = state.ui.expanded.has(entry.id);
  const lines = entry.lines || [];
  let amount = '';
  let sub = '';

  if (entry.type === 'count') {
    const oz = entry.totals?.usage?.[OZ] || 0;
    const bottles = entry.totals?.usage?.[BOTTLE] || 0;
    amount = [oz > 0 ? `${fmt(oz)} oz` : '', bottles > 0 ? `${fmt(bottles)} btl` : ''].filter(Boolean).join(' · ') || '0';
    sub = money(entry.totals?.revenue || 0, 0);
  } else if (entry.type === 'restock') {
    amount = `+${lines.length} line${lines.length === 1 ? '' : 's'}`;
    sub = money(entry.totals?.cost || 0, 0);
  } else if (entry.type === 'adjustment') {
    const line = lines[0];
    amount = line ? `${line.delta > 0 ? '+' : ''}${fmt(line.delta)} ${unitLabel(line.unit, line.delta)}` : '—';
  } else if (entry.type === 'writeoff') {
    const line = lines[0];
    amount = line ? `−${fmt(line.quantity)} ${unitLabel(line.unit, line.quantity)}` : '—';
    sub = 'banked';
  } else if (entry.type === 'dniuse') {
    const line = lines[0];
    amount = line ? `${fmt(line.quantity)} ${unitLabel(line.unit, line.quantity)}` : '—';
    sub = 'used';
  } else if (entry.type === 'item') {
    amount = lines[0] ? esc(lines[0].name) : '';
  }

  const detail = [entry.eventName, entry.note].filter(Boolean).join(' · ');

  return `
    <article class="entry" data-entry="${esc(entry.id)}" role="button" tabindex="0">
      <span class="entry-icon ${esc(entry.type)}" aria-hidden="true">${ENTRY_ICON[entry.type] || '•'}</span>
      <span class="entry-body">
        <strong>${esc(entry.title || entry.type)}</strong>
        <small>${esc(relativeLabel(entry.date))}${detail ? ` · ${esc(detail)}` : ''}</small>
        ${expanded && lines.length ? `<span class="entry-lines">${lines.slice(0, 40).map(entryLineHtml).join('')}${lines.length > 40 ? `<span class="entry-line"><b>+${lines.length - 40} more</b></span>` : ''}</span>` : ''}
      </span>
      <span class="entry-amount">${esc(amount)}${sub ? `<span>${esc(sub)}</span>` : ''}</span>
    </article>`;
}

function entryLineHtml(line) {
  let right = '';
  if (line.usage !== undefined) {
    right = line.usage > 0
      ? `−${fmt(line.usage)} ${unitLabel(line.unit, line.usage)}`
      : `+${fmt(line.adjustment)} ${unitLabel(line.unit, line.adjustment)}`;
  } else if (line.received !== undefined) {
    right = `+${fmt(line.received)} ${unitLabel(line.unit, line.received)}`;
  } else if (line.delta !== undefined) {
    right = `${line.delta > 0 ? '+' : ''}${fmt(line.delta)} ${unitLabel(line.unit, line.delta)}`;
  } else if (line.quantity !== undefined && line.dni !== undefined) {
    right = `${line.reason !== undefined ? '−' : ''}${fmt(line.quantity)} ${unitLabel(line.unit, line.quantity)}`;
  }
  return `<span class="entry-line"><span>${esc(line.name)}</span><b>${esc(right)}</b></span>`;
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

function renderInventory() {
  const { category, search, lowOnly } = state.ui;
  const query = search.trim().toLowerCase();
  const filtered = state.items.filter(item => {
    if (category !== 'All' && item.category !== category) return false;
    if (lowOnly && !isLowStock(item)) return false;
    if (query && !`${item.name} ${item.category}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const value = inventoryValue(state.items);
  $('#inventory-subtitle').textContent =
    `${state.items.length} products · ${money(value, 0)} on hand · ${lowStockItems(state.items).length} below par`;

  const chips = ['All', ...CATEGORY_NAMES.filter(name => state.items.some(item => item.category === name))];
  $('#category-chips').innerHTML = chips
    .map(name => `<button class="chip${name === category ? ' active' : ''}" data-category="${esc(name)}">${esc(name)}</button>`)
    .join('');
  $('#low-stock-toggle').setAttribute('aria-pressed', String(lowOnly));

  if (!filtered.length) {
    $('#inventory-list').innerHTML = emptyBlock('Nothing matches', 'Try another category, clear the low-stock filter, or add a product.');
    return;
  }

  const order = [...CATEGORY_NAMES, ...new Set(filtered.map(item => item.category))];
  const groups = [...new Set(order)].filter(name => filtered.some(item => item.category === name));

  $('#inventory-list').innerHTML = groups.map(name => {
    const rows = filtered.filter(item => item.category === name);
    const meta = categoryMeta(name);
    const groupValue = inventoryValue(rows);
    return `
      <section class="inventory-group">
        <div class="group-head">
          <h3><i class="group-dot" style="--accent:${meta.accent}"></i>${esc(name)}</h3>
          <small>${rows.length} · ${money(groupValue, 0)}</small>
        </div>
        <div class="inventory-list">${rows.map(item => itemCardHtml(item, meta)).join('')}</div>
      </section>`;
  }).join('');
}

function itemCardHtml(item, meta = categoryMeta(item.category)) {
  const status = stockState(item);
  const ratio = Math.max(0, Math.min(1.2, stockRatio(item)));
  const unit = unitLabel(item.unit, item.onHand);
  return `
    <button class="item-card" data-item="${esc(item.id)}" style="--accent:${meta.accent}">
      <span>
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-meta">${money(item.cost)}/${esc(item.unit === OZ ? 'oz' : 'bottle')} · ${money(itemValue(item), 0)} on hand${item.par > 0 ? ` · par ${fmt(item.par)}` : ''}</span>
      </span>
      <span class="item-stock">
        <strong class="${status === 'ok' ? '' : status}">${fmt(item.onHand)}</strong>
        <small>${esc(unit)}</small>
      </span>
      <span class="meter"><i class="${status === 'ok' ? '' : status}" style="width:${(ratio / 1.2) * 100}%;background:${status === 'ok' ? meta.accent : ''}"></i></span>
    </button>`;
}

/* ------------------------------------------------------------------ *
 * DNI — banked write-offs
 * ------------------------------------------------------------------ */

function renderDni() {
  const banked = dniItems(state.items);
  const bankedBalance = totalsByUnit(state.items, 'dni');

  $('#dni-stats').innerHTML = [
    { label: 'Banked value', value: moneyShort(dniValue(state.items)), note: 'at cost, not counted as on-hand' },
    { label: 'Liquor banked', value: fmt(bankedBalance[OZ], 0), note: 'ounces set aside' },
    { label: 'Bottles banked', value: fmt(bankedBalance[BOTTLE], 0), note: 'wine & beer set aside' },
    { label: 'Products banked', value: String(banked.length), note: banked.length ? 'have a balance' : 'nothing written off yet' },
  ].map(stat => `
    <article class="stat">
      <p class="eyebrow">${esc(stat.label)}</p>
      <div><strong>${esc(stat.value)}</strong><small>${esc(stat.note)}</small></div>
    </article>`).join('');

  const query = state.ui.dniSearch.trim().toLowerCase();
  const chips = ['All', ...CATEGORY_NAMES.filter(name => state.items.some(item => item.category === name))];
  $('#dni-chips').innerHTML = chips
    .map(name => `<button class="chip${name === state.ui.dniCategory ? ' active' : ''}" data-dni-category="${esc(name)}">${esc(name)}</button>`)
    .join('');

  const visible = state.items.filter(item => {
    if (state.ui.dniCategory !== 'All' && item.category !== state.ui.dniCategory) return false;
    if (query && !item.name.toLowerCase().includes(query)) return false;
    return true;
  });

  const sorted = [...visible].sort((a, b) => (Number(b.dni) || 0) * b.cost - (Number(a.dni) || 0) * a.cost);

  $('#dni-list').innerHTML = sorted.length
    ? sorted.map(dniCardHtml).join('')
    : emptyBlock('Nothing matches', 'Try another category or clear the search.');
}

function dniCardHtml(item) {
  const meta = categoryMeta(item.category);
  const balance = Number(item.dni) || 0;
  const value = balance * (Number(item.cost) || 0);
  return `
    <button class="item-card" data-dni-item="${esc(item.id)}" style="--accent:${meta.accent}">
      <span>
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-meta">${esc(item.category)} · ${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))} on hand</span>
      </span>
      <span class="item-stock">
        <strong class="${balance > 0 ? '' : ''}">${fmt(balance)}</strong>
        <small>${esc(unitLabel(item.unit, balance))} banked</small>
      </span>
      ${balance > 0 ? `<span class="meter"><i style="width:100%;background:var(--brass)"></i></span>` : ''}
      ${balance > 0 ? `<span class="item-meta" style="grid-column:1/-1">${money(value, 0)} at cost</span>` : ''}
    </button>`;
}

/* ------------------------------------------------------------------ *
 * Daily count
 * ------------------------------------------------------------------ */

function renderCount() {
  const select = $('#count-event');
  select.innerHTML = `<option value="">General daily count</option>${eventOptions(state.draft.eventId)}`;
  select.value = state.draft.eventId || '';
  $('#count-date').value = state.draft.date || isoDate();
  $('#count-prefill').setAttribute('aria-pressed', String(state.ui.prefill));

  const chips = ['All', ...CATEGORY_NAMES.filter(name => state.items.some(item => item.category === name))];
  $('#count-chips').innerHTML = chips
    .map(name => `<button class="chip${name === state.ui.countCategory ? ' active' : ''}" data-count-category="${esc(name)}">${esc(name)}</button>`)
    .join('');

  const query = state.ui.countSearch.trim().toLowerCase();
  const visible = state.items.filter(item => {
    if (state.ui.countCategory !== 'All' && item.category !== state.ui.countCategory) return false;
    if (query && !item.name.toLowerCase().includes(query)) return false;
    return true;
  });

  $('#count-list').innerHTML = visible.length
    ? visible.map(countCardHtml).join('')
    : emptyBlock('No products here', 'Change the category filter or clear the search.');

  updateCountProgress();
}

function countCardHtml(item) {
  const raw = state.draft.counts[item.id];
  const value = raw === undefined ? (state.ui.prefill ? item.onHand : '') : raw;
  const parsed = value === '' ? null : Number(value);
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= 0;
  const delta = valid ? parsed - Number(item.onHand) : 0;

  let deltaHtml = '';
  if (valid && delta < 0) deltaHtml = `<span class="delta use">Usage ${fmt(-delta)} ${esc(unitLabel(item.unit, -delta))} · ${money(revenueFrom(-delta, item), 0)}</span>`;
  else if (valid && delta > 0) deltaHtml = `<span class="delta add">Adjustment +${fmt(delta)} ${esc(unitLabel(item.unit, delta))}</span>`;
  else if (valid) deltaHtml = '<span class="delta">No change</span>';

  return `
    <article class="count-card${value !== '' ? ' touched' : ''}" data-count-card="${esc(item.id)}">
      <div>
        <strong>${esc(item.name)}</strong>
        <div class="book">Book ${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))} · ${esc(item.category)}</div>
        ${deltaHtml}
      </div>
      <div class="count-field">
        <label for="count-input-${esc(item.id)}">On hand · ${esc(item.unit === OZ ? 'oz' : 'btl')}</label>
        <input id="count-input-${esc(item.id)}" data-count-input="${esc(item.id)}" type="number" inputmode="decimal"
               min="0" step="0.1" placeholder="—" value="${value === '' ? '' : esc(value)}"
               class="${parsed !== null && (!Number.isFinite(parsed) || parsed < 0) ? 'invalid' : ''}" />
      </div>
    </article>`;
}

function updateCountProgress() {
  const entries = Object.entries(state.draft.counts).filter(([, value]) => value !== '' && value !== undefined);
  const total = state.items.length;
  let usageOz = 0;
  let usageBottles = 0;
  let revenue = 0;

  for (const [id, value] of entries) {
    const item = state.items.find(row => String(row.id) === String(id));
    if (!item) continue;
    const counted = Number(value);
    if (!Number.isFinite(counted) || counted < 0) continue;
    const used = Math.max(0, Number(item.onHand) - counted);
    if (item.unit === OZ) usageOz += used; else usageBottles += used;
    revenue += revenueFrom(used, item);
  }

  $('#count-progress-label').textContent = `${entries.length} of ${total} counted`;
  $('#count-progress-bar').style.width = `${total ? (entries.length / total) * 100 : 0}%`;
  const parts = [];
  if (usageOz > 0) parts.push(`${fmt(usageOz)} oz`);
  if (usageBottles > 0) parts.push(`${fmt(usageBottles)} btl`);
  $('#count-progress-usage').textContent = parts.length ? `${parts.join(' · ')} · ${money(revenue, 0)}` : '—';
}

function saveCount() {
  const counts = {};
  for (const [id, value] of Object.entries(state.draft.counts)) {
    if (value === '' || value === undefined || value === null) continue;
    counts[String(id)] = value;
  }
  if (!Object.keys(counts).length) {
    toast('Enter at least one count before saving', 'error');
    return;
  }

  try {
    const result = applyCount(state.items, counts);
    const event = state.events.find(row => String(row.id) === String(state.draft.eventId));
    const date = state.draft.date || isoDate();
    const at = date === isoDate() ? new Date().toISOString() : `${date}T20:00:00.000Z`;

    state.items = result.items;
    logEntry({
      type: 'count',
      date: at,
      title: event ? `${event.name} — event count` : 'Daily count',
      note: `${result.totals.counted} product${result.totals.counted === 1 ? '' : 's'} counted`,
      eventId: event?.id || null,
      eventName: event?.name || null,
      lines: result.lines.filter(line => line.usage > 0 || line.adjustment > 0),
      totals: result.totals,
    });

    state.draft = { counts: {}, eventId: '', date: isoDate() };
    save();
    renderAll();
    go('home');

    const oz = result.totals.usage[OZ];
    const bottles = result.totals.usage[BOTTLE];
    const summary = [oz > 0 ? `${fmt(oz)} oz` : '', bottles > 0 ? `${fmt(bottles)} bottles` : '']
      .filter(Boolean).join(' and ') || 'no usage';
    toast(`Count saved — ${summary} consumed`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

function reportRange() {
  if (state.ui.range === 'custom') {
    const start = state.ui.customStart || shiftDays(-30);
    const end = state.ui.customEnd || isoDate();
    return start <= end ? { start, end } : { start: end, end: start };
  }
  return { start: shiftDays(-(state.ui.range - 1)), end: isoDate() };
}

function renderReports() {
  $$('#range-buttons button').forEach(button => {
    const value = button.dataset.range === 'custom' ? 'custom' : Number(button.dataset.range);
    button.classList.toggle('selected', value === state.ui.range);
  });
  $('#custom-range').classList.toggle('show', state.ui.range === 'custom');

  const { start, end } = reportRange();
  const report = buildReport({ items: state.items, history: state.history, events: state.events, start, end });

  $('#report-overview').innerHTML = [
    { label: 'Servings poured', value: fmt(report.servings, 0), note: `${report.counts} count${report.counts === 1 ? '' : 's'} in range` },
    { label: 'Expected revenue', value: moneyShort(report.revenue), note: 'at menu price' },
    { label: 'Product cost used', value: moneyShort(report.consumedCost), note: `${moneyShort(report.receivedCost)} received` },
    { label: 'Inventory value', value: moneyShort(report.inventoryValue), note: 'on hand right now' },
  ].map(stat => `
    <article class="stat">
      <p class="eyebrow">${esc(stat.label)}</p>
      <div><strong>${esc(stat.value)}</strong><small>${esc(stat.note)}</small></div>
    </article>`).join('');

  $('#trend-window').textContent = `${dateLabel(start)} – ${dateLabel(end)}`;
  renderTrend(report.trend);

  $('#top-products').innerHTML = report.top.length
    ? report.top.map((row, index) => `
      <div class="rank">
        <span class="rank-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="rank-body">
          <strong>${esc(row.name)}</strong>
          <small>${esc(row.category)} · ${fmt(row.servings, 0)} servings</small>
        </span>
        <span class="rank-value">${fmt(row.usage)} ${esc(unitLabel(row.unit, row.usage))}<span>${money(row.revenue, 0)}</span></span>
      </div>`).join('')
    : emptyBlock('Nothing consumed yet', 'Save a count inside this date range to populate the report.');

  const low = report.lowStock;
  $('#report-low-list').innerHTML = low.length
    ? low.slice(0, 8).map(item => `
      <div class="rank">
        <span class="rank-number" style="background:${isOutOfStock(item) ? 'var(--danger-tint)' : 'var(--warn-tint)'};color:${isOutOfStock(item) ? 'var(--danger)' : 'var(--warn)'}">${isOutOfStock(item) ? '!' : '↓'}</span>
        <span class="rank-body"><strong>${esc(item.name)}</strong><small>${esc(item.category)} · par ${fmt(item.par)}</small></span>
        <span class="rank-value">${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))}<span>order ${fmt(reorderQuantity(item))}</span></span>
      </div>`).join('')
    : emptyBlock('All above par', 'Nothing needs ordering today.');

  const maxCategory = Math.max(1, ...report.byCategory.map(row => row.revenue));
  $('#category-report').innerHTML = report.byCategory.length
    ? report.byCategory.map(row => `
      <div class="bar-row">
        <span class="bar-label"><b>${esc(row.category)}</b><span>${fmt(row.usage)} ${esc(unitLabel(row.unit, row.usage))} · ${money(row.revenue, 0)}</span></span>
        <span class="bar-track"><i style="width:${(row.revenue / maxCategory) * 100}%;background:${categoryMeta(row.category).accent}"></i></span>
      </div>`).join('')
    : emptyBlock('No mix to show', 'Consumption by category appears after your first count in range.');

  $('#event-report-list').innerHTML = report.byEvent.length
    ? report.byEvent.map(row => `
      <div class="rank" role="button" tabindex="0" data-event-report="${esc(row.eventId)}">
        <span class="rank-number" style="background:#e6eef4;color:#3d647d">✦</span>
        <span class="rank-body">
          <strong>${esc(row.name)}</strong>
          <small>${esc(dateLabel(row.date))} · ${row.counts ? `${fmt(row.servings, 0)} servings` : 'no count recorded yet'}</small>
        </span>
        <span class="rank-value">${money(row.revenue, 0)}<span>${fmt(row.usage[OZ])} oz · ${fmt(row.usage[BOTTLE])} btl</span></span>
      </div>`).join('')
    : emptyBlock('No events in range', 'Create an event, then pick it as the context on your next count.');
}

function renderTrend(trend) {
  const chart = $('#trend-chart');
  const width = 300;
  const height = 132;
  const pad = 6;

  if (!trend.length) {
    chart.innerHTML = '';
    $('#chart-legend').innerHTML = '';
    return;
  }

  const max = Math.max(1, ...trend.map(day => day.servings));
  const slot = (width - pad * 2) / trend.length;
  const barWidth = Math.max(1.5, Math.min(slot * 0.62, 18));

  const bars = trend.map((day, index) => {
    const drawn = day.servings > 0
      ? Math.max(2, (day.servings / max) * (height - 26))
      : 2;
    const x = pad + index * slot + (slot - barWidth) / 2;
    const colour = day.servings > 0 ? '#2c584a' : '#e3ded2';
    return `<rect x="${x.toFixed(2)}" y="${(height - 14 - drawn).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${drawn.toFixed(2)}" fill="${colour}" />`;
  }).join('');

  const points = trend.map((day, index) => {
    const x = pad + index * slot + slot / 2;
    const y = height - 14 - (day.servings / max) * (height - 26);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chart.setAttribute('preserveAspectRatio', 'none');
  chart.innerHTML = `
    <line x1="0" y1="${height - 13}" x2="${width}" y2="${height - 13}" stroke="#e3ded2" stroke-width="1" vector-effect="non-scaling-stroke" />
    ${bars}
    ${trend.length > 2 ? `<polyline points="${points}" fill="none" stroke="#b0842f" stroke-width="1.5" stroke-linejoin="round" opacity="0.75" vector-effect="non-scaling-stroke" />` : ''}`;

  const peak = trend.reduce((best, day) => (day.servings > best.servings ? day : best), trend[0]);
  $('#chart-legend').innerHTML = `
    <span>${esc(dateLabel(trend[0].date))}</span>
    <span>${peak.servings > 0 ? `peak ${fmt(peak.servings, 0)} servings · ${esc(dateLabel(peak.date))}` : 'no usage recorded'}</span>
    <span>${esc(dateLabel(trend[trend.length - 1].date))}</span>`;
}

function toCsv(rows) {
  return rows.map(row => row.map(cell => {
    const text = String(cell ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}

function exportReportCsv() {
  const { start, end } = reportRange();
  const report = buildReport({ items: state.items, history: state.history, events: state.events, start, end });

  const rows = [
    ['The Barn — consumption report'],
    ['Range', start, end],
    ['Generated', new Date().toLocaleString()],
    [],
    ['CONSUMPTION BY PRODUCT'],
    ['Product', 'Category', 'Unit', 'Usage', 'Servings', 'Expected revenue', 'Product cost'],
  ];
  for (const row of consumptionRowsInRange(report)) {
    rows.push([row.name, row.category, row.unit, fmt(row.usage), fmt(row.servings, 0), row.revenue.toFixed(2), row.cost.toFixed(2)]);
  }

  rows.push([], ['CONSUMPTION BY EVENT'], ['Event', 'Date', 'Servings', 'Ounces', 'Bottles', 'Expected revenue']);
  for (const row of report.byEvent) {
    rows.push([row.name, row.date, fmt(row.servings, 0), fmt(row.usage[OZ]), fmt(row.usage[BOTTLE]), row.revenue.toFixed(2)]);
  }

  rows.push([], ['CURRENT INVENTORY'], ['Product', 'Category', 'Unit', 'Beginning', 'On hand', 'Par', 'Cost per unit', 'Total value']);
  for (const item of state.items) {
    rows.push([item.name, item.category, item.unit, fmt(item.beginning), fmt(item.onHand), fmt(item.par), item.cost.toFixed(2), itemValue(item).toFixed(2)]);
  }

  downloadFile(`barn-report-${start}_to_${end}.csv`, toCsv(rows), 'text/csv');
  toast('Report exported as CSV', 'success');
}

function consumptionRowsInRange(report) {
  const map = new Map();
  for (const entry of report.entries) {
    if (entry.type !== 'count') continue;
    for (const line of entry.lines || []) {
      const key = String(line.itemId);
      const row = map.get(key) || { name: line.name, category: line.category, unit: line.unit, usage: 0, servings: 0, revenue: 0, cost: 0 };
      row.usage += Number(line.usage) || 0;
      row.servings += Number(line.servings) || 0;
      row.revenue += Number(line.revenue) || 0;
      row.cost += Number(line.cost) || 0;
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

function renderActivity() {
  const filter = state.ui.activityFilter;
  $$('#activity-filters .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.activityFilter === filter));
  const rows = state.history.filter(entry => {
    if (filter === 'all') return true;
    if (filter === 'dni') return entry.type === 'writeoff' || entry.type === 'dniuse';
    return entry.type === filter;
  });
  $('#activity-list').innerHTML = rows.length
    ? rows.slice(0, 300).map(entryHtml).join('')
    : emptyBlock('Nothing logged yet', 'Counts, deliveries, and adjustments will appear here.');
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function renderSettings() {
  const counts = state.history.filter(entry => entry.type === 'count').length;
  const restocks = state.history.filter(entry => entry.type === 'restock').length;
  $('#settings-stats').innerHTML = [
    { label: 'Products', value: String(state.items.length) },
    { label: 'Events', value: String(state.events.length) },
    { label: 'Counts logged', value: String(counts) },
    { label: 'Deliveries', value: String(restocks) },
  ].map(stat => `<article class="stat"><p class="eyebrow">${esc(stat.label)}</p><div><strong>${esc(stat.value)}</strong></div></article>`).join('');
}

/* ------------------------------------------------------------------ *
 * Modals
 * ------------------------------------------------------------------ */

const MODALS = {
  item: {
    kicker: 'Inventory',
    title: context => (context.item ? 'Edit product' : 'Add product'),
    submit: 'Save product',
    fields: ({ item = {} }) => `
      <div class="form-grid">
        <div class="field">
          <label for="f-name">Product name</label>
          <input id="f-name" name="name" value="${esc(item.name || '')}" placeholder="e.g. Woodford Reserve" required />
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-category">Category</label>
            <select id="f-category" name="category">
              ${CATEGORY_NAMES.map(name => `<option value="${esc(name)}"${item.category === name ? ' selected' : ''}>${esc(name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-unit">Measured in</label>
            <select id="f-unit" name="unit">
              <option value="${OZ}"${item.unit === OZ ? ' selected' : ''}>Liquid ounces</option>
              <option value="${BOTTLE}"${item.unit === BOTTLE ? ' selected' : ''}>Bottles</option>
            </select>
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-beginning">Beginning inventory</label>
            <input id="f-beginning" name="beginning" type="number" inputmode="decimal" min="0" step="0.1" value="${item.beginning ?? ''}" placeholder="0" />
          </div>
          <div class="field">
            <label for="f-onhand">On hand now</label>
            <input id="f-onhand" name="onHand" type="number" inputmode="decimal" min="0" step="0.1" value="${item.onHand ?? ''}" placeholder="0" required />
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-par">Par level</label>
            <input id="f-par" name="par" type="number" inputmode="decimal" min="0" step="0.1" value="${item.par ?? ''}" placeholder="0" required />
            <span class="hint">0 = not tracked for reorder</span>
          </div>
          <div class="field">
            <label for="f-cost">Cost per unit</label>
            <input id="f-cost" name="cost" type="number" inputmode="decimal" min="0" step="0.01" value="${item.cost ?? ''}" placeholder="0.00" required />
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-pour">Serving size</label>
            <input id="f-pour" name="pourSize" type="number" inputmode="decimal" min="0.1" step="0.1" value="${item.pourSize ?? ''}" placeholder="1.5" />
            <span class="hint" id="pour-hint">oz per pour, or servings per bottle</span>
          </div>
          <div class="field">
            <label for="f-price">Menu price</label>
            <input id="f-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${item.price ?? ''}" placeholder="0.00" />
            <span class="hint">per serving, for revenue</span>
          </div>
        </div>
      </div>`,
    actions: ({ item }) => `
      <button class="button outline" type="button" data-action="close-modal">Cancel</button>
      <button class="button primary" type="submit">Save product</button>
      ${item ? '<button class="button danger full" type="button" data-action="delete-item">Delete product</button>' : ''}`,
  },

  restock: {
    kicker: 'Delivery',
    title: 'Record a restock',
    submit: 'Add to inventory',
    fields: ({ itemId }) => `
      <div class="form-grid">
        <div class="field">
          <label for="f-item">Product</label>
          <select id="f-item" name="itemId">${itemOptions(itemId)}</select>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-qty">Quantity received</label>
            <input id="f-qty" name="quantity" type="number" inputmode="decimal" min="0.1" step="0.1" placeholder="0" required />
          </div>
          <div class="field">
            <label for="f-date">Delivery date</label>
            <input id="f-date" name="date" type="date" value="${isoDate()}" />
          </div>
        </div>
        <div class="field">
          <label for="f-note">Note <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
          <input id="f-note" name="note" placeholder="Invoice number, supplier…" />
        </div>
      </div>`,
  },

  adjust: {
    kicker: 'Correction',
    title: 'Adjust inventory',
    submit: 'Apply adjustment',
    fields: ({ itemId }) => `
      <div class="form-grid">
        <div class="field">
          <label for="f-item">Product</label>
          <select id="f-item" name="itemId">${itemOptions(itemId)}</select>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-delta">Amount</label>
            <input id="f-delta" name="delta" type="number" inputmode="decimal" step="0.1" placeholder="-1" required />
            <span class="hint">Negative removes stock</span>
          </div>
          <div class="field">
            <label for="f-reason">Reason</label>
            <select id="f-reason" name="reason">
              <option>Breakage</option>
              <option>Waste / spill</option>
              <option>Comped</option>
              <option>Transfer</option>
              <option>Count correction</option>
            </select>
          </div>
        </div>
      </div>`,
  },

  writeoff: {
    kicker: 'Write-off',
    title: 'Write off product',
    submit: 'Write off & bank',
    fields: ({ itemId }) => `
      <div class="form-grid">
        <div class="field">
          <label for="f-item">Product</label>
          <select id="f-item" name="itemId">${itemOptions(itemId)}</select>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label for="f-qty">Quantity to write off</label>
            <input id="f-qty" name="quantity" type="number" inputmode="decimal" min="0.1" step="0.1" placeholder="0" required />
          </div>
          <div class="field">
            <label for="f-reason">Reason</label>
            <select id="f-reason" name="reason">
              <option>Banked from a strong cost period</option>
              <option>Comp allowance</option>
              <option>Manager write-off</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <p class="hint">Removes this quantity from official on-hand and cost, and banks it on the DNI list to pour or comp later at no additional cost.</p>
      </div>`,
  },

  dniUse: {
    kicker: 'DNI bank',
    title: 'Use banked stock',
    submit: 'Draw from bank',
    fields: ({ itemId }) => `
      <div class="form-grid">
        <div class="field">
          <label for="f-item">Product</label>
          <select id="f-item" name="itemId">${dniItemOptions(itemId)}</select>
        </div>
        <div class="field">
          <label for="f-qty">Quantity to use</label>
          <input id="f-qty" name="quantity" type="number" inputmode="decimal" min="0.1" step="0.1" placeholder="0" required />
        </div>
        <div class="field">
          <label for="f-note">Note <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
          <input id="f-note" name="note" placeholder="Comped VIP table, staff drink…" />
        </div>
        <p class="hint">Draws down the banked balance only — on-hand and cost are not affected, since this stock was already written off.</p>
      </div>`,
  },

  dniActions: {
    kicker: 'DNI bank',
    title: context => context.item.name,
    focus: false,
    fields: ({ item }) => {
      const balance = Number(item.dni) || 0;
      const value = balance * (Number(item.cost) || 0);
      return `
        <div class="form-grid">
          <div class="setting-card" style="margin:0">
            <div class="setting-icon" aria-hidden="true">⊘</div>
            <div>
              <strong>${fmt(balance)} ${esc(unitLabel(item.unit, balance))} banked</strong>
              <p>${esc(item.category)} · ${money(value, 2)} at cost</p>
              <p>${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))} on hand officially</p>
            </div>
            <span class="pill ${balance > 0 ? 'bank' : 'ok'}">${balance > 0 ? 'Banked' : 'Empty'}</span>
          </div>
        </div>`;
    },
    actions: ({ item }) => `
      <button class="button primary full" type="button" data-action="writeoff-this">Write off more</button>
      ${(Number(item.dni) || 0) > 0 ? '<button class="button outline full" type="button" data-action="use-dni-this">Use banked stock</button>' : ''}
      <button class="button outline" type="button" data-action="close-modal">Close</button>`,
  },

  event: {
    kicker: 'Event',
    title: 'Create an event',
    submit: 'Create event',
    fields: () => `
      <div class="form-grid">
        <div class="field">
          <label for="f-event-name">Event name</label>
          <input id="f-event-name" name="name" placeholder="e.g. Delgado Wedding" required />
        </div>
        <div class="field">
          <label for="f-event-date">Event date</label>
          <input id="f-event-date" name="date" type="date" value="${isoDate()}" />
        </div>
        <div class="field">
          <label for="f-event-notes">Notes <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
          <textarea id="f-event-notes" name="notes" placeholder="Guest count, bar package…"></textarea>
        </div>
      </div>`,
  },

  itemActions: {
    kicker: 'Product',
    title: context => context.item.name,
    focus: false,
    fields: ({ item }) => {
      const status = stockState(item);
      const statusText = status === 'out' ? 'Out of stock' : status === 'low' ? 'At or below par' : 'Above par';
      return `
        <div class="form-grid">
          <div class="setting-card" style="margin:0">
            <div class="setting-icon" aria-hidden="true">${item.unit === OZ ? '◑' : '▯'}</div>
            <div>
              <strong>${fmt(item.onHand)} ${esc(unitLabel(item.unit, item.onHand))} on hand</strong>
              <p>${esc(item.category)} · par ${fmt(item.par)} · beginning ${fmt(item.beginning)}</p>
              <p>${money(item.cost)} per ${esc(item.unit === OZ ? 'oz' : 'bottle')} · ${money(itemValue(item), 2)} total value</p>
            </div>
            <span class="pill ${status}">${esc(statusText)}</span>
          </div>
        </div>`;
    },
    actions: () => `
      <button class="button primary full" type="button" data-action="restock-this">Record delivery</button>
      <button class="button outline" type="button" data-action="adjust-this">Adjust</button>
      <button class="button outline" type="button" data-action="edit-this">Edit details</button>`,
  },

  eventReport: {
    kicker: 'Event report',
    title: context => context.report.name,
    focus: false,
    fields: ({ report }) => {
      const lines = new Map();
      for (const line of report.lines) {
        const key = String(line.itemId);
        const row = lines.get(key) || { name: line.name, unit: line.unit, usage: 0, servings: 0, revenue: 0 };
        row.usage += Number(line.usage) || 0;
        row.servings += Number(line.servings) || 0;
        row.revenue += Number(line.revenue) || 0;
        lines.set(key, row);
      }
      const rows = [...lines.values()].filter(row => row.usage > 0).sort((a, b) => b.revenue - a.revenue);
      return `
        <div class="form-grid">
          <div class="report-overview" style="margin:0">
            <article class="stat"><p class="eyebrow">Servings</p><div><strong>${fmt(report.servings, 0)}</strong></div></article>
            <article class="stat"><p class="eyebrow">Revenue</p><div><strong>${esc(moneyShort(report.revenue))}</strong></div></article>
            <article class="stat"><p class="eyebrow">Liquor</p><div><strong>${fmt(report.usage[OZ], 0)}</strong><small>oz</small></div></article>
            <article class="stat"><p class="eyebrow">Bottles</p><div><strong>${fmt(report.usage[BOTTLE], 0)}</strong><small>wine & beer</small></div></article>
          </div>
          <div>
            ${rows.length
              ? rows.map(row => `<div class="rank"><span class="rank-body"><strong>${esc(row.name)}</strong><small>${fmt(row.servings, 0)} servings</small></span><span class="rank-value">${fmt(row.usage)} ${esc(unitLabel(row.unit, row.usage))}<span>${money(row.revenue, 0)}</span></span></div>`).join('')
              : emptyBlock('No consumption recorded', 'Run a count with this event selected as the context.')}
          </div>
        </div>`;
    },
    actions: () => `
      <button class="button outline" type="button" data-action="close-modal">Close</button>
      <button class="button primary" type="button" data-action="export-event">Export CSV</button>`,
  },
};

/* ------------------------------------------------------------------ *
 * Form submission
 * ------------------------------------------------------------------ */

$('#modal-form').addEventListener('submit', event => {
  event.preventDefault();
  clearFormError();
  const data = Object.fromEntries(new FormData(event.target).entries());

  try {
    if (modalContext.type === 'item') submitItem(data);
    else if (modalContext.type === 'restock') submitRestock(data);
    else if (modalContext.type === 'adjust') submitAdjustment(data);
    else if (modalContext.type === 'writeoff') submitWriteOff(data);
    else if (modalContext.type === 'dniUse') submitDniUse(data);
    else if (modalContext.type === 'event') submitEvent(data);
    else closeModal();
  } catch (error) {
    if (error instanceof ValidationError) showFormError(error);
    else showFormError(new ValidationError(error.message || 'Something went wrong'));
  }
});

function submitItem(data) {
  const existingId = modalContext.item?.id;
  const normalized = normalizeItem(data, { existing: state.items, id: existingId });

  if (existingId) {
    const before = state.items.find(item => item.id === existingId);
    state.items = state.items.map(item => (item.id === existingId ? normalized : item));
    logEntry({
      type: 'item',
      title: 'Product updated',
      note: normalized.name,
      lines: [{
        itemId: normalized.id,
        name: normalized.name,
        category: normalized.category,
        unit: normalized.unit,
        previous: before?.onHand ?? normalized.onHand,
        onHand: normalized.onHand,
      }],
    });
    toast(`${normalized.name} updated`, 'success');
  } else {
    state.items.push(normalized);
    logEntry({
      type: 'item',
      title: 'Product added',
      note: `${normalized.name} · ${normalized.category}`,
      lines: [{
        itemId: normalized.id,
        name: normalized.name,
        category: normalized.category,
        unit: normalized.unit,
        received: normalized.onHand,
      }],
      totals: { cost: normalized.onHand * normalized.cost },
    });
    toast(`${normalized.name} added to inventory`, 'success');
  }

  save();
  closeModal();
  renderAll();
}

function submitRestock(data) {
  const result = applyRestock(state.items, data.itemId, data.quantity);
  state.items = result.items;
  const date = data.date && data.date !== isoDate() ? `${data.date}T12:00:00.000Z` : new Date().toISOString();
  logEntry({
    type: 'restock',
    date,
    title: 'Delivery received',
    note: [result.line.name, data.note].filter(Boolean).join(' · '),
    lines: [result.line],
    totals: { cost: result.line.cost, received: 1 },
  });
  save();
  closeModal();
  renderAll();
  toast(`${result.line.name} restocked to ${quantityLabel(result.line.onHand, result.line.unit)}`, 'success');
}

function submitAdjustment(data) {
  const result = applyAdjustment(state.items, data.itemId, Number(data.delta), data.reason);
  state.items = result.items;
  logEntry({
    type: 'adjustment',
    title: 'Inventory adjustment',
    note: [result.line.name, result.line.reason].filter(Boolean).join(' · '),
    lines: [result.line],
    totals: { cost: Math.abs(result.line.delta) * (state.items.find(item => item.id === result.line.itemId)?.cost || 0) },
  });
  save();
  closeModal();
  renderAll();
  toast(`${result.line.name} adjusted to ${quantityLabel(result.line.onHand, result.line.unit)}`, 'success');
}

function submitWriteOff(data) {
  const result = applyWriteOff(state.items, data.itemId, data.quantity, data.reason);
  state.items = result.items;
  logEntry({
    type: 'writeoff',
    title: 'Product written off',
    note: [result.line.name, result.line.reason].filter(Boolean).join(' · '),
    lines: [result.line],
    totals: { cost: result.line.cost },
  });
  save();
  closeModal();
  renderAll();
  toast(`${quantityLabel(result.line.quantity, result.line.unit)} of ${result.line.name} banked to DNI`, 'success');
}

function submitDniUse(data) {
  const result = applyDniUse(state.items, data.itemId, data.quantity, data.note);
  state.items = result.items;
  logEntry({
    type: 'dniuse',
    title: 'Banked stock used',
    note: [result.line.name, result.line.note].filter(Boolean).join(' · '),
    lines: [result.line],
  });
  save();
  closeModal();
  renderAll();
  toast(`${quantityLabel(result.line.quantity, result.line.unit)} of ${result.line.name} drawn from the bank`, 'success');
}

function submitEvent(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Event name is required', 'name');
  if (state.events.some(event => event.name.toLowerCase() === name.toLowerCase() && event.date === data.date)) {
    throw new ValidationError('That event already exists on this date', 'name');
  }
  const event = { id: newId('evt'), name, date: data.date || isoDate(), notes: String(data.notes || '').trim() };
  state.events.push(event);
  state.draft.eventId = event.id;
  logEntry({ type: 'event', title: 'Event created', note: `${event.name} · ${dateLabel(event.date)}` });
  save();
  closeModal();
  renderAll();
  toast(`${event.name} created — select it on your next count`, 'success');
}

/* ------------------------------------------------------------------ *
 * Backup, restore, reset
 * ------------------------------------------------------------------ */

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportBackup() {
  const backup = buildBackup(state);
  downloadFile(`barn-inventory-backup-${isoDate()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  toast('Backup downloaded', 'success');
}

function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = parseBackup(String(reader.result));
      state.items = data.items;
      state.events = data.events;
      state.history = data.history;
      state.settings = data.settings;
      state.draft = { counts: {}, eventId: '', date: isoDate() };
      save();
      renderAll();
      go('home');
      toast(`Backup restored — ${data.items.length} products`, 'success');
    } catch (error) {
      toast(error.message || 'That file could not be restored', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = () => { toast('Could not read that file', 'error'); event.target.value = ''; };
  reader.readAsText(file);
}

async function resetToSample() {
  if (!window.confirm('Erase all local data and reload the sample inventory? Export a backup first if you need it.')) return;
  await repo.clear();
  const seed = buildSeedData();
  state.items = seed.items;
  state.events = seed.events;
  state.history = seed.history;
  state.settings = seed.settings;
  state.draft = { counts: {}, eventId: '', date: isoDate() };
  await save();
  renderAll();
  go('home');
  toast('Sample data restored', 'success');
}

function rebasePeriod() {
  if (!window.confirm('Set beginning inventory on every product to the current on-hand amount?')) return;
  state.items = rebaseBeginning(state.items);
  logEntry({ type: 'item', title: 'New period started', note: 'Beginning inventory rebased to current on-hand' });
  save();
  renderAll();
  toast('Beginning inventory updated', 'success');
}

/* ------------------------------------------------------------------ *
 * Install (PWA)
 * ------------------------------------------------------------------ */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('#install-guidance').textContent = 'Tap Install to add The Barn to your home screen for full-screen, offline access.';
});

async function install() {
  if (installPrompt) {
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    toast(choice.outcome === 'accepted' ? 'Installing The Barn…' : 'Install dismissed');
    return;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    toast('Safari: tap Share, then “Add to Home Screen”');
  } else if (/Android/i.test(ua)) {
    toast('Chrome: tap ⋮, then “Add to Home screen”');
  } else if (window.matchMedia('(display-mode: standalone)').matches) {
    toast('The Barn is already installed');
  } else {
    toast('Use your browser menu → Install app');
  }
}

function setInstallGuidance() {
  const ua = navigator.userAgent;
  const element = $('#install-guidance');
  if (window.matchMedia('(display-mode: standalone)').matches) {
    element.textContent = 'Installed. The Barn is running full-screen from your home screen.';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    element.textContent = 'iPhone: tap the Share button in Safari, then “Add to Home Screen”. Requires an https:// address.';
  } else if (/Android/i.test(ua)) {
    element.textContent = 'Android: tap the ⋮ menu in Chrome, then “Add to Home screen” or “Install app”.';
  } else {
    element.textContent = 'Desktop: use the install icon in your browser’s address bar for a windowed app.';
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // service workers need http(s)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ------------------------------------------------------------------ *
 * Rendering entry points
 * ------------------------------------------------------------------ */

function renderPage(page) {
  if (page === 'home') renderHome();
  else if (page === 'inventory') renderInventory();
  else if (page === 'count') renderCount();
  else if (page === 'reports') renderReports();
  else if (page === 'dni') renderDni();
  else if (page === 'activity') renderActivity();
  else if (page === 'settings') { renderSettings(); setInstallGuidance(); }
}

function renderAll() {
  renderHome();
  renderInventory();
  renderCount();
  renderReports();
  renderDni();
  renderActivity();
  renderSettings();
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

const ACTIONS = {
  'add-item': () => openModal('item', {}),
  restock: () => openModal('restock', {}),
  event: () => openModal('event', {}),
  'close-modal': () => closeModal(),
  'save-count': () => saveCount(),
  export: () => exportBackup(),
  'export-report': () => exportReportCsv(),
  'print-report': () => window.print(),
  rebase: () => rebasePeriod(),
  reset: () => resetToSample(),
  install: () => install(),
  'view-low': () => { state.ui.lowOnly = true; state.ui.category = 'All'; renderInventory(); go('inventory'); },
  'restock-this': () => openModal('restock', { itemId: modalContext.item.id }),
  'adjust-this': () => openModal('adjust', { itemId: modalContext.item.id }),
  'edit-this': () => openModal('item', { item: modalContext.item }),
  'delete-item': () => deleteItem(),
  'export-event': () => exportEventCsv(modalContext.report),
  'write-off': () => openModal('writeoff', {}),
  'use-dni': () => openModal('dniUse', {}),
  'writeoff-this': () => openModal('writeoff', { itemId: modalContext.item.id }),
  'use-dni-this': () => openModal('dniUse', { itemId: modalContext.item.id }),
};

function deleteItem() {
  const item = modalContext.item;
  if (!item) return;
  if (!window.confirm(`Delete ${item.name}? Its past activity stays in the log.`)) return;
  state.items = state.items.filter(row => row.id !== item.id);
  delete state.draft.counts[item.id];
  logEntry({ type: 'item', title: 'Product removed', note: item.name, lines: [{ itemId: item.id, name: item.name, unit: item.unit }] });
  save();
  closeModal();
  renderAll();
  toast(`${item.name} removed`, 'success');
}

function exportEventCsv(report) {
  if (!report) return;
  const rows = [
    ['The Barn — event consumption report'],
    ['Event', report.name],
    ['Date', report.date],
    [],
    ['Product', 'Unit', 'Usage', 'Servings', 'Expected revenue'],
  ];
  const map = new Map();
  for (const line of report.lines) {
    const key = String(line.itemId);
    const row = map.get(key) || { name: line.name, unit: line.unit, usage: 0, servings: 0, revenue: 0 };
    row.usage += Number(line.usage) || 0;
    row.servings += Number(line.servings) || 0;
    row.revenue += Number(line.revenue) || 0;
    map.set(key, row);
  }
  for (const row of [...map.values()].filter(row => row.usage > 0).sort((a, b) => b.revenue - a.revenue)) {
    rows.push([row.name, row.unit, fmt(row.usage), fmt(row.servings, 0), row.revenue.toFixed(2)]);
  }
  rows.push([], ['Totals', '', `${fmt(report.usage[OZ])} oz / ${fmt(report.usage[BOTTLE])} btl`, fmt(report.servings, 0), report.revenue.toFixed(2)]);

  downloadFile(`barn-event-${report.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, toCsv(rows), 'text/csv');
  toast('Event report exported', 'success');
}

document.addEventListener('click', event => {
  const target = event.target;

  const actionButton = target.closest('[data-action]');
  if (actionButton && ACTIONS[actionButton.dataset.action]) {
    ACTIONS[actionButton.dataset.action]();
    return;
  }

  const navButton = target.closest('[data-page]');
  if (navButton) { go(navButton.dataset.page); return; }

  const categoryChip = target.closest('[data-category]');
  if (categoryChip) { state.ui.category = categoryChip.dataset.category; renderInventory(); return; }

  const countChip = target.closest('[data-count-category]');
  if (countChip) { state.ui.countCategory = countChip.dataset.countCategory; renderCount(); return; }

  const dniChip = target.closest('[data-dni-category]');
  if (dniChip) { state.ui.dniCategory = dniChip.dataset.dniCategory; renderDni(); return; }

  const rangeButton = target.closest('#range-buttons button');
  if (rangeButton) {
    state.ui.range = rangeButton.dataset.range === 'custom' ? 'custom' : Number(rangeButton.dataset.range);
    renderReports();
    return;
  }

  const activityChip = target.closest('[data-activity-filter]');
  if (activityChip) { state.ui.activityFilter = activityChip.dataset.activityFilter; renderActivity(); return; }

  const restockShortcut = target.closest('[data-restock-item]');
  if (restockShortcut) { openModal('restock', { itemId: restockShortcut.dataset.restockItem }); return; }

  const itemCard = target.closest('[data-item]');
  if (itemCard) {
    const item = state.items.find(row => String(row.id) === itemCard.dataset.item);
    if (item) openModal('itemActions', { item });
    return;
  }

  const dniCard = target.closest('[data-dni-item]');
  if (dniCard) {
    const item = state.items.find(row => String(row.id) === dniCard.dataset.dniItem);
    if (item) openModal('dniActions', { item });
    return;
  }

  const eventRow = target.closest('[data-event-report]');
  if (eventRow) {
    const { start, end } = reportRange();
    const report = buildReport({ items: state.items, history: state.history, events: state.events, start, end });
    const row = report.byEvent.find(candidate => String(candidate.eventId) === eventRow.dataset.eventReport);
    if (row) openModal('eventReport', { report: row });
    return;
  }

  const entry = target.closest('[data-entry]');
  if (entry) {
    const id = entry.dataset.entry;
    if (state.ui.expanded.has(id)) state.ui.expanded.delete(id); else state.ui.expanded.add(id);
    renderHome();
    renderActivity();
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-entry], [data-event-report]');
  if (row) { event.preventDefault(); row.click(); }
  if (event.target.matches('label[for="import-file"]')) { event.preventDefault(); $('#import-file').click(); }
});

document.addEventListener('input', event => {
  const target = event.target;

  if (target.id === 'inventory-search') { state.ui.search = target.value; renderInventory(); return; }
  if (target.id === 'dni-search') { state.ui.dniSearch = target.value; renderDni(); return; }
  if (target.id === 'count-search') {
    state.ui.countSearch = target.value;
    renderCount();
    const field = $('#count-search');
    if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
    return;
  }

  const countInput = target.closest('[data-count-input]');
  if (countInput) {
    const id = countInput.dataset.countInput;
    const value = countInput.value;
    if (value === '') delete state.draft.counts[id];
    else state.draft.counts[id] = value;

    const number = Number(value);
    const invalid = value !== '' && (!Number.isFinite(number) || number < 0);
    countInput.classList.toggle('invalid', invalid);
    countInput.closest('.count-card')?.classList.toggle('touched', value !== '');

    const item = state.items.find(row => String(row.id) === String(id));
    const card = countInput.closest('.count-card');
    const deltaSlot = card?.querySelector('.delta');
    if (item && card) {
      let html = '';
      let className = 'delta';
      if (!invalid && value !== '') {
        const delta = number - Number(item.onHand);
        if (delta < 0) { className = 'delta use'; html = `Usage ${fmt(-delta)} ${unitLabel(item.unit, -delta)} · ${money(revenueFrom(-delta, item), 0)}`; }
        else if (delta > 0) { className = 'delta add'; html = `Adjustment +${fmt(delta)} ${unitLabel(item.unit, delta)}`; }
        else html = 'No change';
      } else if (invalid) {
        className = 'delta';
        html = 'Counts cannot be negative';
      }
      if (deltaSlot) { deltaSlot.className = className; deltaSlot.textContent = html; }
      else if (html) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = html;
        card.querySelector('div')?.appendChild(span);
      }
    }

    updateCountProgress();
    save();
    return;
  }

  if (target.id === 'report-start') { state.ui.customStart = target.value; state.ui.range = 'custom'; renderReports(); }
  if (target.id === 'report-end') { state.ui.customEnd = target.value; state.ui.range = 'custom'; renderReports(); }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'count-event') { state.draft.eventId = target.value; save(); return; }
  if (target.id === 'count-date') { state.draft.date = target.value || isoDate(); save(); return; }
  if (target.id === 'import-file') { importBackup(event); return; }
  if (target.name === 'category' && modalContext.type === 'item' && !modalContext.item) {
    // Default the measurement unit to the category's convention.
    const meta = categoryMeta(target.value);
    const unitField = $('#modal-fields [name="unit"]');
    if (unitField) unitField.value = meta.unit;
  }
  if (target.name === 'unit') {
    const hint = $('#pour-hint');
    if (hint) hint.textContent = target.value === OZ ? 'ounces per pour (e.g. 1.5)' : 'servings per bottle (e.g. 5)';
  }
});

$('#low-stock-toggle').addEventListener('click', () => {
  state.ui.lowOnly = !state.ui.lowOnly;
  renderInventory();
});

$('#count-prefill').addEventListener('click', () => {
  state.ui.prefill = !state.ui.prefill;
  if (state.ui.prefill) {
    for (const item of state.items) {
      if (state.draft.counts[item.id] === undefined) state.draft.counts[item.id] = String(item.onHand);
    }
  } else {
    state.draft.counts = {};
  }
  save();
  renderCount();
  toast(state.ui.prefill ? 'Lines prefilled with book amounts' : 'Count cleared');
});

modal.addEventListener('close', () => { modalContext = { type: null }; });
modal.addEventListener('click', event => {
  if (event.target === modal) closeModal(); // tap the backdrop
});

window.addEventListener('beforeunload', () => { save(); });

boot();
