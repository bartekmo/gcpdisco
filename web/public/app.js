// Same-origin: the API is served by this app's own server (see server.mjs).
const API_BASE = '/api';

// Pseudo service pinned at the top of the services list. Selecting it merges
// entitlements across every real service by calling the existing
// per-service endpoint once per service and combining the results - no
// backend change needed since the browser already has the full service list.
const ALL_SERVICES = '__all__';

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
  roleCache: new Map(),
  membersCache: new Map(),
  activeRoleButton: null,
  policyRequestId: 0,
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
  policyPanel: document.getElementById('policy-panel'),
  policyPanelBody: document.getElementById('policy-panel-body'),
  policyPanelClose: document.getElementById('policy-panel-close'),
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
  closePolicyPanel();

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
  el.emptyServices.hidden = true;

  el.countServices.textContent = state.serviceFilter
    ? `${state.services.filter((service) => matchesFilter(service, state.serviceFilter)).length} / ${state.services.length}`
    : state.services.length;

  const allRow = document.createElement('tr');
  allRow.className = 'clickable service-all-row';
  if (state.service === ALL_SERVICES) allRow.classList.add('selected');
  allRow.innerHTML = '<td>ALL SERVICES</td>';
  allRow.addEventListener('click', () => selectService(ALL_SERVICES, allRow));
  el.bodyServices.appendChild(allRow);

  if (state.services.length === 0) return;

  const filtered = state.services.filter((service) => matchesFilter(service, state.serviceFilter));
  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="filter-empty">No matching services</td>';
    el.bodyServices.appendChild(tr);
    return;
  }

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
  closePolicyPanel();

  loadEntitlements(state.identity, service);
}

async function loadEntitlements(identity, service) {
  setLoading(el.bodyEntitlements, el.emptyEntitlements);
  el.countEntitlements.textContent = '';
  try {
    const entitlements = service === ALL_SERVICES
      ? await loadAllEntitlements(identity)
      : await fetchJson(`${API_BASE}/entitlements/${encodeURIComponent(identity)}/${encodeURIComponent(service)}`);
    renderEntitlements(entitlements);
  } catch (err) {
    setError(el.bodyEntitlements, el.emptyEntitlements, err.message);
  }
}

async function loadAllEntitlements(identity) {
  const perService = await Promise.all(
    state.services.map((service) =>
      fetchJson(`${API_BASE}/entitlements/${encodeURIComponent(identity)}/${encodeURIComponent(service)}`)
    )
  );
  return perService.flat();
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(ent.permission)}</td>
      <td>${escapeHtml(ent.resourceDisplayName)}</td>
      <td>${categoryBadge(ent.category)}</td>
      <td>${escapeHtml(ent.attachmentScope)}</td>
      <td>${escapeHtml(ent.sourceCount)}</td>
      <td></td>
    `;

    const sources = ent.source || [];
    if (sources.length) {
      const rolesCell = tr.lastElementChild;
      const rolesContainer = document.createElement('div');
      rolesContainer.className = 'roles';
      sources.forEach((source) => {
        if (!source.role) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'role-chip role-chip-btn';
        btn.textContent = source.role;
        btn.addEventListener('click', () => openPolicyBindingDetails(ent, source, btn));
        rolesContainer.appendChild(btn);
      });
      rolesCell.appendChild(rolesContainer);
    }

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

function positionFilterPopover() {
  const rect = el.filterBtn.getBoundingClientRect();
  el.filterPopover.style.top = `${rect.bottom + 6}px`;
  el.filterPopover.style.left = `${rect.left}px`;
}

async function loadRole(roleName) {
  if (state.roleCache.has(roleName)) {
    return state.roleCache.get(roleName);
  }
  const promise = fetchJson(`${API_BASE}/roles/${encodeURIComponent(roleName)}`);
  state.roleCache.set(roleName, promise);
  try {
    return await promise;
  } catch (err) {
    state.roleCache.delete(roleName);
    throw err;
  }
}

async function loadPolicyMembers(attachmentPoint, role) {
  const cacheKey = `${attachmentPoint}::${role}`;
  if (state.membersCache.has(cacheKey)) {
    return state.membersCache.get(cacheKey);
  }
  const promise = fetchJson(
    `${API_BASE}/policy-members?attachmentPoint=${encodeURIComponent(attachmentPoint)}&role=${encodeURIComponent(role)}`
  );
  state.membersCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (err) {
    state.membersCache.delete(cacheKey);
    throw err;
  }
}

function closePolicyPanel() {
  el.policyPanel.hidden = true;
  if (state.activeRoleButton) {
    state.activeRoleButton.classList.remove('selected');
    state.activeRoleButton = null;
  }
}

function openPolicyBindingDetails(ent, source, btn) {
  if (state.activeRoleButton) state.activeRoleButton.classList.remove('selected');
  state.activeRoleButton = btn;
  btn.classList.add('selected');

  const requestId = ++state.policyRequestId;
  const isCurrent = () => state.policyRequestId === requestId;

  el.policyPanel.hidden = false;

  const assignment = source.type === 'direct' ? 'directly assigned' : 'inherited';
  const assignmentClass = source.type === 'direct' ? 'badge-direct' : 'badge-inherited';
  const loadingHtml = '<div class="empty-state"><span class="spinner"></span>Loading&hellip;</div>';

  el.policyPanelBody.innerHTML = `
    <details class="policy-section" open>
      <summary class="policy-section-title">Binding</summary>
      <dl>
        <div class="policy-row"><dt>Role</dt><dd>${escapeHtml(source.role)}</dd></div>
        <div class="policy-row"><dt>Attachment point</dt><dd>${escapeHtml(source.attachmentPoint)}</dd></div>
        <div class="policy-row"><dt>Assignment</dt><dd><span class="badge ${assignmentClass}">${escapeHtml(assignment)}</span></dd></div>
      </dl>
    </details>
    <details class="policy-section">
      <summary class="policy-section-title" id="policy-role-title">Role details</summary>
      <div id="policy-role-body">${loadingHtml}</div>
    </details>
    <details class="policy-section" open>
      <summary class="policy-section-title" id="policy-permissions-title">Permissions</summary>
      <div id="policy-permissions-body">${loadingHtml}</div>
    </details>
    <details class="policy-section" open>
      <summary class="policy-section-title" id="policy-assignments-title">Assignments</summary>
      <div id="policy-assignments-body">${loadingHtml}</div>
    </details>
  `;

  loadRole(source.role)
    .then((role) => {
      if (!isCurrent()) return;
      document.getElementById('policy-role-title').textContent = 'Role details';
      document.getElementById('policy-role-body').innerHTML = `
        <dl>
          <div class="policy-row"><dt>Title</dt><dd>${escapeHtml(role.title)}</dd></div>
          <div class="policy-row"><dt>Description</dt><dd>${escapeHtml(role.description)}</dd></div>
          <div class="policy-row"><dt>Stage</dt><dd>${escapeHtml(role.stage)}</dd></div>
        </dl>
      `;

      const permissions = role.includedPermissions || [];
      document.getElementById('policy-permissions-title').textContent = `Permissions (${permissions.length})`;
      document.getElementById('policy-permissions-body').innerHTML = permissions.length
        ? `<ul class="permissions-list">${permissions.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '<div class="filter-empty">No permissions found</div>';
    })
    .catch((err) => {
      if (!isCurrent()) return;
      const message = `<div class="error-state">Could not load role details: ${escapeHtml(err.message)}</div>`;
      document.getElementById('policy-role-body').innerHTML = message;
      document.getElementById('policy-permissions-body').innerHTML = message;
    });

  loadPolicyMembers(source.attachmentPoint, source.role)
    .then((members) => {
      if (!isCurrent()) return;
      document.getElementById('policy-assignments-title').textContent = `Assignments (${members.length})`;
      document.getElementById('policy-assignments-body').innerHTML = members.length
        ? `<ul class="members-list">${members.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`
        : '<div class="filter-empty">No members found</div>';
    })
    .catch((err) => {
      if (!isCurrent()) return;
      document.getElementById('policy-assignments-body').innerHTML =
        `<div class="error-state">Could not load assignments: ${escapeHtml(err.message)}</div>`;
    });
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
    positionFilterPopover();
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

window.addEventListener('resize', () => {
  if (!el.filterPopover.hidden) positionFilterPopover();
});

window.addEventListener('scroll', () => {
  if (!el.filterPopover.hidden) positionFilterPopover();
}, true);

el.filterClear.addEventListener('click', () => {
  state.entFilters = createEmptyEntFilters();
  buildFilterGroups();
  updateFilterBadge();
  renderEntitlementRows();
});

el.policyPanelClose.addEventListener('click', closePolicyPanel);

buildFilterGroups();
updateFilterBadge();
initColumnResize(el.tableEntitlements);

loadIdentities();
