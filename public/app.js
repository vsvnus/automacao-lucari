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
        return data.clients || [];
    } catch {
        return [];
    }
}

async function fetchActivity() {
    try {
        const res = await fetch('/admin/activity');
        const data = await res.json();
        return data.logs || [];
    } catch {
        return [];
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/admin/stats');
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
        // Changed from leads-by-client to clients-preview based on server.js analysis
        const res = await fetch(`/api/dashboard/clients-preview${buildDateQS()}`);
        return await res.json();
    } catch {
        return {};
    }
}

window.viewClientLogs = function (clientSlug) {
    navigateTo('logs');
    const input = document.getElementById('investigation-search');
    if (input) {
        input.value = clientSlug;
        if (typeof searchLeads === 'function') searchLeads(clientSlug);
    }
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
                <button class="btn-text" onclick="navigateToClientDetails('${escapeHtml(client.slug)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z"/></svg>
                    Ver Detalhes
                </button>
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
        const res = await fetch('/admin/stats');
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
}

// Call immediately in case elements exist
setupInvestigationListeners();

async function searchLeads(query) {
    const container = $('#investigation-results');
    if (!container) return;

    container.innerHTML = `
        <div class="activity-empty">
            <p>Buscando...</p>
        </div>`;

    try {
        const sourceParam = currentLogSource === 'all' ? '&source=all' : '';
        const res = await fetch(`/api/dashboard/search?q=${encodeURIComponent(query || '')}${sourceParam}`);
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
        const res = await fetch(`/ admin / clients / ${clientId}/logs`);
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

const SDR_API_BASE = '/api/sdr'; // proxied through this server

async function loadSDRSection() {
    const container = $('#sdr-tenants-list');
    if (!container) return;

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants`);
        if (!res.ok) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>SDR de IA não conectado</p><small>Verifique se o serviço está rodando</small></div></div>`;
            return;
        }
        const tenants = await res.json();

        if (!tenants || tenants.length === 0) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <p>Nenhum tenant SDR configurado</p><small>Clique em "Novo Tenant" para começar</small></div></div>`;
            return;
        }

        container.innerHTML = '';
        tenants.forEach(tenant => {
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
                    <span class="client-status ${tenant.active ? 'active' : 'inactive'}">
                        <span class="status-indicator ${tenant.active ? 'online' : 'offline'}" style="width:6px;height:6px;"></span>
                        ${tenant.active ? 'Ativo' : 'Inativo'}
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
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Erro ao carregar SDR</p><small>${escapeHtml(err.message)}</small></div></div>`;
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
