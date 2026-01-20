const ICONS = {
  chat: '<path d="M4 5.5h16v10H9l-5 4v-14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l1.6 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  brain: '<path d="M9.5 4.5A3 3 0 0 0 6.7 8a3 3 0 0 0-1.2 5.6A3 3 0 0 0 9 18.4V4.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14.5 4.5A3 3 0 0 1 17.3 8a3 3 0 0 1 1.2 5.6 3 3 0 0 1-3.5 4.8V4.5ZM12 7v8" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  sparkles: '<path d="M12 3.5 13.7 9l5.3 1.8-5.3 1.8L12 18l-1.7-5.4L5 10.8 10.3 9 12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  layers: '<path d="m12 3.8 8 4.2-8 4.2-8-4.2 8-4.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m4 12 8 4.2 8-4.2M4 16l8 4.2 8-4.2" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>',
  settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  send: '<path d="M5 12 20 4l-5.5 16-3.2-6.3L5 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m11.3 13.7 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M7 7l.8 12.2h8.4L17 7M10 10.5v5M14 10.5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  edit: '<path d="m14.5 5 4.5 4.5L8.5 20H4v-4.5L14.5 5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m12.5 7 4.5 4.5" stroke="currentColor" stroke-width="1.5"/>',
  play: '<path d="M8 5.5v13l10-6.5L8 5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  download: '<path d="M12 4v10M8 10.5l4 4 4-4M5 19h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  check: '<path d="m5 12.5 4.2 4L19 6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h5v17H7a2.5 2.5 0 0 0-2.5 2.5v-17ZM19.5 5.5A2.5 2.5 0 0 0 17 3h-5v17h5a2.5 2.5 0 0 1 2.5 2.5v-17Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="1.5"/><path d="m7.5 10 2.5 2.5-2.5 2.5M12.5 15H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  image: '<rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="1.4" fill="currentColor"/><path d="m4.5 17 4.5-4.5 4 4 2-2 4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  key: '<circle cx="8" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 12h8M17 12v3M20 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  warning: '<path d="M12 4 21 20H3L12 4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v5M12 17.2v.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
};

export function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
