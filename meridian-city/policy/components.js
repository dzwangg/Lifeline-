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

// Small 12×12 stroke glyphs for the panel's own buttons and tags.
const GLYPHS = {
  close: '<path d="M3 3l6 6M9 3l-6 6"/>',
  plus: '<path d="M6 2.5v7M2.5 6h7"/>',
  info: '<circle cx="6" cy="6" r="4.6"/><path d="M6 5.4v3M6 3.6v.1"/>',
  check: '<path d="m2.6 6.3 2.2 2.2 4.6-4.9"/>',
  pending: '<circle cx="6" cy="6" r="4.4"/><path d="M6 3.8V6l1.5 1"/>',
  pencil: '<path d="M2.5 9.5 3 7.4l4.9-4.9 1.6 1.6L4.6 9 2.5 9.5Z"/>',
  trash: '<path d="M2.5 3.5h7M4.8 3.5V2.4h2.4v1.1M3.5 3.5l.5 6h4l.5-6"/>',
};
export const glyph = name => h('span', { class: 'pp-glyph', 'aria-hidden': 'true', html: `<svg viewBox="0 0 12 12">${GLYPHS[name]}</svg>` });

// A collectible-style policy card. `place` is 'library' or 'slot'; `inUse` labels a library card already slotted.
// A card the player drafted (policy.drafted) is held in a wrapper that carries its Discard button, so the button is a
// sibling of the card and not a control buried inside one: `confirming` swaps it for the two-step confirmation.
export function PolicyCard(policy, category, { place = 'library', key, inUse = null, armed = false, confirming = false } = {}) {
  const where = inUse ? `, ${inUse.toLowerCase()}` : '';
  const card = h('div', {
    class: cls('pp-card', inUse && 'is-in-use', armed && 'is-armed'),
    role: 'button',
    tabindex: 0,
    'data-policy': policy.id,
    'data-place': place,
    'data-key': key,
    'aria-pressed': armed ? 'true' : 'false',
    'aria-label': `${policy.title}, ${category.label} policy${where}. ${policy.summary}`,
    style: catVars(category),
  },
    h('span', { class: 'pp-card__cat' }, policy.drafted ? `${category.label} \u00b7 yours` : category.label),
    h('span', { class: 'pp-card__orb', 'aria-hidden': 'true', html: icon(policy.icon) }),
    h('strong', { class: 'pp-card__title' }, policy.title),
    h('span', { class: 'pp-card__desc' }, policy.summary),
    inUse && h('span', { class: 'pp-card__badge' }, inUse));
  if (!policy.drafted || place !== 'library') return card;
  return h('div', { class: cls('pp-held', confirming && 'is-confirming'), style: catVars(category) }, card,
    confirming
      ? h('div', { class: 'pp-held__confirm', role: 'group', 'aria-label': `Discard ${policy.title}?` },
        h('p', { class: 'pp-held__ask' }, 'Discard this card?'),
        h('p', { class: 'pp-held__note' }, 'It leaves your library for good. Ask the city for it again to get it back.'),
        h('div', { class: 'pp-held__row' },
          h('button', { class: 'pp-scen__yes', type: 'button', 'data-discard-yes': policy.id }, 'Discard'),
          h('button', { class: 'pp-scen__no', type: 'button', 'data-discard-no': policy.id }, 'Keep')))
      : h('button', { class: 'pp-held__btn', type: 'button', 'data-discard': policy.id, title: 'Discard this card',
        'aria-label': `Discard ${policy.title}, a card you drafted` }, glyph('trash')));
}

// An active-policy slot. Filled: the policy's face (select or drag it to move it), its status, Change and Remove,
// and its description on demand. Empty: one Add policy target.
// status: 'applied' | 'pending' (placed, not applied yet). removing: the applied policy an emptied slot will drop.
export function PolicySlot(slot, category, policy, { armed = false, choosing = false, status = null, removing = null, expanded = false } = {}) {
  const label = slotLabel(slot, category);
  const el = h('div', {
    class: cls('pp-slot', policy ? 'is-filled' : 'is-empty', armed && 'is-picked', choosing && 'is-choosing'),
    'data-drop': 'slot',
    'data-slot': slot.id,
    'data-category': category.id,
    style: catVars(category),
  });
  if (!policy) {
    el.append(h('div', {
      class: 'pp-slot__empty', role: 'button', tabindex: 0, 'data-key': `slot:${slot.id}`,
      'aria-pressed': choosing ? 'true' : 'false',
      'aria-label': choosing ? `${label}: choose a ${category.label.toLowerCase()} policy in the library` : `Add a policy to ${label}, empty`,
    },
      h('span', { class: 'pp-slot__ghost', 'aria-hidden': 'true' }, glyph('plus')),
      h('span', { class: 'pp-slot__text' },
        h('span', { class: 'pp-slot__name' }, label),
        h('span', { class: 'pp-slot__meta' }, removing ? `Drops ${removing.title} when applied` : 'Empty slot')),
      h('span', { class: 'pp-slot__add', 'aria-hidden': 'true' },
        choosing ? 'Pick one in the library' : [glyph('plus'), 'Add policy'])));
    return el;
  }
  const descId = `pp-desc-${slot.id}`;
  el.append(
    h('div', {
      class: cls('pp-card', 'pp-card--slot', armed && 'is-armed'),
      role: 'button',
      tabindex: 0,
      'data-policy': policy.id,
      'data-place': 'slot',
      'data-key': `slot:${slot.id}`,
      'aria-pressed': armed ? 'true' : 'false',
      'aria-label': `${policy.title}, in ${label}${status === 'pending' ? ', not applied yet' : ''}. Select to move it.`,
    },
      h('span', { class: 'pp-card__orb', 'aria-hidden': 'true', html: icon(policy.icon) }),
      h('span', { class: 'pp-card__text' },
        h('strong', { class: 'pp-card__title' }, policy.title),
        h('span', { class: 'pp-card__meta' },
          h('span', { class: 'pp-card__slot' }, label),
          status && h('span', { class: `pp-tag is-${status}` }, glyph(status === 'applied' ? 'check' : 'pending'),
            status === 'applied' ? 'Applied' : 'Not applied yet')),
        armed && h('span', { class: 'pp-card__picked' }, 'Picked up: choose a slot'),
        choosing && h('span', { class: 'pp-card__picked' }, 'Pick a replacement in the library'))),
    h('p', { class: 'pp-slot__desc', id: descId, hidden: !expanded }, policy.summary),
    h('div', { class: 'pp-slot__actions' },
      h('button', {
        class: 'pp-slot__btn pp-slot__btn--icon', type: 'button', 'data-details': slot.id, 'data-key': `details:${slot.id}`,
        'aria-expanded': String(expanded), 'aria-controls': descId, 'aria-label': `Details for ${policy.title}`, title: expanded ? 'Hide details' : 'Details',
      }, glyph('info')),
      h('button', {
        class: 'pp-slot__btn', type: 'button', 'data-change': slot.id, 'data-key': `change:${slot.id}`,
        'aria-pressed': String(choosing), 'aria-label': choosing ? `Stop choosing a replacement for ${policy.title}` : `Change the ${label} policy`,
      }, choosing ? 'Cancel' : 'Change'),
      h('button', {
        class: 'pp-slot__btn pp-slot__btn--remove', type: 'button', 'data-remove': slot.id, 'data-key': `remove:${slot.id}`,
        'aria-label': `Remove ${policy.title} from ${label}`, title: 'Remove',
      }, glyph('close'), h('span', { class: 'pp-slot__btn-label' }, 'Remove'))),
  );
  return el;
}

// A scenario in the left bar. Selecting it is one button; rename and delete sit apart as their own small buttons.
// mode: null | 'rename' | 'confirm-delete'
export function ScenarioItem(sc, total, { mode = null, canDelete = true } = {}) {
  const meta = `${sc.filled} of ${total} policies`;
  if (mode === 'rename') {
    return h('li', { class: cls('pp-scen', 'is-renaming', sc.edited && 'is-current') },
      h('input', {
        class: 'pp-scen__input', type: 'text', value: sc.name, maxlength: 60, 'data-rename-input': sc.id,
        'aria-label': `Rename ${sc.name}`, 'aria-describedby': 'pp-scen-hint', autocomplete: 'off', spellcheck: 'false',
      }),
      h('p', { class: 'pp-scen__hint', id: 'pp-scen-hint' }, 'Enter saves, Esc cancels'));
  }
  if (mode === 'confirm-delete') {
    return h('li', { class: cls('pp-scen', 'is-confirming', sc.edited && 'is-current'), role: 'group', 'aria-label': `Delete ${sc.name}?` },
      h('p', { class: 'pp-scen__ask' }, 'Delete ', h('strong', {}, sc.name), '?'),
      h('div', { class: 'pp-scen__confirm' },
        h('button', { class: 'pp-scen__yes', type: 'button', 'data-delete-yes': sc.id, 'data-key': `delete-yes:${sc.id}` }, 'Delete'),
        h('button', { class: 'pp-scen__no', type: 'button', 'data-delete-no': sc.id, 'data-key': `delete-no:${sc.id}` }, 'Keep')));
  }
  return h('li', { class: cls('pp-scen', sc.edited && 'is-current', sc.running && 'is-running') },
    h('button', {
      class: 'pp-scen__pick', type: 'button', 'data-scenario': sc.id, 'data-key': `scen:${sc.id}`,
      'aria-current': sc.edited ? 'true' : null,
      'aria-label': `${sc.name}, ${meta}${sc.running ? ', running in the city' : ''}`,
    },
      h('span', { class: 'pp-scen__mark', 'aria-hidden': 'true' }),
      h('span', { class: 'pp-scen__text' },
        h('span', { class: 'pp-scen__name' }, sc.name),
        h('span', { class: 'pp-scen__meta' }, meta, sc.running && h('span', { class: 'pp-scen__badge' }, 'Running')))),
    h('div', { class: 'pp-scen__tools' },
      h('button', { class: 'pp-scen__tool', type: 'button', 'data-rename': sc.id, 'data-key': `rename:${sc.id}`, 'aria-label': `Rename ${sc.name}`, title: 'Rename' }, glyph('pencil')),
      h('button', {
        class: 'pp-scen__tool', type: 'button', 'data-delete': sc.id, 'data-key': `delete:${sc.id}`, disabled: !canDelete,
        'aria-label': canDelete ? `Delete ${sc.name}` : `${sc.name} is the only scenario and cannot be deleted`,
        title: canDelete ? 'Delete' : 'The only scenario cannot be deleted',
      }, glyph('trash'))));
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
