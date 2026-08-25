// Same-origin: the API is served by this app's own server (see server.mjs).
const API_BASE = '/api';

const ENTITLEMENT_FILTER_GROUPS = [
  { key: 'attachmentScope', label: 'Attachment scope', values: (ent) => [ent.attachmentScope] },
  { key: 'category', label: 'Category', values: (ent) => [ent.category] },
  { key: 'role', label: 'Roles', values: (ent) => (ent.source || []).map((s) => s.role).filter(Boolean) },
];

function createEmptyEntFilters() {
  const filters = {};
  ENTITLEMENT_FILTER_GROUPS.forEach((group) => { filters[group.key] = new Set(); });
  return filters;
}

const state = {
  identity: null,
  service: null,
  identities: [],
  services: [],
  entitlements: [],
  identityFilter: '',
  serviceFilter: '',
  entFilters: createEmptyEntFilters(),
};

const el = {
  bodyIdentities: document.getElementById('body-identities'),
  bodyServices: document.getElementById('body-services'),
  bodyEntitlements: document.getElementById('body-entitlements'),
  countIdentities: document.getElementById('count-identities'),
  countServices: document.getElementById('count-services'),
  countEntitlements: document.getElementById('count-entitlements'),
  emptyIdentities: document.getElementById('empty-identities'),
  emptyServices: document.getElementById('empty-services'),
  emptyEntitlements: document.getElementById('empty-entitlements'),
  searchIdentities: document.getElementById('search-identities'),
  searchServices: document.getElementById('search-services'),
  tableEntitlements: document.getElementById('table-entitlements'),
  filterBtn: document.getElementById('filter-btn'),
  filterPopover: document.getElementById('filter-popover'),
  filterGroups: document.getElementById('filter-groups'),
  filterBadge: document.getElementById('filter-badge'),
  filterClear: document.getElementById('filter-clear'),
};

function matchesFilter(text, filter) {
  return filter === '' || text.toLowerCase().includes(filter);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`);
  }
  return res.json();
}

function setLoading(tbody, emptyEl) {
  tbody.innerHTML = '';
  emptyEl.hidden = false;
  emptyEl.innerHTML = '<span class="spinner"></span>Loading&hellip;';
}

function setError(tbody, emptyEl, message) {
  tbody.innerHTML = '';
  emptyEl.hidden = true;
  tbody.innerHTML = `<tr><td class="error-state">${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function categoryBadge(category) {
  const cls = category === 'list' ? 'badge-list' : category === 'read' ? 'badge-read' : 'badge-write';
  return `<span class="badge ${cls}">${escapeHtml(category)}</span>`;
}

async function loadIdentities() {
  setLoading(el.bodyIdentities, el.emptyIdentities);
  el.countIdentities.textContent = '';
  try {
    const identities = await fetchJson(`${API_BASE}/identities`);
    renderIdentities(identities);
  } catch (err) {
    setError(el.bodyIdentities, el.emptyIdentities, err.message);
  }
}

function renderIdentities(identities) {
  state.identities = identities.slice().sort();
  renderIdentityRows();
}

function renderIdentityRows() {
  el.bodyIdentities.innerHTML = '';

  if (state.identities.length === 0) {
    el.countIdentities.textContent = '0';
    el.emptyIdentities.hidden = false;
    el.emptyIdentities.textContent = 'No identities found';
    return;
  }

  const filtered = state.identities.filter((identity) => matchesFilter(identity, state.identityFilter));
  el.countIdentities.textContent = state.identityFilter
    ? `${filtered.length} / ${state.identities.length}`
    : state.identities.length;

  if (filtered.length === 0) {
    el.emptyIdentities.hidden = false;
    el.emptyIdentities.textContent = 'No matching identities';
    return;
  }
  el.emptyIdentities.hidden = true;

  filtered.forEach((identity) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    if (identity === state.identity) tr.classList.add('selected');
    tr.dataset.identity = identity;
    tr.innerHTML = `<td>${escapeHtml(identity)}</td>`;
    tr.addEventListener('click', () => selectIdentity(identity, tr));
    el.bodyIdentities.appendChild(tr);
  });
}

function selectIdentity(identity, rowEl) {
  state.identity = identity;
  state.service = null;

  [...el.bodyIdentities.children].forEach((row) => row.classList.remove('selected'));
  rowEl.classList.add('selected');

  el.bodyEntitlements.innerHTML = '';
  el.countEntitlements.textContent = '';
  el.emptyEntitlements.hidden = false;
  el.emptyEntitlements.textContent = 'Select a service';

  state.serviceFilter = '';
  el.searchServices.value = '';

  loadServices(identity);
}

async function loadServices(identity) {
  setLoading(el.bodyServices, el.emptyServices);
  el.countServices.textContent = '';
  try {
    const services = await fetchJson(`${API_BASE}/services/${encodeURIComponent(identity)}`);
    renderServices(services);
  } catch (err) {
    setError(el.bodyServices, el.emptyServices, err.message);
  }
}

function renderServices(services) {
  state.services = services.slice().sort();
  renderServiceRows();
}

function renderServiceRows() {
  el.bodyServices.innerHTML = '';

  if (state.services.length === 0) {
    el.countServices.textContent = '0';
    el.emptyServices.hidden = false;
    el.emptyServices.textContent = 'No services found';
    return;
  }

  const filtered = state.services.filter((service) => matchesFilter(service, state.serviceFilter));
  el.countServices.textContent = state.serviceFilter
    ? `${filtered.length} / ${state.services.length}`
    : state.services.length;

  if (filtered.length === 0) {
    el.emptyServices.hidden = false;
    el.emptyServices.textContent = 'No matching services';
    return;
  }
  el.emptyServices.hidden = true;

  filtered.forEach((service) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    if (service === state.service) tr.classList.add('selected');
    tr.dataset.service = service;
    tr.innerHTML = `<td>${escapeHtml(service)}</td>`;
    tr.addEventListener('click', () => selectService(service, tr));
    el.bodyServices.appendChild(tr);
  });
}

function selectService(service, rowEl) {
  state.service = service;

  [...el.bodyServices.children].forEach((row) => row.classList.remove('selected'));
  rowEl.classList.add('selected');

  loadEntitlements(state.identity, service);
}

async function loadEntitlements(identity, service) {
  setLoading(el.bodyEntitlements, el.emptyEntitlements);
  el.countEntitlements.textContent = '';
  try {
    const entitlements = await fetchJson(
      `${API_BASE}/entitlements/${encodeURIComponent(identity)}/${encodeURIComponent(service)}`
    );
    renderEntitlements(entitlements);
  } catch (err) {
    setError(el.bodyEntitlements, el.emptyEntitlements, err.message);
  }
}

function renderEntitlements(entitlements) {
  state.entitlements = entitlements;
  state.entFilters = createEmptyEntFilters();
  buildFilterGroups();
  updateFilterBadge();
  renderEntitlementRows();
}

function entitlementMatchesFilters(ent) {
  return ENTITLEMENT_FILTER_GROUPS.every((group) => {
    const selected = state.entFilters[group.key];
    if (selected.size === 0) return true;
    return group.values(ent).some((v) => selected.has(v));
  });
}

function renderEntitlementRows() {
  el.bodyEntitlements.innerHTML = '';

  if (state.entitlements.length === 0) {
    el.countEntitlements.textContent = '0';
    el.emptyEntitlements.hidden = false;
    el.emptyEntitlements.textContent = 'No entitlements found';
    return;
  }

  const filtered = state.entitlements.filter(entitlementMatchesFilters);
  const filterActive = ENTITLEMENT_FILTER_GROUPS.some((group) => state.entFilters[group.key].size > 0);
  el.countEntitlements.textContent = filterActive
    ? `${filtered.length} / ${state.entitlements.length}`
    : state.entitlements.length;

  if (filtered.length === 0) {
    el.emptyEntitlements.hidden = false;
    el.emptyEntitlements.textContent = 'No matching entitlements';
    return;
  }
  el.emptyEntitlements.hidden = true;

  filtered.forEach((ent) => {
    const roles = (ent.source || []).map((s) => s.role).filter(Boolean);
    const rolesHtml = roles.length
      ? `<div class="roles">${roles.map((r) => `<span class="role-chip">${escapeHtml(r)}</span>`).join('')}</div>`
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(ent.permission)}</td>
      <td>${escapeHtml(ent.resourceDisplayName)}</td>
      <td>${categoryBadge(ent.category)}</td>
      <td>${escapeHtml(ent.attachmentScope)}</td>
      <td>${escapeHtml(ent.sourceCount)}</td>
      <td>${rolesHtml}</td>
    `;
    el.bodyEntitlements.appendChild(tr);
  });
}

function buildFilterGroups() {
  el.filterGroups.innerHTML = '';

  ENTITLEMENT_FILTER_GROUPS.forEach((group) => {
    const values = new Set();
    state.entitlements.forEach((ent) => group.values(ent).forEach((v) => v && values.add(v)));
    const sorted = [...values].sort();

    const groupEl = document.createElement('div');
    groupEl.className = 'filter-group';

    const title = document.createElement('p');
    title.className = 'filter-group-title';
    title.textContent = group.label;
    groupEl.appendChild(title);

    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'filter-empty';
      empty.textContent = 'No values';
      groupEl.appendChild(empty);
    } else {
      sorted.forEach((value) => {
        const label = document.createElement('label');
        label.className = 'filter-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.entFilters[group.key].has(value);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            state.entFilters[group.key].add(value);
          } else {
            state.entFilters[group.key].delete(value);
          }
          updateFilterBadge();
          renderEntitlementRows();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(value));
        groupEl.appendChild(label);
      });
    }

    el.filterGroups.appendChild(groupEl);
  });
}

function updateFilterBadge() {
  const count = ENTITLEMENT_FILTER_GROUPS.reduce((sum, group) => sum + state.entFilters[group.key].size, 0);
  el.filterBadge.hidden = count === 0;
  el.filterBadge.textContent = count;
}

function closeFilterPopover() {
  el.filterPopover.hidden = true;
  el.filterBtn.setAttribute('aria-expanded', 'false');
}

function initColumnResize(table) {
  const headerCells = [...table.tHead.rows[0].cells];
  headerCells.forEach((th) => {
    th.style.width = `${th.offsetWidth}px`;
  });
  table.classList.add('resizable');

  headerCells.forEach((th) => {
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = th.offsetWidth;
      handle.classList.add('resizing');
      document.body.classList.add('col-resizing');

      function onMouseMove(ev) {
        th.style.width = `${Math.max(60, startWidth + (ev.clientX - startX))}px`;
      }
      function onMouseUp() {
        handle.classList.remove('resizing');
        document.body.classList.remove('col-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

el.searchIdentities.addEventListener('input', (e) => {
  state.identityFilter = e.target.value.trim().toLowerCase();
  renderIdentityRows();
});

el.searchServices.addEventListener('input', (e) => {
  if (state.identity === null) return;
  state.serviceFilter = e.target.value.trim().toLowerCase();
  renderServiceRows();
});

el.filterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !el.filterPopover.hidden;
  if (isOpen) {
    closeFilterPopover();
  } else {
    el.filterPopover.hidden = false;
    el.filterBtn.setAttribute('aria-expanded', 'true');
  }
});

el.filterPopover.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', () => {
  if (!el.filterPopover.hidden) closeFilterPopover();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.filterPopover.hidden) closeFilterPopover();
});

el.filterClear.addEventListener('click', () => {
  state.entFilters = createEmptyEntFilters();
  buildFilterGroups();
  updateFilterBadge();
  renderEntitlementRows();
});

buildFilterGroups();
updateFilterBadge();
initColumnResize(el.tableEntitlements);

loadIdentities();
