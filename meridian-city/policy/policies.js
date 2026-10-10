// Policy definitions for the Chapel Hill–Durham simulator.
//
// Category: { id, label, slots, color, deep, light, tint }
//   slots  how many active slots the category gets in the policy panel
//   color  card border and icon orb; deep is the text-safe shade; light/tint are highlights and fills
//
// Policy: { id, title, category, icon, summary }
//   icon   a key of ICONS
//   Economic effects are not modelled yet; add them as new fields when the simulation consumes them.

export const CATEGORIES = [
  { id: 'business',   label: 'Business',   slots: 2, color: '#2b8ad8', deep: '#145a96', light: '#9bd6ff', tint: '#e3f2fd' },
  { id: 'employment', label: 'Employment', slots: 1, color: '#13b3c2', deep: '#08707b', light: '#9bf2f8', tint: '#e0f8fa' },
  { id: 'housing',    label: 'Housing',    slots: 1, color: '#45b04f', deep: '#256f2d', light: '#b3f0a5', tint: '#e6f7e3' },
  { id: 'taxation',   label: 'Taxation',   slots: 1, color: '#e8a032', deep: '#8a560b', light: '#ffe196', tint: '#fdf2df' },
  { id: 'transport',  label: 'Transport',  slots: 1, color: '#8a63d2', deep: '#563596', light: '#d9c8ff', tint: '#f1ebfd' },
];

export const SLOTS = CATEGORIES.flatMap(c =>
  Array.from({ length: c.slots }, (_, index) => ({ id: `${c.id}-${index + 1}`, category: c.id, index })));

export const POLICIES = [
  {
    id: 'small-business-support-grant',
    title: 'Small-Business Support Grant',
    category: 'business',
    icon: 'storefront',
    summary: 'Grants that help established local shops cover rent, payroll and upgrades.',
  },
  {
    id: 'new-business-startup-grant',
    title: 'New-Business Startup Grant',
    category: 'business',
    icon: 'sprout',
    summary: 'Seed funding for businesses in their first year of operation.',
  },
  {
    id: 'hiring-subsidy',
    title: 'Hiring Subsidy',
    category: 'employment',
    icon: 'hire',
    summary: 'Pays part of the wage for each new local hire during their first year.',
  },
  {
    id: 'housing-construction-subsidy',
    title: 'Housing Construction Subsidy',
    category: 'housing',
    icon: 'house',
    summary: 'Offsets building costs so more new homes get built.',
  },
  {
    id: 'property-tax-adjustment',
    title: 'Property Tax Adjustment',
    category: 'taxation',
    icon: 'percent',
    summary: 'Changes the property tax rate on homes and commercial parcels.',
  },
];

// 24×24 stroke icons, drawn white inside the card's orb.
export const ICONS = {
  storefront: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M3.5 9a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 10c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6Z"/><path d="M7.5 21h9"/>',
  hire: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  percent: '<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M19 5 5 19"/>',
  tower: '<path d="M4 21h16"/><path d="M6 21V11h5v10"/><path d="M13 21V5h5v16"/><path d="M15.5 2.5v-.01M8.5 7l1-3 1 3"/>',
  parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
  vacancy: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M5 9v11h14V9"/><path d="m9.5 12.5 5 5M14.5 12.5l-5 5"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14"/><path d="M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16 9.5 9h6l2.5 7"/><path d="M12 16 9.5 9M8.5 6.5h3"/>',
};
