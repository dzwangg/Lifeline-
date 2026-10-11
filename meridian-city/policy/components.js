import { ICONS } from './policies.js';

// Tiny element builder: h('div', { class, style: { '--var': v }, onclick }, ...children)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

export const cls = (...names) => names.filter(Boolean).join(' ');

export const catVars = c => ({ '--cat': c.color, '--cat-deep': c.deep, '--cat-light': c.light, '--cat-tint': c.tint });

export const slotLabel = (slot, category) => (category.slots > 1 ? `${category.label} ${slot.index + 1}` : category.label);

export const icon = name =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

// A collectible-style policy card. `place` is 'library' or 'slot'; `inUse` labels a library card already slotted.
export function PolicyCard(policy, category, { place = 'library', key, inUse = null, armed = false } = {}) {
  const where = inUse ? `, ${inUse.toLowerCase()}` : '';
  return h('div', {
    class: cls('pp-card', inUse && 'is-in-use', armed && 'is-armed'),
    role: 'button',
    tabindex: 0,
    'data-policy': policy.id,
    'data-place': place,
    'data-key': key,
    'aria-pressed': armed ? 'true' : 'false',
    'aria-label': `${policy.title}, ${policy.aiDrafted ? 'AI-drafted ' : ''}${category.label} policy${where}. ${policy.summary}`,
    style: catVars(category),
  },
    h('span', { class: 'pp-card__cat' }, category.label),
    policy.aiDrafted && h('span', { class: 'pp-ai pp-card__ai' }, 'AI-drafted'),
    h('span', { class: 'pp-card__orb', 'aria-hidden': 'true', html: icon(policy.icon) }),
    h('strong', { class: 'pp-card__title' }, policy.title),
    h('span', { class: 'pp-card__desc' }, policy.summary),
    inUse && h('span', { class: 'pp-card__badge' }, inUse));
}

// An active-policy slot: a card when filled, a faint card outline when empty.
export function PolicySlot(slot, category, policy, { armed = false } = {}) {
  const label = slotLabel(slot, category);
  const el = h('div', {
    class: cls('pp-slot', policy ? 'is-filled' : 'is-empty'),
    'data-drop': 'slot',
    'data-slot': slot.id,
    'data-category': category.id,
    style: catVars(category),
  });
  if (policy) {
    el.append(
      PolicyCard(policy, category, { place: 'slot', key: `slot:${slot.id}`, armed }),
      h('button', { class: 'pp-slot__remove', type: 'button', 'data-remove': slot.id, 'aria-label': `Return ${policy.title} to the library` },
        h('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>' })),
    );
  } else {
    el.append(h('div', { class: 'pp-slot__empty', role: 'button', tabindex: 0, 'data-key': `slot:${slot.id}`, 'aria-label': `Empty ${label} slot` },
      h('span', { class: 'pp-slot__label' }, label),
      h('span', { class: 'pp-slot__hint' }, `Drop ${/^[aeiou]/i.test(category.label) ? 'an' : 'a'} ${category.label.toLowerCase()} card`)));
  }
  return el;
}

export function CategoryRow(category, slotEls) {
  const id = `pp-row-${category.id}`;
  return h('div', { class: 'pp-row', role: 'group', 'aria-labelledby': id, 'data-slots': category.slots, style: catVars(category) },
    h('div', { class: 'pp-row__head' },
      h('span', { class: 'pp-row__dot', 'aria-hidden': 'true' }),
      h('h4', { class: 'pp-row__title', id }, category.label),
      h('span', { class: 'pp-row__count' }, category.slots === 1 ? '1 slot' : `${category.slots} slots`)),
    h('div', { class: 'pp-row__slots' }, slotEls));
}

export function GlassButton(label, { variant = 'default', ...attrs } = {}) {
  return h('button', { class: cls('pp-btn', variant !== 'default' && `pp-btn--${variant}`), type: 'button', ...attrs }, label);
}

export function FilterChip(label, { pressed = false, category = null, value } = {}) {
  return h('button', {
    class: 'pp-chip',
    type: 'button',
    'aria-pressed': pressed ? 'true' : 'false',
    'data-filter': value,
    'data-key': `filter:${value}`,
    style: category ? catVars(category) : null,
  }, label);
}
