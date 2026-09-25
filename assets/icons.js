(() => {
  const icons = {
    home:'<path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/>',
    inbox:'<path d="M4 4h16v14H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 5v3m0 8v3m4-7h3M5 12h3"/>',
    send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 15.5l2 1.5-3 3-1.5-2a8 8 0 0 1-2.5 1v2h-4v-2a8 8 0 0 1-2.5-1L6 20l-3-3 2-1.5A8 8 0 0 1 4 13H2V9h2a8 8 0 0 1 1-2.5L3 5l3-3 1.5 2A8 8 0 0 1 10 3V1h4v2a8 8 0 0 1 2.5 1L18 2l3 3-2 1.5A8 8 0 0 1 20 9h2v4h-2a8 8 0 0 1-1 2.5Z"/>',
    alert:'<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5m0 3h.01"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
    userAlert:'<path d="M14 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8" cy="7" r="4"/><path d="M19 8v5m0 3h.01"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart:'<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    clipboard:'<path d="M9 5H6a2 2 0 0 0-2 2v14h16V7a2 2 0 0 0-2-2h-3"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M8 12h8m-8 4h6"/>',
    file:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6m-6 4h6"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    teacher:'<path d="M3 4h18v12H3zM8 20h8m-4-4v4"/><circle cx="9" cy="9" r="2"/><path d="M13 8h5m-5 3h4"/>',
    rocket:'<path d="M14 5c3-3 6-3 7-3 0 1 0 4-3 7l-4 4-7-4Z"/><path d="m9 10-4 1-3 3 6 1m6 0-1 4-3 3-1-6"/><circle cx="16" cy="7" r="1.5"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    building:'<path d="M4 21V5l8-3v19m0-13h8v13M2 21h20"/><path d="M7 8h2m-2 4h2m-2 4h2m8-4h2m-2 4h2"/>',
    handshake:'<path d="m2 9 4-4 4 3m12 1-4-4-4 3M6 13l5 5a2 2 0 0 0 3 0l4-4"/><path d="m8 12 3 3a2 2 0 0 0 3 0l4-4M2 9l4 4m16-4-4 4"/>',
    lightbulb:'<path d="M9 18h6m-5 3h4"/><path d="M8 14a7 7 0 1 1 8 0c-.8.6-1 1.3-1 2H9c0-.7-.2-1.4-1-2Z"/>',
    graduation:'<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c3 2 9 2 12 0v-5m4-2v6"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
  };
  document.querySelectorAll('[data-icon]').forEach((element) => {
    if (!icons[element.dataset.icon]) return;
    element.innerHTML = `<svg class="portal-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[element.dataset.icon]}</svg>`;
  });
})();
