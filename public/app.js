/**
 * Automação de Planilhas — Lucari Digital
 * Dashboard Application Script
 */

// ============================================
// State & DOM Refs
// ============================================
const state = {
    currentSection: 'dashboard',
    clients: [],
    activityLog: [],
    webhookCount: 0,
    period: '30d',
    dateFrom: null,
    dateTo: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const refs = {
    modal: $('#modal-client'),
    clientForm: $('#form-client'),
    clientList: $('#client-list'),
    sidebar: $('#sidebar'),
    hamburger: $('#hamburger'),
};

// ============================================
// Navigation
// ============================================

function navigateTo(section, replace = false) {
    if (!section) section = 'dashboard';

    // Normalize section names
    const validSections = ['dashboard', 'clients', 'settings', 'client-details', 'logs', 'sdr', 'calculadora'];
    if (!validSections.includes(section)) section = 'dashboard';

    state.currentSection = section;

    // Update active section
    $$('.page-section').forEach(el => el.classList.remove('active'));
    const target = $(`#section-${section}`);
    if (target) target.classList.add('active');

    // Update sidebar active state
    $$('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === section);
    });

    // Close mobile sidebar
    closeMobileSidebar();

    // Update URL History
    const url = section === 'dashboard' ? '/' : `/${section}`;
    if (replace) {
        history.replaceState({ section }, '', url);
    } else {
        history.pushState({ section }, '', url);
    }

    // Refresh section data
    if (section === 'clients') loadClients();
    if (section === 'settings') loadSettings();
    if (section === 'settings') loadSettings();
    if (section === 'logs') {
        populateClientSelect();
        const container = $('#investigation-results');
        if (container && (container.innerHTML.includes('Carregando') || container.innerHTML.trim() === '')) {
            searchLeads('');
        }
    }
    if (section === 'sdr') loadSDRSection();
    if (section === 'calculadora') loadCalcSection();
}

// Handle Browser Back/Forward
window.addEventListener('popstate', (event) => {
    const section = event.state ? event.state.section : getSectionFromUrl();
    navigateTo(section, true); // replace=true to avoid duplicate history stack
});

function getSectionFromUrl() {
    const path = window.location.pathname.replace('/', '');
    return path || 'dashboard';
}

// Sidebar navigation clicks
$$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        if (section !== state.currentSection) {
            navigateTo(section);
        }
    });
});

// Mobile sidebar
function openMobileSidebar() {
    refs.sidebar.classList.add('open');
    let backdrop = $('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }
    backdrop.classList.add('visible');
    backdrop.onclick = closeMobileSidebar;
}

function closeMobileSidebar() {
    refs.sidebar.classList.remove('open');
    const backdrop = $('.sidebar-backdrop');
    if (backdrop) backdrop.classList.remove('visible');
}

refs.hamburger?.addEventListener('click', () => {
    if (refs.sidebar.classList.contains('open')) {
        closeMobileSidebar();
    } else {
        openMobileSidebar();
    }
});

// ============================================
// API Calls
// ============================================
async function fetchHealth() {
    try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error('offline');
        const data = await res.json();
        return data;
    } catch {
        return null;
    }
}

async function fetchClients() {
    try {
        const res = await fetch('/admin/clients');
        const data = await res.json();
        // Backend returns array directly or {clients: [...]}
        return Array.isArray(data) ? data : (data.clients || []);
    } catch {
        return [];
    }
}

async function fetchActivity() {
    try {
        const res = await fetch(`/api/dashboard/activity${buildDateQS()}`);
        const data = await res.json();
        return Array.isArray(data) ? data : (data.logs || []);
    } catch {
        return [];
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/admin/status');
        return await res.json();
    } catch {
        return null;
    }
}

async function addClient(clientData) {
    const res = await fetch('/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientData),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao salvar');
    }
    return await res.json();
}



async function removeClient(id) {
    const res = await fetch(`/admin/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erro ao remover');
}

async function reloadSystem() {
    const res = await fetch('/admin/reload', { method: 'POST' });
    return res.ok;
}

// ============================================
// Period Selector
// ============================================

/**
 * Retorna { from, to } em ISO UTC baseado no período selecionado.
 * Usa fuso São Paulo (UTC-3) para calcular meia-noite.
 */
function getSelectedDateRange() {
    const SP_OFFSET = -3; // UTC-3

    function spMidnightToUTC(date) {
        // date é um Date representando um dia; queremos meia-noite SP daquele dia em UTC
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        // Meia-noite SP = 03:00 UTC
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), -SP_OFFSET, 0, 0));
    }

    function spNow() {
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        return new Date(utcMs + SP_OFFSET * 3600000);
    }

    const today = spNow();
    let from, to;

    switch (state.period) {
        case 'today':
            from = spMidnightToUTC(today);
            to = null; // sem limite superior — inclui até agora
            break;
        case 'yesterday': {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            from = spMidnightToUTC(yesterday);
            to = spMidnightToUTC(today); // até meia-noite de hoje (exclusive)
            break;
        }
        case '7d': {
            const d = new Date(today);
            d.setDate(d.getDate() - 6);
            from = spMidnightToUTC(d);
            to = null;
            break;
        }
        case '30d': {
            const d = new Date(today);
            d.setDate(d.getDate() - 29);
            from = spMidnightToUTC(d);
            to = null;
            break;
        }
        case 'custom': {
            if (state.dateFrom) {
                const parts = state.dateFrom.split('-');
                from = spMidnightToUTC(new Date(parts[0], parts[1] - 1, parts[2]));
            }
            if (state.dateTo) {
                const parts = state.dateTo.split('-');
                const endDay = new Date(parts[0], parts[1] - 1, parts[2]);
                endDay.setDate(endDay.getDate() + 1); // incluir o dia inteiro
                to = spMidnightToUTC(endDay);
            }
            break;
        }
        default:
            from = spMidnightToUTC(today);
            to = null;
    }

    return {
        from: from ? from.toISOString() : undefined,
        to: to ? to.toISOString() : undefined,
    };
}

function getPeriodLabel() {
    switch (state.period) {
        case 'today': return 'Hoje';
        case 'yesterday': return 'Ontem';
        case '7d': return '7 dias';
        case '30d': return '30 dias';
        case 'custom': return 'Personalizado';
        default: return 'Hoje';
    }
}

function buildDateQS() {
    const { from, to } = getSelectedDateRange();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

function updatePeriodLabels() {
    const label = getPeriodLabel();
    const labelLeads = document.getElementById('label-leads');
    const labelSales = document.getElementById('label-sales');
    const labelErrors = document.getElementById('label-errors');
    if (labelLeads) labelLeads.textContent = `Leads ${label}`;
    if (labelSales) labelSales.textContent = `Vendas ${label}`;
    if (labelErrors) labelErrors.textContent = `Erros ${label}`;

    // Update "leads hoje" label on client preview cards
    const countLabels = document.querySelectorAll('.leads-count-label');
    countLabels.forEach(el => {
        el.textContent = `leads ${label.toLowerCase()}`;
    });
}

function setupPeriodSelector() {
    const pills = document.querySelectorAll('.period-pill');
    const customRange = document.getElementById('period-custom-range');
    const btnApply = document.getElementById('btn-period-apply');

    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.period = pill.dataset.period;

            if (state.period === 'custom') {
                if (customRange) customRange.style.display = 'flex';
            } else {
                if (customRange) customRange.style.display = 'none';
                updatePeriodLabels();
                updateDashboard();
            }
        });
    });

    if (btnApply) {
        btnApply.addEventListener('click', () => {
            const fromInput = document.getElementById('period-from');
            const toInput = document.getElementById('period-to');
            state.dateFrom = fromInput ? fromInput.value : null;
            state.dateTo = toInput ? toInput.value : null;
            updatePeriodLabels();
            updateDashboard();
        });
    }
}

// ============================================
// Stats & Dashboard
// ============================================
async function updateDashboard() {
    const health = await fetchHealth();
    const stats = await fetchStats();
    const dashboardStats = await fetchDashboardStats();

    const statusIndicator = $('#server-status .status-indicator');
    const statusText = $('#server-status-text');

    if (health) {
        // Stats cards
        $('#stat-clients').textContent = health.clients || 0;

        // New stats from /api/dashboard/stats
        if (dashboardStats) {
            const leadsEl = $('#stat-leads');
            const salesEl = $('#stat-sales');
            const errorsEl = $('#stat-errors');
            if (leadsEl) leadsEl.textContent = dashboardStats.newLeads || 0;
            if (salesEl) salesEl.textContent = dashboardStats.sales || 0;
            if (errorsEl) errorsEl.textContent = dashboardStats.errors || 0;
        }

        // Server status
        statusIndicator?.classList.add('online');
        statusIndicator?.classList.remove('offline');
        if (statusText) statusText.textContent = 'Online';

        // Env badge
        const badge = $('#env-badge');
        if (badge) {
            const isProd = health.uptime > 0;
            badge.textContent = window.location.hostname === 'localhost' ? 'DEV' : 'PROD';
            badge.style.background = isProd
                ? 'var(--accent-green-subtle)'
                : 'var(--accent-orange-subtle)';
            badge.style.color = isProd
                ? 'var(--accent-green)'
                : 'var(--accent-orange)';
        }
    } else {
        // Offline state
        statusIndicator?.classList.remove('online');
        statusIndicator?.classList.add('offline');
        if (statusText) statusText.textContent = 'Offline';
    }

    // Load dashboard previews
    await loadDashboardClients();
    await loadDashboardActivity();
}

async function fetchDashboardStats() {
    try {
        console.log('[DEBUG] Fetching Stats:', `/api/dashboard/stats${buildDateQS()}`);
        const res = await fetch(`/api/dashboard/stats${buildDateQS()}`);
        if (!res.ok) {
            console.error('[DEBUG] Stats Fetch Failed:', res.status, res.statusText);
            return null;
        }
        const data = await res.json();
        console.log('[DEBUG] Stats Data:', data);
        return data;
    } catch (e) {
        console.error('[DEBUG] Stats Fetch Error:', e);
        return null;
    }
}

function formatUptime(seconds) {
    if (!seconds) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    return `${h}h ${m}m`;
}

async function loadDashboardClients() {
    const [clients, leadCounts] = await Promise.all([
        fetchClients(),
        fetchLeadsCountByClient(),
    ]);
    state.clients = clients;

    const container = $('#dashboard-clients-preview');
    if (!container) return;

    if (clients.length === 0) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Nenhum cliente cadastrado</p>
                <small>Clique em "Gerenciar" para começar</small>
            </div>`;
        return;
    }

    container.innerHTML = '';
    clients.slice(0, 5).forEach(client => {
        const initial = getInitials(client.name);
        const isActive = client.active !== false;
        const count = leadCounts[client.slug] || leadCounts[client.id] || 0;
        const div = document.createElement('div');
        div.className = 'activity-item clickable';
        div.style.cursor = 'pointer';
        div.onclick = () => viewClientLogs(client.slug);
        div.innerHTML = `
            <div class="activity-icon-wrapper" style="background:var(--accent-primary-subtle);color:var(--accent-primary)">
                ${escapeHtml(initial)}
            </div>
            <div class="activity-content">
                <div class="activity-title">${escapeHtml(client.name)}</div>
                <div class="activity-subtitle">${isActive ? '🟢 Ativo' : '🔴 Inativo'} · ${escapeHtml(client.slug)}</div>
            </div>
            <div class="client-leads-count">
                <span class="leads-count-value">${count}</span>
                <span class="leads-count-label">leads ${getPeriodLabel().toLowerCase()}</span>
            </div>
            <div class="activity-arrow">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                     <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>`;
        container.appendChild(div);
    });
}

async function fetchLeadsCountByClient() {
    try {
        const res = await fetch(`/api/dashboard/clients-preview${buildDateQS()}`);
        const data = await res.json();
        // Backend returns array [{slug, name, leadsCount}], convert to map {slug: count}
        if (Array.isArray(data)) {
            const map = {};
            data.forEach(item => { map[item.slug] = item.leadsCount || 0; });
            return map;
        }
        return data;
    } catch {
        return {};
    }
}

window.viewClientLogs = function (clientSlug) {
    navigateTo('logs');
    // Use the client selector dropdown instead of the search input
    const select = document.getElementById('logs-client-select');
    if (select) {
        select.value = clientSlug;
        currentClientFilter = clientSlug;
    }
    const input = document.getElementById('investigation-search');
    if (input) input.value = '';
    if (typeof searchLeads === 'function') searchLeads('');
};

async function loadDashboardActivity() {
    let logs = [];
    try {
        const res = await fetch(`/api/dashboard/activity${buildDateQS()}`);
        logs = await res.json();
        if (!Array.isArray(logs)) logs = [];
    } catch (e) { console.error('Error loading activity:', e); }

    state.activityLog = logs;

    const dashboardContainer = $('#dashboard-activity');
    if (dashboardContainer) {
        if (logs.length === 0) {
            dashboardContainer.innerHTML = `
                <div class="activity-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    <p>Aguardando leads...</p>
                </div>`;
        } else {
            dashboardContainer.innerHTML = '';
            logs.slice(0, 5).forEach(item => {
                dashboardContainer.appendChild(renderLogItem(item));
            });
        }
    }
}

function renderLogItem(log, detailed = false) {
    const div = document.createElement('div');
    div.className = 'activity-item';

    const isFailed = log.result === 'failed' || log.result === 'error';
    const isNewLead = log.event_type === 'new_lead';
    const isUpdate = log.event_type === 'status_update' || log.event_type === 'lead.update';
    const isSale = isUpdate && log.sale_amount && parseFloat(log.sale_amount) > 0;
    const isRecovered = log.status && (log.status.includes('Recuperad') || log.status.includes('não encontrado'));

    const timestamp = new Date(log.timestamp);
    const time = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fullDate = timestamp.toLocaleDateString('pt-BR') + ' ' + time;

    // Clean status display (remove prefix "Processado: " if present)
    const cleanStatus = log.status ? log.status.replace(/^Processado:\s*/, '') : '';

    // Determine badge and icon
    let icon, iconClass, badge;

    if (isFailed) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        iconClass = 'stat-icon-error';
        badge = '<span class="badge-status badge-error">Erro</span>';
    } else if (isSale) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';
        iconClass = 'stat-icon-sale';
        badge = '<span class="badge-status badge-sale">Venda</span>';
    } else if (isRecovered) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>';
        iconClass = 'stat-icon-warning';
        badge = '<span class="badge-status badge-recovered">Recuperado</span>';
    } else if (isUpdate) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>';
        iconClass = 'stat-icon-clients';
        badge = '<span class="badge-status badge-update">Atualizado</span>';
    } else {
        // new_lead + success (default)
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="23" y1="13" x2="17" y2="13"></line><line x1="20" y1="10" x2="20" y2="16"></line></svg>';
        iconClass = 'stat-icon-status';
        badge = '<span class="badge-status badge-new">Novo Lead</span>';
    }

    // Origin badge
    const origin = log.origin || '';
    let originBadge = '';
    if (origin) {
        let originClass = 'badge-origin-default';
        if (origin.toLowerCase().includes('meta')) originClass = 'badge-origin-meta';
        else if (origin.toLowerCase().includes('google')) originClass = 'badge-origin-google';
        else if (origin.toLowerCase().includes('pago')) originClass = 'badge-origin-paid';
        originBadge = `<span class="badge-status ${originClass}">${escapeHtml(origin)}</span>`;
    }

    div.innerHTML = `
        <div class="activity-icon-wrapper ${iconClass}">
            ${icon}
        </div>
        <div class="activity-content">
            <div class="activity-title">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
                    ${escapeHtml((log.name && log.name !== 'Sem nome') ? cleanDisplayName(log.name) : formatPhoneDisplay(log.phone))}
                </span>
                ${badge}
                ${originBadge}
                ${isFailed && log.error_message ? `
                    <span class="error-icon-container" data-tooltip="${escapeHtml(log.error_message)}">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </span>
                ` : ''}
                ${isRecovered ? `
                    <span class="error-icon-container warning" data-tooltip="Lead não encontrado na planilha durante venda. Criado automaticamente.">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-orange)">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </span>
                ` : ''}
            </div>
            <div class="activity-subtitle">
                ${escapeHtml(log.client)} · ${formatPhoneDisplay(log.phone)}${cleanStatus ? ` · ${escapeHtml(cleanStatus)}` : ''}
            </div>
        </div>
        <div class="activity-meta">
            <span class="activity-time">${time}</span>
            ${detailed ? `<span style="font-size:0.7rem;color:var(--text-tertiary);">${fullDate}</span>` : ''}
        </div>
    `;
    return div;
}

function formatPhoneDisplay(phone) {
    if (!phone) return '';
    return phone.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4')
        .replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, '+$1 ($2) $3-$4');
}

// ============================================
// Client Management
// ============================================
async function loadClients() {
    const clients = await fetchClients();
    state.clients = clients;

    const container = refs.clientList;
    if (!container) return;

    if (clients.length === 0) {
        container.innerHTML = `
            <div class="card" style="grid-column:1/-1">
                <div class="activity-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    <p>Nenhum cliente cadastrado ainda</p>
                    <small>Clique em "Novo Cliente" para adicionar seu primeiro cliente</small>
                </div>
            </div>`;
        return;
    }

    container.innerHTML = '';
    clients.forEach(client => {
        const initial = getInitials(client.name);
        const isActive = client.active !== false;
        const instanceShort = client.tintim_instance_id
            ? client.tintim_instance_id.substring(0, 12) + '...'
            : 'Não configurado';
        const sheetShort = client.spreadsheet_id
            ? client.spreadsheet_id.substring(0, 16) + '...'
            : 'Não configurado';

        const card = document.createElement('div');
        card.className = 'client-card';
        card.innerHTML = `
            <div class="client-card-header">
                <div class="client-name-group">
                    <div class="client-avatar">${escapeHtml(initial)}</div>
                    <div>
                        <div class="client-name">${escapeHtml(client.name)}</div>
                        <span style="font-size:0.75rem;color:var(--text-tertiary);">${escapeHtml(client.slug)}</span>
                    </div>
                </div>
                <span class="client-status ${isActive ? 'active' : 'inactive'}">
                    <span class="status-indicator ${isActive ? 'online' : 'offline'}" style="width:6px;height:6px;"></span>
                    ${isActive ? 'Ativo' : 'Inativo'}
                </span>
            </div>
            <div class="client-meta">
                <div class="client-meta-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    Instance: <code>${escapeHtml(instanceShort)}</code>
                </div>
                <div class="client-meta-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                    Planilha: <code>${escapeHtml(sheetShort)}</code>
                </div>
                <div class="client-meta-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    Aba: <code>${escapeHtml(client.sheet_name || 'auto')}</code>
                </div>
            </div>
            <div class="client-card-footer">
                <div style="flex:1"></div>
                <button class="btn-text" onclick="handleEditClient('${escapeHtml(client.slug)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Editar
                </button>
                <button class="btn-client-delete" onclick="handleDeleteClient('${escapeHtml(client.id)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Remover
                </button>
            </div>`;
        container.appendChild(card);
    });
}

async function handleDeleteClient(id) {
    if (!confirm(`Tem certeza que deseja remover o cliente "${id}"?`)) return;
    try {
        await removeClient(id);
        showToast('Cliente removido com sucesso', 'success');
        loadClients();
        updateDashboard();
    } catch (err) {
        showToast('Erro ao remover cliente', 'error');
    }
}

// ============================================
// Modal
// ============================================
function openModal() {
    refs.modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
        const firstInput = refs.modal.querySelector('input');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeModal() {
    refs.modal.classList.remove('visible');
    document.body.style.overflow = '';
    refs.clientForm.reset();
}

$('#btn-add-client')?.addEventListener('click', openModal);

// Close modal on backdrop click
refs.modal?.addEventListener('click', (e) => {
    if (e.target === refs.modal) closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && refs.modal.classList.contains('visible')) {
        closeModal();
    }
});

// Form submit
// Form submit
refs.clientForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const clientData = {
        id: $('#client-id').value.trim(),
        name: $('#client-name').value.trim(),
        tintim_instance_id: $('#client-instance').value.trim(),
        spreadsheet_id: $('#client-sheet').value.trim(),
        sheet_name: 'auto',
        active: true,
    };

    try {
        if (refs.modal.dataset.mode === 'edit') {
            await updateClient(clientData);
            showToast(`Cliente "${clientData.name}" atualizado!`, 'success');
        } else {
            await addClient(clientData);
            showToast(`Cliente "${clientData.name}" adicionado!`, 'success');
        }
        closeModal();
        loadClients();
        if (state.currentSection === 'client-details' && currentDetailClientId === clientData.id) {
            // Reload details if currently viewing them
            loadClientDetails(clientData.id);
        }
        updateDashboard();
    } catch (err) {
        showToast(err.message || 'Erro ao salvar cliente', 'error');
    }
});

async function updateClient(clientData) {
    const res = await fetch(`/admin/clients/${clientData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao atualizar cliente');
    return data;
}

// ============================================
// Settings
// ============================================
async function loadSettings() {
    // Carregar webhook URL do backend (Supabase)
    try {
        const res = await fetch('/admin/settings/webhook-url');
        const data = await res.json();
        const webhookInput = $('#settings-webhook-input');
        const dashboardUrl = $('#webhook-url');
        if (webhookInput) webhookInput.value = data.webhook_url || '';
        if (dashboardUrl) dashboardUrl.textContent = data.webhook_url || '';
    } catch {
        const webhookInput = $('#settings-webhook-input');
        const fallback = `${window.location.origin}/webhook/tintim`;
        if (webhookInput) webhookInput.value = fallback;
    }

    // Porta
    const port = window.location.port || '80';
    const portEl = $('#settings-port');
    if (portEl) portEl.textContent = port;

    // Ambiente
    const envEl = $('#settings-env');
    if (envEl) envEl.textContent = window.location.hostname === 'localhost' ? 'Development' : 'Production';

    // Fonte de dados
    try {
        const res = await fetch('/admin/status');
        const stats = await res.json();
        const badge = $('#datasource-badge');
        if (badge) {
            const isPg = stats.dataSource === 'postgresql';
            badge.textContent = isPg ? '🐘 PostgreSQL' : '📁 Local (JSON)';
            badge.style.background = isPg ? 'var(--accent-green-subtle)' : 'var(--accent-orange-subtle)';
            badge.style.color = isPg ? 'var(--accent-green)' : 'var(--accent-orange)';
        }
    } catch { /* silêncio */ }
}

// Salvar webhook URL
$('#btn-save-webhook')?.addEventListener('click', async () => {
    const input = $('#settings-webhook-input');
    const url = input?.value?.trim();
    if (!url) {
        showToast('Digite uma URL válida', 'error');
        return;
    }

    try {
        const res = await fetch('/admin/settings/webhook-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook_url: url }),
        });
        const data = await res.json();
        if (data.success) {
            showToast('Webhook URL salva com sucesso!', 'success');
            // Atualizar no dashboard também
            const dashboardUrl = $('#webhook-url');
            if (dashboardUrl) dashboardUrl.textContent = url;
        } else {
            showToast(data.error || 'Erro ao salvar URL', 'error');
        }
    } catch {
        showToast('Erro de conexão ao salvar URL', 'error');
    }
});

// Copiar webhook URL (settings)
$('#btn-copy-webhook-settings')?.addEventListener('click', () => {
    const input = $('#settings-webhook-input');
    const url = input?.value?.trim();
    if (url) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('URL copiada!', 'success');
        });
    }
});

$('#btn-clear-cache')?.addEventListener('click', async () => {
    const ok = await reloadSystem();
    showToast(ok ? 'Cache limpo com sucesso!' : 'Erro ao limpar cache', ok ? 'success' : 'error');
});

$('#btn-reload-config')?.addEventListener('click', async () => {
    const ok = await reloadSystem();
    showToast(ok ? 'Configurações recarregadas!' : 'Erro ao recarregar', ok ? 'success' : 'error');
    if (ok) {
        loadClients();
        updateDashboard();
    }
});

$('#btn-reload-system')?.addEventListener('click', async () => {
    const ok = await reloadSystem();
    showToast(ok ? 'Sistema recarregado!' : 'Erro ao recarregar', ok ? 'success' : 'error');
    if (ok) updateDashboard();
});

// ============================================
// Copy Webhook URL (Dashboard)
// ============================================
$('#btn-copy-webhook')?.addEventListener('click', () => {
    const url = $('#webhook-url').textContent;
    navigator.clipboard.writeText(url).then(() => {
        const btn = $('#btn-copy-webhook');
        btn.classList.add('copied');
        btn.querySelector('span').textContent = 'Copiado!';
        showToast('URL copiada para a área de transferência', 'success');
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.querySelector('span').textContent = 'Copiar';
        }, 2000);
    });
});

// ============================================
// Toast System
// ============================================
function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
    };

    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============================================
// Keyboard Shortcuts
// ============================================
document.addEventListener('keydown', (e) => {
    // Skip if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Skip if modal is open
    if (refs.modal.classList.contains('visible')) return;

    switch (e.key) {
        case '1': navigateTo('dashboard'); break;
        case '2': navigateTo('clients'); break;
        case '3': navigateTo('logs'); break;
        case '4': navigateTo('sdr'); break;
        case '5': navigateTo('calculadora'); break;
        case '6': navigateTo('settings'); break;
        case 'n':
        case 'N':
            navigateTo('clients');
            setTimeout(openModal, 200);
            break;
    }
});

// ============================================
// Utilities
// ============================================
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function cleanDisplayName(name) {
    if (!name) return name;
    return name.replace(/\s*\(Auto\)\s*/gi, '').trim();
}

// ============================================
// Initialization
// ============================================
async function init() {
    // 0. Auth Guard
    if (window.authService) {
        const user = await window.authService.checkAuth();
        if (!user) return; // Will redirect
    }

    // Setup Logout (Immediately interactive)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm('Deseja realmente sair?')) {
                await window.authService.logout();
            }
        });
    }

    // 1. Initial Navigation (Routing)
    const initialSection = getSectionFromUrl();
    // Use replace=true to correctly set the initial history state without pushing a new entry
    navigateTo(initialSection, true);

    // 2. Load Data
    await loadSettings();
    updateDashboard();

    // Auto-refresh every 30s
    setInterval(updateDashboard, 30000);

    // 3. Setup Listeners
    setupInvestigationListeners();
    setupPeriodSelector();
    updatePeriodLabels();
}

init();

// ============================================
// Client Details View
// ============================================
let currentDetailClientId = null;

async function navigateToClientDetails(clientId) {
    // Redirect to logs filtered by this client
    if (typeof viewClientLogs === 'function') {
        viewClientLogs(clientId);
    } else {
        console.error('viewClientLogs function not found');
    }
}


// ============================================
// Investigation & Search
// ============================================

const btnInvestigate = $('#btn-investigate');
const inputInvestigate = $('#investigation-search');

// Current log source and filter state
let currentLogSource = 'logs';
let currentLogFilter = 'all';
let currentClientFilter = '';
let lastSearchResults = [];

function setupInvestigationListeners() {
    const btn = $('#btn-investigate');
    const input = $('#investigation-search');

    if (btn && input) {
        const doSearch = () => {
            const term = input.value.trim();
            searchLeads(term);
        };

        btn.onclick = doSearch;
        input.onkeypress = (e) => {
            if (e.key === 'Enter') doSearch();
        };
    }

    // Toggle: Leads Processados / Eventos Raw
    const toggleBtns = $$('#logs-source-toggle .toggle-btn');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLogSource = btn.dataset.source;
            const input = $('#investigation-search');
            searchLeads(input ? input.value.trim() : '');
        });
    });

    // Filters: Todos / Erros / Vendas / Novos Leads
    const filterChips = $$('#logs-filters .filter-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentLogFilter = chip.dataset.filter;
            applyFilterToResults();
        });
    });

    // Client selector
    const clientSelect = $('#logs-client-select');
    if (clientSelect) {
        populateClientSelect();
        clientSelect.addEventListener('change', () => {
            currentClientFilter = clientSelect.value;
            const input = $('#investigation-search');
            searchLeads(input ? input.value.trim() : '');
        });
    }
}

// Call immediately in case elements exist
setupInvestigationListeners();

async function populateClientSelect() {
    const select = $('#logs-client-select');
    if (!select) return;
    const clients = await fetchClients();
    // Keep "Todos os clientes" as first option, clear dynamic options
    select.innerHTML = '<option value="">Todos os clientes</option>';
    clients.forEach(client => {
        const opt = document.createElement('option');
        opt.value = client.slug;
        opt.textContent = client.name;
        select.appendChild(opt);
    });
    // Restore current selection if any
    if (currentClientFilter) {
        select.value = currentClientFilter;
    }
}

async function searchLeads(query) {
    const container = $('#investigation-results');
    if (!container) return;

    container.innerHTML = `
        <div class="activity-empty">
            <p>Buscando...</p>
        </div>`;

    try {
        const sourceParam = currentLogSource === 'all' ? '&source=all' : '';
        const dateQS = buildDateQS().replace('?', '&');
        const searchQuery = currentClientFilter && !query ? currentClientFilter : (currentClientFilter && query ? `${currentClientFilter} ${query}` : query);
        const res = await fetch(`/api/dashboard/investigate?q=${encodeURIComponent(searchQuery || '')}${sourceParam}${dateQS}`);
        const results = await res.json();
        lastSearchResults = results;
        applyFilterToResults();
    } catch (err) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Erro na busca</p>
                <small>${err.message}</small>
            </div>`;
    }
}

function applyFilterToResults() {
    let filtered = lastSearchResults;

    if (currentLogFilter === 'errors') {
        filtered = filtered.filter(item => item.result === 'failed' || item.result === 'error');
    } else if (currentLogFilter === 'sales') {
        filtered = filtered.filter(item =>
            (item.sale_amount && parseFloat(item.sale_amount) > 0) ||
            (item.status && item.status.toLowerCase().includes('vend'))
        );
    } else if (currentLogFilter === 'new_leads') {
        filtered = filtered.filter(item => item.event_type === 'new_lead');
    }

    renderInvestigationResults(filtered);
}

function renderInvestigationResults(results) {
    const container = $('#investigation-results');
    if (!container) return;

    // Update count
    const countEl = $('#results-count');
    if (countEl) countEl.textContent = results && results.length ? `${results.length} resultado${results.length !== 1 ? 's' : ''}` : '';

    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Nenhum resultado encontrado</p>
                <small>Tente outro termo ou filtro</small>
            </div>`;
        return;
    }

    // If source=all (raw mode), use old-style rendering with payload
    if (currentLogSource === 'all') {
        renderRawResults(container, results);
        return;
    }

    // Clean mode (leads_log only)
    container.innerHTML = '';
    results.forEach(item => {
        container.appendChild(renderLogItem(item, true));
    });
}

function renderRawResults(container, results) {
    container.innerHTML = '';
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'activity-item';

        const timestamp = new Date(item.timestamp).toLocaleString('pt-BR');
        const isError = item.status && (item.status.toLowerCase().includes('erro') || item.result === 'failed');
        const typeLabel = item.type === 'event' ? 'Webhook' : 'Lead Log';

        let badgeClass = 'badge-status';
        let iconClass = 'stat-icon-webhook';

        if (isError) {
            badgeClass += ' badge-error';
            iconClass = 'stat-icon-error';
        } else if (item.type === 'log') {
            badgeClass += ' badge-new';
            iconClass = 'stat-icon-status';
        } else {
            badgeClass += ' badge-update';
        }

        const displayStatus = item.status ? item.status.replace(/^Processado:\s*/, '') : typeLabel;

        let payloadId = `payload-${item.id}`;

        div.innerHTML = `
            <div class="activity-icon-wrapper ${iconClass}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>
            <div class="activity-content" style="width:100%">
                <div class="activity-title" style="display:flex;justify-content:space-between;align-items:center">
                    <span>${escapeHtml(cleanDisplayName(item.name) || formatPhoneDisplay(item.phone) || 'Sem telefone')}</span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <span style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:var(--bg-surface);color:var(--text-tertiary);text-transform:uppercase;font-weight:600;">${typeLabel}</span>
                        <span class="${badgeClass}">${escapeHtml(displayStatus)}</span>
                    </div>
                </div>
                <div class="activity-subtitle">
                    ${escapeHtml(item.client)} · ${timestamp}
                </div>
                <div style="margin-top:8px;">
                     <button class="btn-text btn-sm" onclick="togglePayload('${payloadId}')">
                        Ver Payload
                    </button>
                    <div id="${payloadId}" class="payload-preview" style="display:none; margin-top: 8px;">
                        <pre style="color: var(--text-primary); background: var(--bg-primary); padding: 10px; border-radius: 6px; overflow-x: auto; font-size:0.75rem; border: 1px solid var(--border-subtle);">${escapeHtml(JSON.stringify(item.payload, null, 2))}</pre>
                    </div>
                </div>
            </div>`;
        container.appendChild(div);
    });
}

function togglePayload(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
}

async function loadRecentErrors() {
    navigateTo('logs');
    // Set filter to errors and trigger search
    currentLogFilter = 'errors';
    const filterChips = $$('#logs-filters .filter-chip');
    filterChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'errors'));
    searchLeads('');
}
window.loadRecentErrors = loadRecentErrors;

document.getElementById('btn-refresh-client-logs')?.addEventListener('click', () => {
    if (currentDetailClientId) loadClientDetails(currentDetailClientId);
});

async function loadClientDetails(clientId) {
    const container = document.getElementById('client-logs-stream');
    const titleEl = document.getElementById('client-details-title');
    const subtitleEl = document.getElementById('client-details-subtitle');

    if (!container) return;

    container.innerHTML = '<div class="activity-empty"><p>Carregando logs...</p></div>';

    // Set loading state in header
    if (titleEl) titleEl.textContent = 'Carregando...';

    try {
        const res = await fetch(`/api/dashboard/client/${clientId}/logs`);
        const data = await res.json();

        if (titleEl) titleEl.textContent = data.clientName || clientId;
        if (subtitleEl) subtitleEl.textContent = `ID: ${clientId} • ${data.logs ? data.logs.length : 0} logs encontrados`;

        const logs = data.logs || [];

        container.innerHTML = '';
        if (logs.length === 0) {
            container.innerHTML = `
                <div class="activity-empty">
                    <p>Nenhum log encontrado para este cliente.</p>
                </div>`;
            return;
        }

        let currentDate = '';
        logs.forEach(log => {
            // Group by date logic
            const logDate = new Date(log.timestamp).toLocaleDateString('pt-BR');
            if (logDate !== currentDate) {
                const dateHeader = document.createElement('div');
                dateHeader.className = 'activity-date-header';
                dateHeader.innerText = logDate;
                dateHeader.style.padding = '12px 24px';
                dateHeader.style.fontSize = '0.75rem';
                dateHeader.style.fontWeight = '600';
                dateHeader.style.color = 'var(--text-tertiary)';
                dateHeader.style.background = 'var(--bg-elevated)';
                dateHeader.style.borderBottom = '1px solid var(--border-subtle)';
                container.appendChild(dateHeader);
                currentDate = logDate;
            }
            container.appendChild(renderLogItem(log, true));
        });

    } catch (error) {
        console.error('Erro ao carregar detalhes:', error);
        container.innerHTML = `
            <div class="activity-empty">
                <p style="color:var(--accent-red)">Erro ao carregar dados.</p>
            </div>`;
    }
}

// ============================================
// Client Edit Logic
// ============================================

window.handleEditClient = async function (clientId) {
    // Find client data
    const client = state.clients.find(c => c.id === clientId);
    if (!client) {
        showToast('Cliente não encontrado nos dados locais', 'error');
        return;
    }
    openModalForEdit(client);
};

document.getElementById('btn-edit-client')?.addEventListener('click', async () => {
    if (!currentDetailClientId) return;
    await window.handleEditClient(currentDetailClientId);
});

function openModalForEdit(client) {
    // Populate fields
    $('#client-id').value = client.id;
    $('#client-id').disabled = true; // Cannot change ID
    $('#client-name').value = client.name;
    $('#client-instance').value = client.tintim_instance_id;
    $('#client-sheet').value = client.spreadsheet_id;

    // Change UI to "Edit" mode
    const title = refs.modal.querySelector('h3');
    if (title) title.textContent = 'Editar Cliente';
    const btn = refs.modal.querySelector('button[type="submit"]');
    if (btn) btn.textContent = 'Salvar Alterações';

    // Set a flag or dataset to know we are editing
    refs.modal.dataset.mode = 'edit';

    openModal();
}

// Override openModal to reset to "Add" mode by default if not editing
const originalOpenModal = openModal;
openModal = function () {
    if (!refs.modal.dataset.mode) {
        // Reset to "Add" mode
        $('#client-id').value = '';
        $('#client-id').disabled = false;
        $('#client-name').value = '';
        $('#client-instance').value = '';
        $('#client-sheet').value = '';

        const title = refs.modal.querySelector('h3');
        if (title) title.textContent = 'Novo Cliente';
        const btn = refs.modal.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Adicionar Cliente';
    }
    originalOpenModal();
};

const originalCloseModal = closeModal;
closeModal = function () {
    originalCloseModal();
    // Clear mode after closing
    delete refs.modal.dataset.mode;
};

// ============================================
// SDR de IA Section
// ============================================

const SDR_API_BASE = '/api/sdr';

const sdrState = {
    tenants: [],
    selectedTenantId: null,
    selectedTenant: null,
    activeTab: 'config',
    knowledge: [],
    conversations: [],
    messages: [],
    leads: [],
    selectedConversationId: null,
};

// --- SDR: Load Tenant List ---
async function loadSDRSection() {
    const container = $('#sdr-tenants-list');
    if (!container) return;

    // Ensure we show the list view
    const listView = $('#sdr-list-view');
    const detailView = $('#sdr-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants`);
        if (!res.ok) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>SDR de IA não conectado</p><small>Verifique se o serviço está rodando</small></div></div>`;
            return;
        }
        const tenants = await res.json();
        sdrState.tenants = tenants || [];

        if (sdrState.tenants.length === 0) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <p>Nenhum cliente SDR configurado</p><small>Clique em "Novo Cliente" para começar</small></div></div>`;
            return;
        }

        container.innerHTML = '';
        sdrState.tenants.forEach(tenant => {
            const card = document.createElement('div');
            card.className = 'client-card';
            const initial = getInitials(tenant.name);
            card.innerHTML = `
                <div class="client-card-header">
                    <div class="client-name-group">
                        <div class="client-avatar" style="background: linear-gradient(135deg, #06b6d4, #0891b2);">${escapeHtml(initial)}</div>
                        <div>
                            <div class="client-name">${escapeHtml(tenant.name)}</div>
                            <span style="font-size:0.75rem;color:var(--text-tertiary);">${escapeHtml(tenant.slug)} · ${escapeHtml(tenant.niche || 'Geral')}</span>
                        </div>
                    </div>
                    <span class="client-status ${tenant.active !== false ? 'active' : 'inactive'}">
                        <span class="status-indicator ${tenant.active !== false ? 'online' : 'offline'}" style="width:6px;height:6px;"></span>
                        ${tenant.active !== false ? 'Ativo' : 'Inativo'}
                    </span>
                </div>
                <div class="client-meta">
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        Modelo: <code>${escapeHtml(tenant.llm_model || 'gpt-4o-mini')}</code>
                    </div>
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>
                        Horário: <code>${escapeHtml(tenant.business_hours_start || '08:00')} — ${escapeHtml(tenant.business_hours_end || '18:00')}</code>
                    </div>
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3 5.18 2 2 0 0 1 5.09 3h3"></path></svg>
                        WhatsApp: <code>${escapeHtml(tenant.whatsapp_number || 'Não configurado')}</code>
                    </div>
                </div>
                <div class="client-card-footer">
                    <div style="flex:1"></div>
                    <button class="btn-text" onclick="handleEditSdrTenant('${tenant.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        Editar
                    </button>
                    <button class="btn-text" onclick="openSdrDetail('${tenant.id}')" style="color:var(--accent-cyan);">
                        Detalhes →
                    </button>
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Erro ao carregar SDR</p><small>${escapeHtml(err.message)}</small></div></div>`;
    }
}

// --- Evolution API Functions ---
let evolutionPollingInterval = null;

async function fetchEvolutionInstances() {
    try {
        const res = await fetch(`${SDR_API_BASE}/evolution/instances`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function createEvolutionInstance(name) {
    const res = await fetch(`${SDR_API_BASE}/evolution/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: name }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao criar instância');
    }
    return await res.json();
}

async function getInstanceStatus(name) {
    try {
        const res = await fetch(`${SDR_API_BASE}/evolution/instances/${encodeURIComponent(name)}/status`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function getInstanceQRCode(name) {
    try {
        const res = await fetch(`${SDR_API_BASE}/evolution/instances/${encodeURIComponent(name)}/qrcode`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function deleteEvolutionInstance(name) {
    const res = await fetch(`${SDR_API_BASE}/evolution/instances/${encodeURIComponent(name)}`, {
        method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao deletar instância');
    }
}

async function loadEvolutionInstancesSelect(selectedValue) {
    const select = $('#sdr-tenant-evolution');
    if (!select) return;

    select.innerHTML = '<option value="">Carregando...</option>';
    const instances = await fetchEvolutionInstances();

    if (instances.length === 0) {
        select.innerHTML = '<option value="">— Nenhuma instância (Evolution offline?) —</option>';
        // Allow manual typing: if there's a saved value, add it as option
        if (selectedValue) {
            const opt = document.createElement('option');
            opt.value = selectedValue;
            opt.textContent = `${selectedValue} (salvo)`;
            select.appendChild(opt);
            select.value = selectedValue;
        }
        return;
    }

    select.innerHTML = '<option value="">— Selecione uma instância —</option>';
    instances.forEach(inst => {
        const name = inst.instance?.instanceName || inst.instanceName || inst.name || '';
        if (!name) return;
        const state = inst.instance?.status || inst.state || '';
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name}${state ? ` (${state})` : ''}`;
        select.appendChild(opt);
    });

    if (selectedValue) {
        // If saved value is not in the list, add it
        if (!select.querySelector(`option[value="${CSS.escape(selectedValue)}"]`)) {
            const opt = document.createElement('option');
            opt.value = selectedValue;
            opt.textContent = `${selectedValue} (salvo)`;
            select.appendChild(opt);
        }
        select.value = selectedValue;
    }
}

function stopEvolutionPolling() {
    if (evolutionPollingInterval) {
        clearInterval(evolutionPollingInterval);
        evolutionPollingInterval = null;
    }
}

function startEvolutionPolling(instanceName) {
    stopEvolutionPolling();

    const badge = $('#evolution-connection-badge');
    const qrImg = $('#evolution-qr-img');
    const qrArea = $('#evolution-qr-area');

    evolutionPollingInterval = setInterval(async () => {
        const status = await getInstanceStatus(instanceName);
        if (!status) return;

        const state = status.instance?.state || status.state || '';
        if (state === 'open' || state === 'connected') {
            stopEvolutionPolling();
            if (badge) {
                badge.textContent = 'Conectado';
                badge.style.background = 'var(--accent-green-subtle)';
                badge.style.color = 'var(--accent-green)';
            }
            if (qrImg) qrImg.style.display = 'none';
            const loading = $('#evolution-qr-loading');
            if (loading) loading.innerHTML = '<span style="color:var(--accent-green);font-weight:600;">WhatsApp Conectado!</span>';

            // Auto-select in dropdown
            const select = $('#sdr-tenant-evolution');
            if (select) select.value = instanceName;

            showToast('WhatsApp conectado com sucesso!', 'success');
        }
    }, 5000);
}

async function showEvolutionQRCode(instanceName) {
    const qrArea = $('#evolution-qr-area');
    const qrImg = $('#evolution-qr-img');
    const qrLoading = $('#evolution-qr-loading');
    const badge = $('#evolution-connection-badge');

    if (qrArea) qrArea.style.display = '';
    if (qrImg) qrImg.style.display = 'none';
    if (qrLoading) {
        qrLoading.style.display = 'flex';
        qrLoading.textContent = 'Gerando QR Code...';
    }
    if (badge) {
        badge.textContent = 'Aguardando leitura...';
        badge.style.background = 'var(--accent-orange-subtle)';
        badge.style.color = 'var(--accent-orange)';
    }

    const result = await getInstanceQRCode(instanceName);

    if (result) {
        const base64 = result.base64 || result.qrcode?.base64 || '';
        if (base64) {
            const src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
            if (qrImg) {
                qrImg.src = src;
                qrImg.style.display = '';
            }
            if (qrLoading) qrLoading.style.display = 'none';
        } else {
            if (qrLoading) qrLoading.textContent = 'QR Code não disponível. A instância pode já estar conectada.';
        }
    } else {
        if (qrLoading) qrLoading.textContent = 'Erro ao gerar QR Code';
    }

    startEvolutionPolling(instanceName);
}

// Event: Create new instance
$('#btn-create-evolution-instance')?.addEventListener('click', async () => {
    const nameInput = $('#evolution-new-name');
    const name = nameInput?.value?.trim();
    if (!name) {
        showToast('Digite um nome para a instância', 'error');
        return;
    }

    try {
        showToast('Criando instância...', 'info');
        await createEvolutionInstance(name);
        showToast(`Instância "${name}" criada!`, 'success');

        // Reload select and auto-select
        await loadEvolutionInstancesSelect(name);

        // Show QR code
        await showEvolutionQRCode(name);
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// Event: Refresh instances
$('#btn-refresh-instances')?.addEventListener('click', () => {
    const current = $('#sdr-tenant-evolution')?.value;
    loadEvolutionInstancesSelect(current);
});

// --- SDR: Modal CRUD ---
function openSdrModal(tenant = null) {
    const modal = $('#modal-sdr-tenant');
    const title = $('#sdr-modal-title');
    const submitBtn = $('#sdr-modal-submit-btn span');

    // Reset QR area
    const qrArea = $('#evolution-qr-area');
    if (qrArea) qrArea.style.display = 'none';
    stopEvolutionPolling();

    if (tenant) {
        title.textContent = 'Editar Cliente SDR';
        submitBtn.textContent = 'Salvar Alterações';
        $('#sdr-tenant-id').value = tenant.id;
        $('#sdr-tenant-name').value = tenant.name || '';
        $('#sdr-tenant-slug').value = tenant.slug || '';
        $('#sdr-tenant-slug').disabled = true;
        $('#sdr-tenant-niche').value = tenant.niche || '';
        $('#sdr-tenant-tone').value = tenant.tone || 'profissional';
        $('#sdr-tenant-whatsapp').value = tenant.whatsapp_number || '';
        $('#sdr-tenant-model').value = tenant.llm_model || 'gpt-4o-mini';
        $('#sdr-tenant-tokens').value = tenant.max_tokens_per_response || tenant.max_tokens || 500;
        $('#sdr-tenant-hours-start').value = tenant.business_hours_start || '08:00';
        $('#sdr-tenant-hours-end').value = tenant.business_hours_end || '18:00';
        $('#sdr-tenant-days').value = tenant.business_days || '1,2,3,4,5';
        $('#sdr-tenant-prompt').value = tenant.system_prompt || '';
        $('#sdr-tenant-ooh-msg').value = tenant.out_of_hours_message || '';
        // Load instances select and set current value
        loadEvolutionInstancesSelect(tenant.evolution_instance_id || '');
    } else {
        title.textContent = 'Novo Cliente SDR';
        submitBtn.textContent = 'Salvar Cliente';
        $('#form-sdr-tenant').reset();
        $('#sdr-tenant-id').value = '';
        $('#sdr-tenant-slug').disabled = false;
        $('#sdr-tenant-tokens').value = 500;
        $('#sdr-tenant-hours-start').value = '08:00';
        $('#sdr-tenant-hours-end').value = '18:00';
        $('#sdr-tenant-days').value = '1,2,3,4,5';
        // Load instances select
        loadEvolutionInstancesSelect('');
    }

    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeSdrModal() {
    const modal = $('#modal-sdr-tenant');
    modal.classList.remove('visible');
    document.body.style.overflow = '';
    $('#sdr-tenant-slug').disabled = false;
    stopEvolutionPolling();
}

$('#btn-add-sdr-tenant')?.addEventListener('click', () => openSdrModal());

$('#modal-sdr-tenant')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSdrModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal-sdr-tenant')?.classList.contains('visible')) {
        closeSdrModal();
    }
});

$('#form-sdr-tenant')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = $('#sdr-tenant-id').value;
    const data = {
        name: $('#sdr-tenant-name').value.trim(),
        slug: $('#sdr-tenant-slug').value.trim(),
        niche: $('#sdr-tenant-niche').value.trim(),
        tone: $('#sdr-tenant-tone').value,
        whatsapp_number: $('#sdr-tenant-whatsapp').value.trim(),
        evolution_instance_id: $('#sdr-tenant-evolution').value.trim(),
        llm_model: $('#sdr-tenant-model').value,
        max_tokens_per_response: parseInt($('#sdr-tenant-tokens').value) || 500,
        business_hours_start: $('#sdr-tenant-hours-start').value,
        business_hours_end: $('#sdr-tenant-hours-end').value,
        business_days: $('#sdr-tenant-days').value.trim(),
        system_prompt: $('#sdr-tenant-prompt').value.trim(),
        out_of_hours_message: $('#sdr-tenant-ooh-msg').value.trim(),
    };

    try {
        let res;
        if (id) {
            res = await fetch(`${SDR_API_BASE}/tenants/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        } else {
            res = await fetch(`${SDR_API_BASE}/tenants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        }

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao salvar');
        }

        showToast(id ? 'Cliente atualizado!' : 'Cliente criado!', 'success');
        closeSdrModal();
        loadSDRSection();

        // If we're viewing this tenant's details, reload them
        if (sdrState.selectedTenantId === id) {
            openSdrDetail(id);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

window.handleEditSdrTenant = function (tenantId) {
    const tenant = sdrState.tenants.find(t => t.id === tenantId || String(t.id) === String(tenantId));
    if (!tenant) {
        showToast('Cliente não encontrado', 'error');
        return;
    }
    openSdrModal(tenant);
};

// --- SDR: Detail Panel ---
window.openSdrDetail = async function (tenantId) {
    const tenant = sdrState.tenants.find(t => t.id === tenantId || String(t.id) === String(tenantId));
    if (!tenant) {
        showToast('Cliente não encontrado', 'error');
        return;
    }

    sdrState.selectedTenantId = tenantId;
    sdrState.selectedTenant = tenant;

    // Toggle views
    const listView = $('#sdr-list-view');
    const detailView = $('#sdr-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    // Set header
    $('#sdr-detail-title').textContent = tenant.name;
    $('#sdr-detail-subtitle').textContent = `${tenant.slug} · ${tenant.niche || 'Geral'}`;

    // Load stats
    loadSdrStats(tenantId);

    // Setup tabs
    switchSdrTab('config');
    renderSdrConfig(tenant);
};

$('#btn-sdr-back')?.addEventListener('click', () => {
    closeSdrDetail();
});

$('#btn-sdr-edit-detail')?.addEventListener('click', () => {
    if (sdrState.selectedTenant) {
        openSdrModal(sdrState.selectedTenant);
    }
});

function closeSdrDetail() {
    sdrState.selectedTenantId = null;
    sdrState.selectedTenant = null;
    if (waDetailPollingInterval) {
        clearInterval(waDetailPollingInterval);
        waDetailPollingInterval = null;
    }
    const listView = $('#sdr-list-view');
    const detailView = $('#sdr-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';
    loadSDRSection();
}

// --- SDR: Tabs ---
$$('.sdr-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchSdrTab(tab.dataset.tab);
    });
});

function switchSdrTab(tabName) {
    sdrState.activeTab = tabName;

    $$('.sdr-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    $$('.sdr-tab-content').forEach(c => c.classList.toggle('active', c.id === `sdr-tab-${tabName}`));

    const tenantId = sdrState.selectedTenantId;
    if (!tenantId) return;

    if (tabName === 'config') renderSdrConfig(sdrState.selectedTenant);
    if (tabName === 'whatsapp') loadSdrWhatsAppStatus(sdrState.selectedTenant);
    if (tabName === 'knowledge') loadSdrKnowledge(tenantId);
    if (tabName === 'conversations') loadSdrConversations(tenantId);
    if (tabName === 'leads') loadSdrLeads(tenantId);
}

// --- SDR: Stats ---
async function loadSdrStats(tenantId) {
    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}/stats`);
        if (!res.ok) return;
        const stats = await res.json();
        $('#sdr-stat-conversations').textContent = stats.conversations || 0;
        $('#sdr-stat-messages').textContent = stats.messages || 0;
        $('#sdr-stat-leads').textContent = stats.leads || 0;
        $('#sdr-stat-tokens').textContent = stats.tokens_used ? stats.tokens_used.toLocaleString() : '0';
    } catch { /* silent */ }
}

// --- SDR: WhatsApp Tab ---
let waDetailPollingInterval = null;

async function loadSdrWhatsAppStatus(tenant) {
    if (!tenant) return;

    const instanceName = tenant.evolution_instance_id;
    const instanceEl = $('#wa-detail-instance');
    const badge = $('#wa-detail-status-badge');
    const reconnectBtn = $('#btn-whatsapp-reconnect');
    const qrArea = $('#wa-detail-qr-area');

    // Stop any previous polling
    if (waDetailPollingInterval) {
        clearInterval(waDetailPollingInterval);
        waDetailPollingInterval = null;
    }

    if (instanceEl) instanceEl.textContent = instanceName || 'Não configurado';
    if (qrArea) qrArea.style.display = 'none';

    if (!instanceName) {
        if (badge) {
            badge.textContent = 'Sem instância';
            badge.style.background = 'var(--accent-orange-subtle)';
            badge.style.color = 'var(--accent-orange)';
        }
        if (reconnectBtn) reconnectBtn.style.display = 'none';
        return;
    }

    if (badge) {
        badge.textContent = 'Verificando...';
        badge.style.background = 'var(--bg-surface)';
        badge.style.color = 'var(--text-secondary)';
    }

    const status = await getInstanceStatus(instanceName);
    const state = status?.instance?.state || status?.state || 'unknown';

    if (state === 'open' || state === 'connected') {
        if (badge) {
            badge.textContent = 'Conectado';
            badge.style.background = 'var(--accent-green-subtle)';
            badge.style.color = 'var(--accent-green)';
        }
        if (reconnectBtn) reconnectBtn.style.display = 'none';
    } else {
        if (badge) {
            badge.textContent = state === 'close' ? 'Desconectado' : (state || 'Desconhecido');
            badge.style.background = 'var(--accent-red-subtle, #fef2f2)';
            badge.style.color = 'var(--accent-red, #ef4444)';
        }
        if (reconnectBtn) reconnectBtn.style.display = '';
    }
}

$('#btn-whatsapp-refresh-status')?.addEventListener('click', () => {
    if (sdrState.selectedTenant) loadSdrWhatsAppStatus(sdrState.selectedTenant);
});

$('#btn-whatsapp-reconnect')?.addEventListener('click', async () => {
    const tenant = sdrState.selectedTenant;
    if (!tenant?.evolution_instance_id) return;

    const instanceName = tenant.evolution_instance_id;
    const qrArea = $('#wa-detail-qr-area');
    const qrImg = $('#wa-detail-qr-img');
    const badge = $('#wa-detail-status-badge');

    if (badge) {
        badge.textContent = 'Gerando QR Code...';
        badge.style.background = 'var(--accent-orange-subtle)';
        badge.style.color = 'var(--accent-orange)';
    }

    const result = await getInstanceQRCode(instanceName);

    if (result) {
        const base64 = result.base64 || result.qrcode?.base64 || '';
        if (base64 && qrImg && qrArea) {
            qrImg.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
            qrArea.style.display = '';

            if (badge) {
                badge.textContent = 'Aguardando leitura...';
            }

            // Poll for connection
            waDetailPollingInterval = setInterval(async () => {
                const status = await getInstanceStatus(instanceName);
                const state = status?.instance?.state || status?.state || '';
                if (state === 'open' || state === 'connected') {
                    clearInterval(waDetailPollingInterval);
                    waDetailPollingInterval = null;
                    if (qrArea) qrArea.style.display = 'none';
                    if (badge) {
                        badge.textContent = 'Conectado';
                        badge.style.background = 'var(--accent-green-subtle)';
                        badge.style.color = 'var(--accent-green)';
                    }
                    const reconnectBtn = $('#btn-whatsapp-reconnect');
                    if (reconnectBtn) reconnectBtn.style.display = 'none';
                    showToast('WhatsApp reconectado!', 'success');
                }
            }, 5000);
        } else {
            if (badge) badge.textContent = 'QR Code não disponível';
        }
    } else {
        if (badge) badge.textContent = 'Erro ao gerar QR Code';
    }
});

// --- SDR: Config Tab ---
function renderSdrConfig(tenant) {
    const container = $('#sdr-config-list');
    if (!container || !tenant) return;

    const fields = [
        ['Nome', tenant.name],
        ['Slug', tenant.slug],
        ['Nicho', tenant.niche || '—'],
        ['Tom', tenant.tone || 'profissional'],
        ['WhatsApp', tenant.whatsapp_number || '—'],
        ['Evolution Instance', tenant.evolution_instance_id || '—'],
        ['Modelo LLM', tenant.llm_model || 'gpt-4o-mini'],
        ['Max Tokens', tenant.max_tokens_per_response || tenant.max_tokens || 500],
        ['Horário', `${tenant.business_hours_start || '08:00'} — ${tenant.business_hours_end || '18:00'}`],
        ['Dias Úteis', tenant.business_days || '1,2,3,4,5'],
        ['System Prompt', tenant.system_prompt || '—'],
        ['Msg Fora do Horário', tenant.out_of_hours_message || '—'],
    ];

    container.innerHTML = fields.map(([label, value]) => `
        <div class="setting-row">
            <span class="setting-label">${escapeHtml(label)}</span>
            <span class="setting-value" style="max-width:60%;text-align:right;word-break:break-word;white-space:pre-wrap;">${escapeHtml(String(value))}</span>
        </div>
    `).join('');
}

// --- SDR: Knowledge Base Tab ---
async function loadSdrKnowledge(tenantId) {
    const container = $('#sdr-kb-list');
    if (!container) return;

    container.innerHTML = '<div class="activity-empty"><p>Carregando...</p></div>';

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}/knowledge`);
        if (!res.ok) throw new Error('Erro ao carregar');
        const docs = await res.json();
        sdrState.knowledge = docs || [];

        if (sdrState.knowledge.length === 0) {
            container.innerHTML = '<div class="activity-empty"><p>Nenhum documento carregado</p><small>Use o botão Upload para adicionar PDFs ou textos</small></div>';
            return;
        }

        // Group by source_file
        const grouped = {};
        sdrState.knowledge.forEach(doc => {
            const key = doc.source_file || doc.source || 'Sem nome';
            if (!grouped[key]) grouped[key] = { chunks: 0, id: doc.id, created: doc.created_at };
            grouped[key].chunks++;
        });

        container.innerHTML = '';
        Object.entries(grouped).forEach(([filename, info]) => {
            const div = document.createElement('div');
            div.className = 'sdr-kb-doc';
            div.innerHTML = `
                <div class="sdr-kb-doc-info">
                    <div class="sdr-kb-doc-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    </div>
                    <div>
                        <div class="sdr-kb-doc-name">${escapeHtml(filename)}</div>
                        <div class="sdr-kb-doc-meta">${info.chunks} chunk${info.chunks !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div class="sdr-kb-doc-actions">
                    <button class="btn-client-delete" onclick="handleDeleteSdrKnowledge('${escapeHtml(filename)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Remover
                    </button>
                </div>`;
            container.appendChild(div);
        });
    } catch (err) {
        container.innerHTML = `<div class="activity-empty"><p>Erro ao carregar documentos</p><small>${escapeHtml(err.message)}</small></div>`;
    }
}

// File upload handler
$('#sdr-kb-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !sdrState.selectedTenantId) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        showToast('Enviando arquivo...', 'info');
        const res = await fetch(`${SDR_API_BASE}/tenants/${sdrState.selectedTenantId}/knowledge`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro no upload');
        }

        showToast('Arquivo processado com sucesso!', 'success');
        loadSdrKnowledge(sdrState.selectedTenantId);
    } catch (err) {
        showToast(err.message, 'error');
    }

    // Reset input
    e.target.value = '';
});

window.handleDeleteSdrKnowledge = async function (filename) {
    if (!sdrState.selectedTenantId) return;
    if (!confirm(`Remover "${filename}" da Knowledge Base?`)) return;

    try {
        // Find doc IDs for this filename
        const docIds = sdrState.knowledge
            .filter(d => (d.source_file || d.source) === filename)
            .map(d => d.id);

        for (const docId of docIds) {
            await fetch(`${SDR_API_BASE}/tenants/${sdrState.selectedTenantId}/knowledge/${docId}`, {
                method: 'DELETE',
            });
        }

        showToast('Documento removido!', 'success');
        loadSdrKnowledge(sdrState.selectedTenantId);
    } catch (err) {
        showToast('Erro ao remover documento', 'error');
    }
};

// --- SDR: Conversations Tab ---
async function loadSdrConversations(tenantId) {
    const container = $('#sdr-conversations-list');
    if (!container) return;

    container.innerHTML = '<div class="activity-empty"><p>Carregando...</p></div>';
    $('#sdr-messages-list').innerHTML = '<div class="activity-empty"><p>Selecione uma conversa à esquerda</p></div>';
    $('#sdr-chat-title').textContent = 'Selecione uma conversa';

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}/conversations`);
        if (!res.ok) throw new Error('Erro ao carregar');
        const conversations = await res.json();
        sdrState.conversations = conversations || [];

        if (sdrState.conversations.length === 0) {
            container.innerHTML = '<div class="activity-empty"><p>Nenhuma conversa</p></div>';
            return;
        }

        container.innerHTML = '';
        sdrState.conversations.forEach(conv => {
            const div = document.createElement('div');
            div.className = 'activity-item';
            div.style.cursor = 'pointer';
            div.dataset.convId = conv.id;

            const time = conv.last_message_at ? new Date(conv.last_message_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            const phone = conv.phone || conv.remote_jid || '';
            const name = conv.contact_name || formatPhoneDisplay(phone) || 'Sem identificação';

            div.innerHTML = `
                <div class="activity-icon-wrapper" style="background:var(--accent-cyan-subtle);color:var(--accent-cyan);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${escapeHtml(name)}</div>
                    <div class="activity-subtitle">${escapeHtml(phone)} · ${conv.message_count || 0} msgs</div>
                </div>
                <div class="activity-meta">
                    <span class="activity-time">${escapeHtml(time)}</span>
                </div>`;

            div.addEventListener('click', () => {
                // Deselect all
                container.querySelectorAll('.activity-item').forEach(i => i.classList.remove('selected'));
                div.classList.add('selected');
                sdrState.selectedConversationId = conv.id;
                loadSdrMessages(conv.id, name);
            });

            container.appendChild(div);
        });
    } catch (err) {
        container.innerHTML = `<div class="activity-empty"><p>Erro ao carregar</p><small>${escapeHtml(err.message)}</small></div>`;
    }
}

async function loadSdrMessages(conversationId, contactName) {
    const container = $('#sdr-messages-list');
    const titleEl = $('#sdr-chat-title');
    if (!container) return;

    titleEl.textContent = contactName || 'Conversa';
    container.innerHTML = '<div class="activity-empty"><p>Carregando...</p></div>';

    try {
        const res = await fetch(`${SDR_API_BASE}/conversations/${conversationId}/messages`);
        if (!res.ok) throw new Error('Erro ao carregar');
        const messages = await res.json();
        sdrState.messages = messages || [];

        if (sdrState.messages.length === 0) {
            container.innerHTML = '<div class="activity-empty"><p>Nenhuma mensagem</p></div>';
            return;
        }

        container.innerHTML = '';
        sdrState.messages.forEach(msg => {
            const div = document.createElement('div');
            const isOutgoing = msg.direction === 'outgoing' || msg.from_bot === true || msg.role === 'assistant';
            div.className = `sdr-msg ${isOutgoing ? 'sdr-msg-outgoing' : 'sdr-msg-incoming'}`;

            const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

            div.innerHTML = `
                <div>${escapeHtml(msg.content || msg.body || '')}</div>
                <span class="sdr-msg-time">${escapeHtml(time)}</span>`;
            container.appendChild(div);
        });

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    } catch (err) {
        container.innerHTML = `<div class="activity-empty"><p>Erro ao carregar mensagens</p></div>`;
    }
}

// --- SDR: Leads Tab ---
async function loadSdrLeads(tenantId) {
    const container = $('#sdr-leads-list');
    if (!container) return;

    container.innerHTML = '<div class="activity-empty"><p>Carregando...</p></div>';

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}/leads`);
        if (!res.ok) throw new Error('Erro ao carregar');
        const leads = await res.json();
        sdrState.leads = leads || [];

        if (sdrState.leads.length === 0) {
            container.innerHTML = '<div class="activity-empty"><p>Nenhum lead encontrado</p><small>Leads são criados automaticamente a partir das conversas</small></div>';
            return;
        }

        container.innerHTML = '';
        sdrState.leads.forEach(lead => {
            const div = document.createElement('div');
            div.className = 'activity-item';

            const qual = (lead.qualification || lead.score || '').toLowerCase();
            let badgeClass = 'badge-lead-cold';
            let badgeLabel = 'Frio';
            if (qual.includes('quente') || qual.includes('hot') || qual === 'hot') {
                badgeClass = 'badge-lead-hot';
                badgeLabel = 'Quente';
            } else if (qual.includes('morno') || qual.includes('warm') || qual === 'warm') {
                badgeClass = 'badge-lead-warm';
                badgeLabel = 'Morno';
            }

            const phone = lead.phone || lead.remote_jid || '';
            const name = lead.name || lead.contact_name || formatPhoneDisplay(phone) || 'Sem nome';
            const interest = lead.interest || lead.notes || '';
            const createdAt = lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '';

            div.innerHTML = `
                <div class="activity-icon-wrapper" style="background:var(--accent-green-subtle);color:var(--accent-green);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                </div>
                <div class="activity-content">
                    <div class="activity-title">
                        ${escapeHtml(name)}
                        <span class="badge-status ${badgeClass}">${badgeLabel}</span>
                    </div>
                    <div class="activity-subtitle">${escapeHtml(formatPhoneDisplay(phone))}${interest ? ` · ${escapeHtml(interest)}` : ''}</div>
                </div>
                <div class="activity-meta">
                    <span class="activity-time">${escapeHtml(createdAt)}</span>
                </div>`;
            container.appendChild(div);
        });
    } catch (err) {
        container.innerHTML = `<div class="activity-empty"><p>Erro ao carregar leads</p><small>${escapeHtml(err.message)}</small></div>`;
    }
}

// ============================================
// Calculadora Section
// ============================================

const CALC_API_BASE = '/api/calc'; // proxied through this server

async function loadCalcSection() {
    const container = $('#calc-tenants-list');
    if (!container) return;

    try {
        const res = await fetch(`${CALC_API_BASE}/tenants`);
        if (!res.ok) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Calculadora não conectada</p><small>Verifique se o serviço está rodando</small></div></div>`;
            return;
        }
        const tenants = await res.json();

        if (!tenants || tenants.length === 0) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><rect x="4" y="2" width="16" height="20" rx="2"></rect></svg>
                <p>Nenhum advogado cadastrado</p><small>Cadastre advogados na calculadora para vê-los aqui</small></div></div>`;
            return;
        }

        container.innerHTML = '';
        tenants.forEach(tenant => {
            const card = document.createElement('div');
            card.className = 'client-card';
            const initial = getInitials(tenant.nome || tenant.name);
            card.innerHTML = `
                <div class="client-card-header">
                    <div class="client-name-group">
                        <div class="client-avatar" style="background: linear-gradient(135deg, #f59e0b, #d97706);">${escapeHtml(initial)}</div>
                        <div>
                            <div class="client-name">${escapeHtml(tenant.nome || tenant.name)}</div>
                            <span style="font-size:0.75rem;color:var(--text-tertiary);">${escapeHtml(tenant.slug)} · OAB ${escapeHtml(tenant.oab || '')}</span>
                        </div>
                    </div>
                </div>
                <div class="client-card-footer">
                    <a href="${escapeHtml(tenant.calcUrl || `/calc/${tenant.slug}`)}" target="_blank" class="btn-text">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        Abrir Calculadora
                    </a>
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Erro ao carregar</p><small>${escapeHtml(err.message)}</small></div></div>`;
    }
}
