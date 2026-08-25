// Point this at wherever the backend API server (app/index.mjs) is running.
const API_BASE = 'http://localhost:3000/api';

const state = {
  identity: null,
  service: null,
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
};

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
  el.bodyIdentities.innerHTML = '';
  el.countIdentities.textContent = identities.length;

  if (identities.length === 0) {
    el.emptyIdentities.hidden = false;
    el.emptyIdentities.textContent = 'No identities found';
    return;
  }
  el.emptyIdentities.hidden = true;

  identities.sort().forEach((identity) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
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
  el.bodyServices.innerHTML = '';
  el.countServices.textContent = services.length;

  if (services.length === 0) {
    el.emptyServices.hidden = false;
    el.emptyServices.textContent = 'No services found';
    return;
  }
  el.emptyServices.hidden = true;

  services.sort().forEach((service) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
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
  el.bodyEntitlements.innerHTML = '';
  el.countEntitlements.textContent = entitlements.length;

  if (entitlements.length === 0) {
    el.emptyEntitlements.hidden = false;
    el.emptyEntitlements.textContent = 'No entitlements found';
    return;
  }
  el.emptyEntitlements.hidden = true;

  entitlements.forEach((ent) => {
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

loadIdentities();
