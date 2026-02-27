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

// Sections that belong to Automação Leads app
const AUTOMACAO_SECTIONS = ['automacao', 'clients', 'logs', 'alerts'];

function navigateTo(section, replace = false) {
    if (!section) section = 'dashboard';

    // Normalize section names
    const validSections = ['dashboard', 'automacao', 'clients', 'settings', 'client-details', 'logs', 'alerts', 'sdr', 'calculadora', 'relatorio'];
    if (!validSections.includes(section)) section = 'dashboard';

    state.currentSection = section;

    // Update active section
    $$('.page-section').forEach(el => el.classList.remove('active'));
    const target = $(`#section-${section}`);
    if (target) target.classList.add('active');

    // Update sidebar active state - Automação sections all highlight 'automacao'
    const sidebarSection = AUTOMACAO_SECTIONS.includes(section) ? 'automacao' : section;
    $$('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === sidebarSection);
    });

    // Update automacao tab bar active state across all sections that have it
    if (AUTOMACAO_SECTIONS.includes(section)) {
        $$('.automacao-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.autotab === section);
        });
    }

    // Close mobile sidebar
    closeMobileSidebar();

    // Update app context bar
    const contextBar = document.getElementById('app-context-bar');
    const contextName = document.getElementById('app-context-name');
    const appSections = {
        automacao: 'Automação de Leads',
        clients: 'Automação de Leads',
        logs: 'Automação de Leads',
        alerts: 'Automação de Leads',
        sdr: 'SDR de IA',
        calculadora: 'Calculadora',
        relatorio: 'Relatórios'
    };
    if (contextBar) {
        if (appSections[section]) {
            contextBar.style.display = 'flex';
            contextBar.className = 'app-context-bar ctx-' + section;
            if (contextName) contextName.textContent = appSections[section];
        } else {
            contextBar.style.display = 'none';
        }
    }

    // Update URL History
    const url = section === 'dashboard' ? '/' : `/${section}`;
    if (replace) {
        history.replaceState({ section }, '', url);
    } else {
        history.pushState({ section }, '', url);
    }

    // Refresh section data
    if (section === 'automacao') loadAutomacaoOverview();
    if (section === 'clients') loadClients();
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
    if (section === 'alerts') loadAlertsSection();
    if (section === 'relatorio') loadRelatorioSection();
    if (section === 'dashboard') loadDashboardOverview();
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

// Automação tab bar clicks (delegated)
document.addEventListener('click', (e) => {
    const tab = e.target.closest('.automacao-tab');
    if (!tab) return;
    e.preventDefault();
    const targetSection = tab.dataset.autotab;
    if (targetSection && targetSection !== state.currentSection) {
        navigateTo(targetSection);
    }
});

// Relatório tab bar clicks
document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-reltab]');
    if (!tab) return;
    e.preventDefault();
    const targetTab = tab.dataset.reltab;
    // Update tab active state
    $$('#relatorio-tabs .automacao-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.reltab === targetTab);
    });
    // Show/hide tab content
    $$('.rel-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `rel-tab-${targetTab}`);
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

    const serverDot = document.getElementById('server-status-dot');
    const statusText = $('#server-status-text');

    if (health) {
        // Server status (compact dots)
        if (serverDot) {
            serverDot.classList.add('online');
            serverDot.classList.remove('offline');
        }
        if (statusText) statusText.textContent = 'Online';

        // Google Sheets integration status
        const sheetsDot = document.getElementById('sheets-dot');
        const integrationAlert = document.getElementById('integration-alert');
        const sheetsConnected = health.integrations?.googleSheets === 'connected';

        if (sheetsDot) {
            sheetsDot.classList.toggle('online', sheetsConnected);
            sheetsDot.classList.toggle('offline', !sheetsConnected);
        }
        if (integrationAlert) {
            integrationAlert.style.display = sheetsConnected ? 'none' : 'flex';
        }

        // Evolution API status
        const evoDot = document.getElementById('evolution-dot');
        const evoConnected = health.integrations?.evolution === 'connected';

        if (evoDot) {
            evoDot.classList.toggle('online', evoConnected);
            evoDot.classList.toggle('offline', !evoConnected);
        }

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

        // Cache health data for overview
        state._lastHealth = health;
    } else {
        // Offline state
        if (serverDot) {
            serverDot.classList.remove('online');
            serverDot.classList.add('offline');
        }
        if (statusText) statusText.textContent = 'Offline';
    }

    // If on dashboard overview, refresh the overview cards
    if (state.currentSection === 'dashboard') {
        loadDashboardOverview();
    }
    // If on automacao, refresh automacao data
    if (state.currentSection === 'automacao') {
        loadAutomacaoOverview();
    }
}

// ============================================
// Dashboard Overview (4 App Cards)
// ============================================
async function loadDashboardOverview() {
    try {
        // Fetch all data in parallel
        const [health, dashboardStats, sdrRes, relRes] = await Promise.all([
            state._lastHealth || fetchHealth(),
            fetchDashboardStats(),
            fetch('/api/sdr/tenants').then(r => r.ok ? r.json() : []).catch(() => []),
            fetch('/api/relatorio/clients').then(r => r.ok ? r.json() : []).catch(() => []),
        ]);

        // Automação card
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        if (dashboardStats) {
            setVal('ov-auto-leads', dashboardStats.newLeads || 0);
            setVal('ov-auto-sales', dashboardStats.sales || 0);
            setVal('ov-auto-errors', dashboardStats.errors || 0);
        }
        if (health) {
            setVal('ov-auto-clients', health.clients || 0);
        }

        // SDR card
        const sdrTenants = Array.isArray(sdrRes) ? sdrRes : (sdrRes.tenants || []);
        setVal('ov-sdr-tenants', sdrTenants.length);
        // Fetch stats per tenant to get real conversation/lead counts
        let totalConvos = 0, totalSdrLeads = 0;
        try {
            const statsResults = await Promise.all(
                sdrTenants.map(t =>
                    fetch(`/api/sdr/tenants/${t.id}/stats`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
                )
            );
            statsResults.forEach(s => {
                totalConvos += (s.conversations || 0);
                totalSdrLeads += (s.leads || 0);
            });
        } catch { /* ignore */ }
        setVal('ov-sdr-conversations', totalConvos);
        setVal('ov-sdr-leads', totalSdrLeads);

        // Calculadora card — static app, just check if online
        try {
            const calcHealth = await fetch('/api/calc/health').then(r => r.ok).catch(() => false);
            setVal('ov-calc-status', calcHealth ? 'Online' : 'Offline');
        } catch {
            setVal('ov-calc-status', 'Offline');
        }

        // Relatório card — API returns { data: [...] }
        const relClients = Array.isArray(relRes) ? relRes : (relRes.data || relRes.clients || []);
        setVal('ov-rel-clients', relClients.length);
        // Try to get execution stats
        try {
            const execRes = await fetch('/api/relatorio/executions?limit=100');
            if (execRes.ok) {
                const execData = await execRes.json();
                const execs = Array.isArray(execData) ? execData : (execData.data || execData.executions || []);
                setVal('ov-rel-execs', execs.length);
                const errors = execs.filter(e => e.status === 'error' || e.error).length;
                setVal('ov-rel-errors', errors);
            }
        } catch {
            setVal('ov-rel-execs', '—');
            setVal('ov-rel-errors', '—');
        }
    } catch (e) {
        console.error('Failed to load dashboard overview:', e);
    }
}

// ============================================
// Automação Overview (reuses existing functions)
// ============================================
async function loadAutomacaoOverview() {
    const health = await fetchHealth();
    const dashboardStats = await fetchDashboardStats();

    if (health) {
        const el = $('#stat-clients');
        if (el) el.textContent = health.clients || 0;
    }

    if (dashboardStats) {
        const leadsEl = $('#stat-leads');
        const salesEl = $('#stat-sales');
        const errorsEl = $('#stat-errors');
        if (leadsEl) leadsEl.textContent = dashboardStats.newLeads || 0;
        if (salesEl) salesEl.textContent = dashboardStats.sales || 0;
        if (errorsEl) errorsEl.textContent = dashboardStats.errors || 0;
    }

    await loadDashboardClients();
    await loadDashboardActivity();
}

async function loadAppsOverviewStats() {
    // SDR tenants count
    try {
        const res = await fetch('/api/sdr/tenants');
        if (res.ok) {
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : (data.tenants ? data.tenants.length : 0);
            const el = document.getElementById('app-stat-sdr');
            if (el) el.textContent = `${count} tenant${count !== 1 ? 's' : ''}`;
        }
    } catch {
        const el = document.getElementById('app-stat-sdr');
        if (el) el.textContent = 'Indisponível';
    }

    // Calculadora tenants count
    try {
        const res = await fetch('/api/calc/tenants');
        if (res.ok) {
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : (data.tenants ? data.tenants.length : 0);
            const el = document.getElementById('app-stat-calc');
            if (el) el.textContent = `${count} tenant${count !== 1 ? 's' : ''}`;
        }
    } catch {
        const el = document.getElementById('app-stat-calc');
        if (el) el.textContent = 'Indisponível';
    }

    // Relatório clients count
    try {
        const res = await fetch('/api/relatorio/clients');
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.data || data.clients || []);
            const count = list.length;
            const el = document.getElementById('app-stat-relatorio');
            if (el) el.textContent = `${count} cliente${count !== 1 ? 's' : ''}`;
        }
    } catch {
        const el = document.getElementById('app-stat-relatorio');
        if (el) el.textContent = 'Indisponível';
    }
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
    // Carregar lista de usuários
    loadUsers();

    // Carregar webhook URL do backend
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
// User Management
// ============================================
let usersData = [];
let currentUserId = null;

async function loadUsers() {
    try {
        const res = await fetch('/api/users');
        if (!res.ok) return;
        usersData = await res.json();
        renderUsersList();
    } catch { /* silent */ }
}

function renderUsersList() {
    const container = $('#users-list');
    if (!container) return;

    if (usersData.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhum usuário cadastrado</p>';
        return;
    }

    container.innerHTML = usersData.map(user => {
        const initial = (user.name || user.email || '?')[0].toUpperCase();
        const isMe = user.id === currentUserId;
        const created = new Date(user.created_at).toLocaleDateString('pt-BR');
        return `
            <div class="user-row">
                <div class="user-avatar">${initial}</div>
                <div class="user-info">
                    <span class="user-name">${escapeHtml(user.name || 'Sem nome')}${isMe ? ' <span class="badge badge-sm" style="font-size:0.65rem;vertical-align:middle;">Você</span>' : ''}</span>
                    <span class="user-email">${escapeHtml(user.email)}</span>
                </div>
                <div class="user-meta">
                    <span class="user-date">Criado em ${created}</span>
                </div>
                <div class="user-actions">
                    <button class="btn-icon" title="Editar" onclick="handleEditUser('${user.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    ${!isMe ? `<button class="btn-icon" title="Remover" onclick="handleDeleteUser('${user.id}', '${escapeHtml(user.name || user.email)}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>` : ''}
                </div>
            </div>`;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function openUserModal(editUser) {
    const modal = $('#modal-user');
    const title = $('#modal-user-title');
    const form = $('#form-user');
    const hint = $('#user-password-hint');

    form.reset();
    $('#user-edit-id').value = '';

    if (editUser) {
        title.textContent = 'Editar Usuário';
        $('#user-edit-id').value = editUser.id;
        $('#user-name').value = editUser.name || '';
        $('#user-email').value = editUser.email || '';
        $('#user-password').removeAttribute('required');
        hint.textContent = 'Deixe vazio para manter a senha atual';
    } else {
        title.textContent = 'Novo Usuário';
        $('#user-password').setAttribute('required', 'required');
        hint.textContent = 'Obrigatório para novos usuários';
    }

    modal.classList.add('visible');
}

function closeUserModal() {
    $('#modal-user')?.classList.remove('visible');
}

function handleEditUser(id) {
    const user = usersData.find(u => u.id === id);
    if (user) openUserModal(user);
}

async function handleDeleteUser(id, name) {
    if (!confirm(`Remover o usuário "${name}"? Esta ação não pode ser desfeita.`)) return;

    try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Erro ao remover', 'error');
            return;
        }
        showToast('Usuário removido', 'success');
        loadUsers();
    } catch {
        showToast('Erro de conexão', 'error');
    }
}

$('#btn-add-user')?.addEventListener('click', () => openUserModal());

$('#form-user')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('#user-edit-id').value;
    const name = $('#user-name').value.trim();
    const email = $('#user-email').value.trim();
    const password = $('#user-password').value;

    const body = { name, email };
    if (password) body.password = password;

    try {
        const url = editId ? `/api/users/${editId}` : '/api/users';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Erro ao salvar', 'error');
            return;
        }
        showToast(editId ? 'Usuário atualizado!' : 'Usuário criado!', 'success');
        closeUserModal();
        loadUsers();
    } catch {
        showToast('Erro de conexão', 'error');
    }
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
        case '2': navigateTo('automacao'); break;
        case '3': navigateTo('sdr'); break;
        case '4': navigateTo('calculadora'); break;
        case '5': navigateTo('relatorio'); break;
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
        currentUserId = user.id;
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

    // Reload button for automacao section
    $('#btn-reload-automacao')?.addEventListener('click', () => loadAutomacaoOverview());

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

function getSdrPublicUrl() {
    const host = location.hostname;
    if (host === 'staging.vin8n.online') return 'https://staging-sdr.vin8n.online';
    if (host === 'dashboard.vin8n.online') return 'https://sdr.vin8n.online';
    return 'http://localhost:3001';
}

function getSdrConnectUrl(slug) {
    if (!slug) return null;
    return `${getSdrPublicUrl()}/connect/${slug}`;
}

const sdrState = {
    tenants: [],
    selectedTenantId: null,
    selectedTenant: null,
    activeTab: 'config',
    knowledge: [],
    conversations: [],
    messages: [],
    leads: [],
    pipeline: {},
    selectedConversationId: null,
};

// --- SDR: Load Tenant List ---
function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function getSdrDateRange() {
    const from = $('#sdr-date-from')?.value;
    const to = $('#sdr-date-to')?.value;
    if (from && to) return { from, to };
    const now = new Date();
    const toDate = now.toISOString().split('T')[0];
    const fromDate = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
    return { from: fromDate, to: toDate };
}

function initSdrDatePicker() {
    const { from, to } = getSdrDateRange();
    const fromEl = $('#sdr-date-from');
    const toEl = $('#sdr-date-to');
    if (fromEl && !fromEl.value) fromEl.value = from;
    if (toEl && !toEl.value) toEl.value = to;

    fromEl?.addEventListener('change', () => loadSdrDashboard());
    toEl?.addEventListener('change', () => loadSdrDashboard());

    $$('.sdr-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.sdr-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const days = parseInt(btn.dataset.period);
            const now = new Date();
            const toDate = now.toISOString().split('T')[0];
            const fromDate = new Date(new Date().setDate(new Date().getDate() - days)).toISOString().split('T')[0];
            if ($('#sdr-date-from')) $('#sdr-date-from').value = fromDate;
            if ($('#sdr-date-to')) $('#sdr-date-to').value = toDate;
            loadSdrDashboard();
        });
    });
}

async function loadSdrDashboard() {
    const container = $('#sdr-tenants-list');
    if (!container) return;

    const { from, to } = getSdrDateRange();

    try {
        const res = await fetch(`${SDR_API_BASE}/dashboard?from=${from}&to=${to}`);
        if (!res.ok) throw new Error('SDR não conectado');
        const data = await res.json();

        sdrState.tenants = data.tenants || [];

        // Update KPIs
        const t = data.totals;
        const setKpi = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
        setKpi('sdr-kpi-clients', t.activeClients);
        setKpi('sdr-kpi-conversations', formatNumber(t.conversations));
        setKpi('sdr-kpi-messages', formatNumber(t.messages));
        setKpi('sdr-kpi-leads', formatNumber(t.leads));
        setKpi('sdr-kpi-tokens', formatNumber(t.tokens));
        setKpi('sdr-kpi-cost', '$' + t.estimated_cost.toFixed(2));

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
            card.style.cursor = 'pointer';
            card.onclick = () => openSdrDetail(tenant.id);
            const initial = getInitials(tenant.name);
            const cost = tenant.estimated_cost != null ? '$' + tenant.estimated_cost.toFixed(2) : '—';
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
                <div class="client-meta" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        ${formatNumber(tenant.conversations)} conversas
                    </div>
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                        ${formatNumber(tenant.leads)} leads
                    </div>
                    <div class="client-meta-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        ${formatNumber(tenant.tokens)} tokens
                    </div>
                    <div class="client-meta-row" style="color:var(--accent-green);font-weight:600;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                        ${cost}
                    </div>
                </div>
                <div class="client-card-footer">
                    <button class="btn-text" onclick="event.stopPropagation();handleDeleteSdrTenant('${tenant.id}', '${escapeHtml(tenant.name).replace(/'/g, "\\'")}')" style="color:var(--accent-red, #ef4444);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Excluir
                    </button>
                    <div style="flex:1"></div>
                    <span style="font-size:0.75rem;color:var(--text-tertiary);">
                        <code>${escapeHtml(tenant.llm_model || 'gpt-4o-mini')}</code>
                    </span>
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Erro ao carregar SDR</p><small>${escapeHtml(err.message)}</small></div></div>`;
    }
}

async function loadSDRSection() {
    // Ensure we show the list view
    const listView = $('#sdr-list-view');
    const detailView = $('#sdr-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';

    // Load global OpenAI key (for settings modal)
    loadSdrOpenAIKey();

    // Init date picker and load dashboard
    initSdrDatePicker();
    await loadSdrDashboard();
}

// --- Evolution API Functions ---
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

// --- SDR: Modal (creation only) ---
function openSdrModal() {
    const modal = $('#modal-sdr-tenant');
    $('#form-sdr-tenant').reset();
    $('#sdr-tenant-id').value = '';
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeSdrModal() {
    const modal = $('#modal-sdr-tenant');
    modal.classList.remove('visible');
    document.body.style.overflow = '';
}

$('#btn-add-sdr-tenant')?.addEventListener('click', () => openSdrModal());

// --- SDR: Settings Modal (OpenAI API Key) ---
function openSdrSettingsModal() {
    const modal = $('#modal-sdr-settings');
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
}
window.closeSdrSettingsModal = function () {
    const modal = $('#modal-sdr-settings');
    if (modal) {
        modal.classList.remove('visible');
        document.body.style.overflow = '';
    }
};
$('#btn-sdr-settings')?.addEventListener('click', () => openSdrSettingsModal());
$('#modal-sdr-settings')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSdrSettingsModal();
});

$('#modal-sdr-tenant')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSdrModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal-sdr-tenant')?.classList.contains('visible')) {
        closeSdrModal();
    }
});

// Form: Create new tenant (modal)
$('#form-sdr-tenant')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        name: $('#sdr-tenant-name').value.trim(),
        slug: $('#sdr-tenant-slug').value.trim(),
        whatsapp_number: $('#sdr-tenant-whatsapp').value.trim(),
    };

    if (!data.name || !data.slug) {
        showToast('Nome e slug são obrigatórios', 'error');
        return;
    }

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao criar');
        }

        const savedTenant = await res.json();
        showToast('Cliente criado! Configure o prompt e conecte o WhatsApp.', 'success');
        closeSdrModal();
        await loadSDRSection();

        // Auto-open detail view on WhatsApp tab
        if (savedTenant?.id) {
            openSdrDetail(savedTenant.id);
            setTimeout(() => switchSdrTab('whatsapp'), 300);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

window.handleEditSdrTenant = function (tenantId) {
    openSdrDetail(tenantId);
};

window.handleDeleteSdrTenant = async function (tenantId, tenantName) {
    if (!confirm(`Excluir o cliente "${tenantName}"?\n\nIsso vai remover:\n- Todas as conversas e mensagens\n- Todos os leads\n- Toda a base de conhecimento\n- A instância WhatsApp\n\nEssa ação não pode ser desfeita.`)) {
        return;
    }

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao excluir');
        }

        showToast(`Cliente "${tenantName}" excluído`, 'success');

        // If viewing this tenant's detail, go back to list
        if (sdrState.selectedTenantId === tenantId || String(sdrState.selectedTenantId) === String(tenantId)) {
            closeSdrDetail();
        }

        loadSDRSection();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

// --- SDR: Detail Panel ---
// --- SDR: Toggle Bot Active/Paused ---
function updateToggleActiveBtn(tenant) {
    const btn = $('#btn-sdr-toggle-active');
    const label = $('#sdr-toggle-label');
    const icon = $('#sdr-toggle-icon');
    if (!btn || !tenant) return;

    const isActive = tenant.active !== false;
    if (isActive) {
        label.textContent = 'Pausar Bot';
        btn.className = 'btn-secondary';
        icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    } else {
        label.textContent = 'Ativar Bot';
        btn.className = 'btn-primary';
        icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    }
}

$('#btn-sdr-toggle-active')?.addEventListener('click', async () => {
    const tenant = sdrState.selectedTenant;
    if (!tenant) return;

    const isActive = tenant.active !== false;
    const action = isActive ? 'pausar' : 'ativar';

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenant.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !isActive }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || `Erro ao ${action}`);
        }

        const updated = await res.json();
        sdrState.selectedTenant = updated;
        const idx = sdrState.tenants.findIndex(t => String(t.id) === String(tenant.id));
        if (idx >= 0) sdrState.tenants[idx] = updated;

        updateToggleActiveBtn(updated);
        showToast(isActive ? 'Bot pausado — não vai responder mensagens' : 'Bot ativado!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
});

window.openSdrDetail = async function (tenantId) {
    let tenant = sdrState.tenants.find(t => t.id === tenantId || String(t.id) === String(tenantId));
    if (!tenant) {
        showToast('Cliente não encontrado', 'error');
        return;
    }

    sdrState.selectedTenantId = tenantId;

    // Toggle views immediately (show loading state)
    const listView = $('#sdr-list-view');
    const detailView = $('#sdr-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    // Set header with cached data
    $('#sdr-detail-title').textContent = tenant.name;
    $('#sdr-detail-subtitle').textContent = `${tenant.slug} · ${tenant.niche || 'Geral'}`;

    // Fetch full tenant data (dashboard API returns limited columns)
    try {
        const res = await fetch(`${SDR_API_BASE}/tenants`);
        if (res.ok) {
            const allTenants = await res.json();
            const full = allTenants.find(t => String(t.id) === String(tenantId));
            if (full) tenant = full;
        }
    } catch { /* use cached data */ }

    sdrState.selectedTenant = tenant;
    const idx = sdrState.tenants.findIndex(t => String(t.id) === String(tenantId));
    if (idx >= 0) sdrState.tenants[idx] = tenant;

    // Update toggle button state
    updateToggleActiveBtn(tenant);

    // Load stats
    loadSdrStats(tenantId);

    // Setup tabs
    switchSdrTab('config');
    renderSdrConfig(tenant);
};

$('#btn-sdr-back')?.addEventListener('click', () => {
    closeSdrDetail();
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
        $('#sdr-stat-tokens').textContent = stats.totalTokens ? stats.totalTokens.toLocaleString() : '0';
    } catch { /* silent */ }

    // Load pipeline bar
    loadSdrPipeline(tenantId);
}

const STAGE_CONFIG = {
    new: { label: 'Novo', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    interested: { label: 'Interessado', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
    qualified: { label: 'Qualificado', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    proposal: { label: 'Proposta', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
    won: { label: 'Ganho', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    lost: { label: 'Perdido', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
};

async function loadSdrPipeline(tenantId) {
    const bar = $('#sdr-pipeline-bar');
    if (!bar) return;

    try {
        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}/leads/pipeline`);
        if (!res.ok) { bar.innerHTML = ''; return; }
        const pipeline = await res.json();
        sdrState.pipeline = pipeline;

        const total = Object.values(pipeline).reduce((a, b) => a + b, 0);
        if (total === 0) {
            bar.innerHTML = '<div class="pipeline-empty">Nenhum lead no funil ainda</div>';
            return;
        }

        bar.innerHTML = Object.entries(STAGE_CONFIG).map(([key, cfg]) => {
            const count = pipeline[key] || 0;
            const pct = Math.max(total > 0 ? (count / total * 100) : 0, count > 0 ? 8 : 0);
            return `<div class="pipeline-segment" style="flex:${pct};background:${cfg.bg};border-left:3px solid ${cfg.color};" title="${cfg.label}: ${count}">
                <span class="pipeline-count" style="color:${cfg.color}">${count}</span>
                <span class="pipeline-label">${cfg.label}</span>
            </div>`;
        }).join('');
    } catch { bar.innerHTML = ''; }
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

    // Populate connect link section
    const linkSection = $('#wa-detail-connect-link-section');
    const linkUrl = $('#wa-detail-connect-url');
    if (linkSection && tenant.slug) {
        linkSection.style.display = '';
        if (linkUrl) linkUrl.value = getSdrConnectUrl(tenant.slug);
    } else if (linkSection) {
        linkSection.style.display = 'none';
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

// --- WhatsApp Detail: Connect Link buttons ---
$('#btn-wa-copy-connect-link')?.addEventListener('click', () => {
    const url = $('#wa-detail-connect-url')?.value;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copiado!', 'success');
    }).catch(() => {
        showToast('Erro ao copiar', 'error');
    });
});

$('#btn-wa-send-connect-link')?.addEventListener('click', () => {
    const url = $('#wa-detail-connect-url')?.value;
    if (!url) return;
    const msg = encodeURIComponent(`Olá! Conecte seu WhatsApp ao Bot SDR acessando este link:\n${url}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
});

// --- SDR: Config Tab (editable form) ---
function renderSdrConfig(tenant) {
    if (!tenant) return;
    const f = id => $(`#${id}`);

    // Identificação
    if (f('cfg-name')) f('cfg-name').value = tenant.name || '';
    if (f('cfg-slug')) f('cfg-slug').value = tenant.slug || '';
    if (f('cfg-niche')) f('cfg-niche').value = tenant.niche || '';
    if (f('cfg-tone')) f('cfg-tone').value = tenant.tone || 'profissional';
    if (f('cfg-whatsapp')) f('cfg-whatsapp').value = tenant.whatsapp_number || '';

    // IA
    if (f('cfg-model')) f('cfg-model').value = tenant.llm_model || 'gpt-4o-mini';
    if (f('cfg-tokens')) f('cfg-tokens').value = tenant.max_tokens_per_response || 500;
    if (f('cfg-context-window')) f('cfg-context-window').value = tenant.context_window || 5;
    if (f('cfg-temperature')) f('cfg-temperature').value = tenant.temperature != null ? tenant.temperature : 0.7;
    if (f('cfg-prompt')) f('cfg-prompt').value = tenant.system_prompt || '';

    // Horário
    if (f('cfg-hours-start')) f('cfg-hours-start').value = tenant.business_hours_start || '08:00';
    if (f('cfg-hours-end')) f('cfg-hours-end').value = tenant.business_hours_end || '18:00';
    if (f('cfg-days')) {
        const days = Array.isArray(tenant.business_days) ? tenant.business_days.join(',') : (tenant.business_days || '1,2,3,4,5');
        f('cfg-days').value = days;
    }
    if (f('cfg-ooh-msg')) f('cfg-ooh-msg').value = tenant.out_of_hours_message || '';
    if (f('cfg-welcome-msg')) f('cfg-welcome-msg').value = tenant.welcome_message || '';

    // Notificações
    if (f('cfg-notification-phone')) f('cfg-notification-phone').value = tenant.notification_phone || '';

    // Follow-up
    if (f('cfg-followup-intervals')) {
        const intervals = Array.isArray(tenant.follow_up_intervals) ? tenant.follow_up_intervals.join(', ') : (tenant.follow_up_intervals || '24, 48, 168');
        f('cfg-followup-intervals').value = intervals;
    }
    if (f('cfg-followup-max')) f('cfg-followup-max').value = tenant.max_follow_ups != null ? tenant.max_follow_ups : 3;

    // Integrações Google
    if (f('cfg-google-sheet')) f('cfg-google-sheet').value = tenant.google_sheet_id || '';
    if (f('cfg-google-calendar')) f('cfg-google-calendar').value = tenant.google_calendar_id || '';

    // WhatsApp / Evolution
    if (f('cfg-reject-call')) f('cfg-reject-call').value = tenant.reject_call != null ? String(tenant.reject_call) : 'true';
    if (f('cfg-always-online')) f('cfg-always-online').value = tenant.always_online != null ? String(tenant.always_online) : 'true';
    if (f('cfg-msg-call')) f('cfg-msg-call').value = tenant.msg_call || '';
    if (f('cfg-read-messages')) f('cfg-read-messages').value = tenant.read_messages != null ? String(tenant.read_messages) : 'false';
}

// Save config form
$('#form-sdr-config')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tenantId = sdrState.selectedTenantId;
    if (!tenantId) return;

    const btn = $('#btn-save-sdr-config');
    const origText = btn?.querySelector('span')?.textContent;
    if (btn) btn.querySelector('span').textContent = 'Salvando...';
    if (btn) btn.disabled = true;

    try {
        const followUpRaw = $('#cfg-followup-intervals')?.value.trim();
        let followUpIntervals = undefined;
        if (followUpRaw) {
            followUpIntervals = followUpRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        }

        const data = {
            name: $('#cfg-name')?.value.trim() || undefined,
            niche: $('#cfg-niche')?.value.trim() || undefined,
            tone: $('#cfg-tone')?.value || undefined,
            whatsapp_number: $('#cfg-whatsapp')?.value.trim() || undefined,
            llm_model: $('#cfg-model')?.value || undefined,
            max_tokens_per_response: parseInt($('#cfg-tokens')?.value) || undefined,
            context_window: parseInt($('#cfg-context-window')?.value) || undefined,
            temperature: $('#cfg-temperature')?.value !== '' ? parseFloat($('#cfg-temperature')?.value) : undefined,
            system_prompt: $('#cfg-prompt')?.value.trim() || undefined,
            business_hours_start: $('#cfg-hours-start')?.value || undefined,
            business_hours_end: $('#cfg-hours-end')?.value || undefined,
            business_days: $('#cfg-days')?.value.trim() || undefined,
            out_of_hours_message: $('#cfg-ooh-msg')?.value.trim() || undefined,
            welcome_message: $('#cfg-welcome-msg')?.value.trim() || undefined,
            notification_phone: $('#cfg-notification-phone')?.value.trim() || undefined,
            follow_up_intervals: followUpIntervals,
            max_follow_ups: parseInt($('#cfg-followup-max')?.value) >= 0 ? parseInt($('#cfg-followup-max')?.value) : undefined,
            google_sheet_id: $('#cfg-google-sheet')?.value.trim() || undefined,
            google_calendar_id: $('#cfg-google-calendar')?.value.trim() || undefined,
            reject_call: $('#cfg-reject-call')?.value === 'true',
            always_online: $('#cfg-always-online')?.value === 'true',
            msg_call: $('#cfg-msg-call')?.value.trim() || undefined,
            read_messages: $('#cfg-read-messages')?.value === 'true',
        };

        const res = await fetch(`${SDR_API_BASE}/tenants/${tenantId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao salvar');
        }

        const updated = await res.json();
        showToast('Configurações salvas!', 'success');

        // Update local state
        sdrState.selectedTenant = updated;
        const idx = sdrState.tenants.findIndex(t => String(t.id) === String(tenantId));
        if (idx >= 0) sdrState.tenants[idx] = updated;

        // Update header
        $('#sdr-detail-title').textContent = updated.name;
        $('#sdr-detail-subtitle').textContent = `${updated.slug} · ${updated.niche || 'Geral'}`;
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) btn.querySelector('span').textContent = origText;
        if (btn) btn.disabled = false;
    }
});

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

            const time = conv.updated_at ? new Date(conv.updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            const phone = conv.contact_phone || conv.phone || conv.remote_jid || '';
            const name = conv.contact_name || formatPhoneDisplay(phone) || 'Sem identificação';

            const ctx = conv.context || {};
            const stage = ctx.stage || '';
            const stageCfg = STAGE_CONFIG[stage];
            const stageBadge = stageCfg ? `<span class="badge-status badge-stage" style="background:${stageCfg.bg};color:${stageCfg.color};border:1px solid ${stageCfg.color}30;">${stageCfg.label}</span>` : '';
            const score = conv.lead_score || 0;
            const scoreBar = score > 0 ? `<div class="score-bar-mini"><div class="score-bar-fill" style="width:${score}%;background:${score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#94a3b8'}"></div></div>` : '';

            div.innerHTML = `
                <div class="activity-icon-wrapper" style="background:var(--accent-cyan-subtle);color:var(--accent-cyan);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${escapeHtml(name)} ${stageBadge}</div>
                    <div class="activity-subtitle">${escapeHtml(phone)} · ${conv.message_count || 0} msgs ${scoreBar}</div>
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
            const isOutgoing = msg.direction === 'outbound' || msg.direction === 'outgoing' || msg.from_bot === true || msg.role === 'assistant';
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

// --- SDR: Leads Tab (Kanban) ---
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

        // Group leads by stage
        const grouped = {};
        for (const key of Object.keys(STAGE_CONFIG)) grouped[key] = [];
        sdrState.leads.forEach(lead => {
            const stage = lead.stage || 'new';
            if (!grouped[stage]) grouped[stage] = [];
            grouped[stage].push(lead);
        });

        container.innerHTML = `<div class="kanban-board">${Object.entries(STAGE_CONFIG).map(([key, cfg]) => {
            const items = grouped[key] || [];
            return `<div class="kanban-column">
                    <div class="kanban-column-header" style="border-top:3px solid ${cfg.color};">
                        <span class="kanban-column-title">${cfg.label}</span>
                        <span class="kanban-column-count" style="background:${cfg.bg};color:${cfg.color}">${items.length}</span>
                    </div>
                    <div class="kanban-column-body">
                        ${items.length === 0 ? '<div class="kanban-empty">—</div>' : items.map(lead => {
                const phone = lead.phone || '';
                const name = lead.name || lead.contact_name || formatPhoneDisplay(phone) || 'Sem nome';
                const interest = lead.interest || '';
                const score = lead.lead_score || 0;
                const date = lead.updated_at || lead.created_at;
                const dateStr = date ? new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
                return `<div class="kanban-card">
                                <div class="kanban-card-name">${escapeHtml(name)}</div>
                                <div class="kanban-card-phone">${escapeHtml(formatPhoneDisplay(phone))}</div>
                                ${interest ? `<div class="kanban-card-interest">${escapeHtml(interest)}</div>` : ''}
                                <div class="kanban-card-footer">
                                    <div class="score-bar-mini"><div class="score-bar-fill" style="width:${score}%;background:${score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#94a3b8'}"></div></div>
                                    <span class="kanban-card-date">${escapeHtml(dateStr)}</span>
                                </div>
                            </div>`;
            }).join('')}
                    </div>
                </div>`;
        }).join('')
            }</div>`;
    } catch (err) {
        container.innerHTML = `<div class="activity-empty"><p>Erro ao carregar leads</p><small>${escapeHtml(err.message)}</small></div>`;
    }
}

// ============================================
// SDR: OpenAI API Key Management
// ============================================

async function loadSdrOpenAIKey() {
    const badge = $('#sdr-openai-badge');
    const input = $('#sdr-openai-key-input');

    try {
        const res = await fetch(`${SDR_API_BASE}/settings`);
        if (!res.ok) throw new Error('offline');
        const data = await res.json();
        if (data.openai_api_key) {
            const key = data.openai_api_key;
            if (input) {
                input.value = key.length > 8 ? key.slice(0, 5) + '••••••••' + key.slice(-4) : '••••••••';
                input.type = 'password';
            }
            if (badge) { badge.style.display = ''; badge.textContent = 'Configurada'; badge.style.background = 'var(--accent-green-subtle)'; badge.style.color = 'var(--accent-green)'; }
            loadSdrOpenAIBalance();
        } else {
            if (input) input.value = '';
            if (badge) badge.style.display = 'none';
            const note = $('#sdr-openai-balance-note');
            if (note) note.textContent = 'Salve a API Key para consultar o saldo';
        }
    } catch {
        if (input) input.value = '';
        if (badge) badge.style.display = 'none';
    }
}

async function loadSdrOpenAIBalance() {
    const totalEl = $('#sdr-openai-balance-total');
    const remainEl = $('#sdr-openai-balance-remaining');
    const usedEl = $('#sdr-openai-balance-used');
    const noteEl = $('#sdr-openai-balance-note');

    try {
        const res = await fetch(`${SDR_API_BASE}/settings/openai-balance`);
        if (!res.ok) throw new Error('offline');
        const data = await res.json();

        if (data.total_granted !== undefined) {
            const total = parseFloat(data.total_granted || 0);
            const used = parseFloat(data.total_used || 0);
            const remaining = total - used;
            if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
            if (remainEl) remainEl.textContent = `$${remaining.toFixed(2)}`;
            if (usedEl) usedEl.textContent = `$${used.toFixed(2)}`;
            if (noteEl) noteEl.textContent = `Atualizado: ${new Date().toLocaleString('pt-BR')}`;
        } else if (data.error) {
            if (noteEl) noteEl.textContent = data.error;
        } else {
            if (noteEl) noteEl.textContent = 'Saldo não disponível para esta conta (contas pagas não expõem saldo via API)';
            if (totalEl) totalEl.textContent = '—';
            if (remainEl) remainEl.textContent = '—';
            if (usedEl) usedEl.textContent = '—';
        }
    } catch {
        const noteEl = $('#sdr-openai-balance-note');
        if (noteEl) noteEl.textContent = 'Não foi possível consultar o saldo';
    }
}

$('#btn-sdr-save-openai-key')?.addEventListener('click', async () => {
    const input = $('#sdr-openai-key-input');
    const val = input?.value?.trim();
    if (!val || val.includes('••••')) {
        showToast('Cole a API Key completa', 'error');
        return;
    }

    try {
        const res = await fetch(`${SDR_API_BASE}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openai_api_key: val }),
        });
        if (!res.ok) throw new Error('Erro ao salvar');
        showToast('API Key salva! O serviço será atualizado.', 'success');
        input.value = '';
        loadSdrOpenAIKey();
    } catch (err) {
        showToast(err.message || 'Erro ao salvar API Key', 'error');
    }
});

$('#btn-sdr-toggle-openai-key')?.addEventListener('click', () => {
    const inp = $('#sdr-openai-key-input');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('#btn-sdr-refresh-openai-balance')?.addEventListener('click', () => {
    loadSdrOpenAIBalance();
});

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


// ============================================
// ALERTS / TRAIL SYSTEM
// ============================================

async function loadAlertsSection() {
    try {
        const res = await fetch("/api/alerts/errors?limit=50");
        if (!res.ok) throw new Error("Falha ao carregar alertas");
        const data = await res.json();
        renderAlertsStats(data.stats);
        renderAlertErrors(data.errors);
    } catch (err) {
        console.error("Erro ao carregar alertas:", err);
        const list = document.getElementById("alerts-error-list");
        if (list) list.innerHTML = '<p class="empty-state">Erro ao carregar alertas</p>';
    }
}

function renderAlertsStats(stats) {
    const elToday = document.getElementById("alert-errors-today");
    const elHour = document.getElementById("alert-errors-hour");
    const elTotal = document.getElementById("alert-total-today");
    const elRate = document.getElementById("alert-success-rate");
    if (elToday) elToday.textContent = stats.today || 0;
    if (elHour) elHour.textContent = stats.lastHour || 0;
    if (elTotal) elTotal.textContent = stats.totalToday || 0;
    if (elRate) {
        const total = stats.totalToday || 0;
        const success = stats.successToday || 0;
        elRate.textContent = total > 0 ? Math.round((success / total) * 100) + "%" : "-";
    }
}

function renderAlertErrors(errors) {
    const list = document.getElementById("alerts-error-list");
    if (!list) return;

    if (!errors || errors.length === 0) {
        list.innerHTML = '<p class="empty-state">Nenhum erro recente. Tudo funcionando!</p>';
        return;
    }

    list.innerHTML = errors.map(function (err) {
        var meta = err.webhook_metadata || err.metadata || {};
        var payload = meta.payload || {};
        var phone = payload.phone || payload.phone_e164 || "";
        var name = payload.chatName || payload.name || phone || "Desconhecido";
        var client = (err.metadata && err.metadata.clientName) || "";
        var stepLabel = formatStepName(err.step_name);
        var timeAgo = formatTimeAgo(err.created_at);

        return '<div class="alert-error-item">' +
            '<div class="alert-error-icon" onclick="openTrailModal(\'' + err.trace_id + '\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>' +
            '<div class="alert-error-info" onclick="openTrailModal(\'' + err.trace_id + '\')" style="cursor:pointer;flex:1;">' +
            '<div class="lead-name">' + escapeHtml(name) + (client ? ' - ' + escapeHtml(client) : '') + '</div>' +
            '<div class="error-detail">' + escapeHtml(err.detail || "") + '</div>' +
            '<div class="error-step">Falhou em: ' + stepLabel + '</div>' +
            '</div>' +
            '<div class="alert-error-meta" onclick="openTrailModal(\'' + err.trace_id + '\')" style="cursor:pointer;">' +
            '<div class="error-time">' + timeAgo + '</div>' +
            '<div class="error-badge">' + escapeHtml(err.step_name) + '</div>' +
            '</div>' +
            '<button class="btn-dismiss alert-dismiss" onclick="event.stopPropagation();this.closest(\'.alert-error-item\').remove();" title="Dispensar">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
            '</button>' +
            '</div>';
    }).join("");
}

function formatStepName(step) {
    var names = {
        webhook_received: "Recebimento",
        duplicate_check: "Verificacao duplicata",
        payload_validated: "Validacao payload",
        client_matched: "Identificacao cliente",
        origin_detected: "Deteccao origem",
        organic_filtered: "Filtro organico",
        product_detected: "Deteccao produto",
        sheet_resolved: "Resolucao aba",
        tab_created: "Criacao de aba",
        lead_inserted: "Insercao do lead",
        status_updated: "Atualizacao status",
        sale_recovered: "Recuperacao venda",
    };
    return names[step] || step;
}

function formatTimeAgo(dateStr) {
    var now = new Date();
    var d = new Date(dateStr);
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "agora";
    if (diff < 3600) return Math.floor(diff / 60) + "min";
    if (diff < 86400) return Math.floor(diff / 3600) + "h";
    return Math.floor(diff / 86400) + "d";
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function openTrailModal(traceId) {
    var modal = document.getElementById("trail-modal");
    var timeline = document.getElementById("trail-timeline");
    var retryBtn = document.getElementById("trail-retry-btn");
    if (!modal || !timeline) return;

    modal.style.display = "flex";
    timeline.innerHTML = '<p class="empty-state">Carregando trail...</p>';
    retryBtn.onclick = function () { retryWebhook(traceId); };

    try {
        var res = await fetch("/api/alerts/trail/" + traceId);
        if (!res.ok) throw new Error("Trail nao encontrado");
        var steps = await res.json();
        renderTrailTimeline(steps);
    } catch (err) {
        timeline.innerHTML = '<p class="empty-state">Erro ao carregar trail</p>';
    }
}

function renderTrailTimeline(steps) {
    var timeline = document.getElementById("trail-timeline");
    if (!timeline) return;

    timeline.innerHTML = steps.map(function (step, i) {
        var dotClass = step.status;
        var isLast = i === steps.length - 1;
        var stepLabel = formatStepName(step.step_name);
        var detailClass = step.status === "error" ? "trail-step-detail error-detail" : "trail-step-detail";
        var timeStr = step.duration_ms != null ? step.duration_ms + "ms" : "";
        var createdTime = new Date(step.created_at).toLocaleTimeString("pt-BR");

        return '<div class="trail-step">' +
            '<div class="trail-step-dot ' + dotClass + '">' + step.step_order + '</div>' +
            (!isLast ? '<div class="trail-step-line"></div>' : '') +
            '<div class="trail-step-content">' +
            '<div class="trail-step-name">' + stepLabel + ' (' + escapeHtml(step.step_name) + ')</div>' +
            '<div class="' + detailClass + '">' + escapeHtml(step.detail || "") + '</div>' +
            '<div class="trail-step-time">' + createdTime + (timeStr ? ' - ' + timeStr : '') + '</div>' +
            '</div>' +
            '</div>';
    }).join("");
}

function closeTrailModal() {
    var modal = document.getElementById("trail-modal");
    if (modal) modal.style.display = "none";
}

async function retryWebhook(traceId) {
    var retryBtn = document.getElementById("trail-retry-btn");
    if (retryBtn) {
        retryBtn.disabled = true;
        retryBtn.textContent = "Reenviando...";
    }

    try {
        var res = await fetch("/api/alerts/retry/" + traceId, { method: "POST" });
        var data = await res.json();
        if (data.success) {
            if (retryBtn) retryBtn.textContent = "Reenviado!";
            setTimeout(function () {
                closeTrailModal();
                loadAlertsSection();
                if (retryBtn) {
                    retryBtn.disabled = false;
                    retryBtn.textContent = "Reenviar Webhook";
                }
            }, 1500);
        } else {
            if (retryBtn) {
                retryBtn.textContent = "Erro: " + (data.error || "falha");
                retryBtn.disabled = false;
            }
        }
    } catch (err) {
        if (retryBtn) {
            retryBtn.textContent = "Erro de conexao";
            retryBtn.disabled = false;
        }
    }
}

// Trail modal close handlers
document.addEventListener("DOMContentLoaded", function () {
    var closeBtn = document.getElementById("trail-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeTrailModal);

    var overlay = document.getElementById("trail-modal");
    if (overlay) overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeTrailModal();
    });

    var refreshBtn = document.getElementById("btn-refresh-alerts");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAlertsSection);

    // Update badge periodically
    updateAlertsBadge();
    setInterval(updateAlertsBadge, 60000);
});

async function updateAlertsBadge() {
    try {
        var res = await fetch("/api/alerts/error-count");
        if (!res.ok) return;
        var stats = await res.json();
        var badge = document.getElementById("alerts-badge");
        if (badge) {
            var count = stats.today || 0;
            badge.textContent = count;
            badge.style.display = count > 0 ? "inline-block" : "none";
        }
    } catch (e) { }
}
// ============================================
// Relatórios Section
// ============================================

const RELATORIO_API_BASE = '/api/relatorio';
let relatorioEditId = null;
let relCurrentMetricsConfig = null;
const relWidgetCache = {};

// Column labels for the metrics config UI
const REL_COLUMNS = [
    { colIndex: 1, label: 'Valor gasto', col: 'B' },
    { colIndex: 2, label: 'Impressões', col: 'C' },
    { colIndex: 4, label: 'Cliques no link', col: 'E' },
    { colIndex: 7, label: 'Leads / Ação', col: 'H' },
    { colIndex: 9, label: 'Vendas', col: 'J' },
    { colIndex: 11, label: 'Valor em Venda', col: 'L' },
];

const REL_DEFAULT_META = {
    1: 'fb_ads:spend', 2: 'fb_ads:impressions',
    4: 'fb_ads:inline_link_clicks',
    7: 'fb_ads:actions_lead',
    9: 'fb_ads:actions_omni_purchase',
    11: 'fb_ads:purchase_conversion_value',
};

const REL_DEFAULT_GOOGLE = {
    1: 'gads:cost_micros', 2: 'gads:impressions',
    4: 'gads:clicks',
    7: 'gads:conversions',
    11: 'gads:conversions_value',
};

async function loadRelatorioSection() {
    await Promise.all([
        loadRelatorioSettings(),
        loadRelatorioStats(),
        loadRelatorioClients(),
        loadRelatorioExecutions(),
    ]);
}

// ---- Settings (API Key) ----

async function loadRelatorioSettings() {
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/settings`);
        if (!res.ok) return;
        const data = await res.json();
        const input = $('#rel-api-key-input');
        const badge = $('#rel-api-badge');
        if (data.configured) {
            if (input && data.reportei_api_key) {
                const key = data.reportei_api_key;
                const visiblePart = key.length > 4 ? key.slice(-4) : key;
                input.placeholder = '••••••••••••••••••••' + visiblePart;
            }
            if (badge) { badge.style.display = ''; badge.textContent = '✓ Configurado'; }
        }
    } catch { /* serviço offline */ }
}

$('#btn-rel-save-apikey')?.addEventListener('click', async () => {
    const val = $('#rel-api-key-input')?.value?.trim();
    if (!val) return showToast('Cole a API Key primeiro', 'error');
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportei_api_key: val }),
        });
        if (!res.ok) throw new Error('Erro ao salvar');
        showToast('API Key salva!', 'success');
        $('#rel-api-key-input').value = '';
        await loadRelatorioSettings();
    } catch (err) { showToast(err.message, 'error'); }
});

$('#btn-rel-toggle-apikey')?.addEventListener('click', () => {
    const inp = $('#rel-api-key-input');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ---- Stats ----

async function loadRelatorioStats() {
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/status`);
        if (!res.ok) throw new Error('offline');
        const data = await res.json();
        $('#rel-stat-clients').textContent = data.activeClients ?? '—';
        $('#rel-stat-execs').textContent = data.executions30d ?? '—';
        $('#rel-stat-errors').textContent = data.errors30d ?? '—';
        $('#rel-stat-running').textContent = data.isRunning ? 'Rodando' : 'Aguardando';
    } catch {
        ['#rel-stat-clients', '#rel-stat-execs', '#rel-stat-errors'].forEach(s => { const el = $(s); if (el) el.textContent = '—'; });
        const sr = $('#rel-stat-running'); if (sr) sr.textContent = 'Offline';
    }
}

// ---- Clients list ----

async function loadRelatorioClients() {
    const container = $('#relatorio-clients-list');
    if (!container) return;
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/clients`);
        if (!res.ok) throw new Error('Serviço indisponível');
        const clients = (await res.json()).data || [];

        if (clients.length === 0) {
            container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line></svg>
                <p>Nenhum cliente cadastrado</p><small>Clique em "Novo Cliente" para começar</small></div></div>`;
            return;
        }

        container.innerHTML = '';
        clients.forEach(client => {
            const card = document.createElement('div');
            card.className = 'client-card';
            const statusClass = client.active ? 'active' : 'inactive';
            const statusDot = client.active ? 'online' : 'offline';
            card.innerHTML = `
                <div class="client-card-header">
                    <div class="client-name-group">
                        <div class="client-avatar" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);">${escapeHtml(getInitials(client.name))}</div>
                        <div>
                            <div class="client-name">${escapeHtml(client.name)}</div>
                            <span style="font-size:0.75rem;color:var(--text-tertiary);">
                                ${client.meta_ads_integration_id ? 'Meta Ads ✓' : ''}
                                ${client.google_ads_integration_id ? ' · Google Ads ✓' : ''}
                            </span>
                        </div>
                    </div>
                    <span class="client-status ${statusClass}">
                        <span class="status-indicator ${statusDot}" style="width:6px;height:6px;"></span>
                        ${client.active ? 'Ativo' : 'Inativo'}
                    </span>
                </div>
                <div class="client-card-footer">
                    <button class="btn-text" style="color:var(--success);" onclick="triggerClientRun(${client.id}, '${escapeHtml(client.name)}', 'weekly')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        Semanal
                    </button>
                    <button class="btn-text" style="color:var(--success);" onclick="triggerClientRun(${client.id}, '${escapeHtml(client.name)}', 'monthly')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        Mensal
                    </button>
                    <button class="btn-text" onclick="editRelatorioClient(${client.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1-2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        Editar
                    </button>
                    <button class="btn-text" style="color:var(--error);" onclick="deleteRelatorioClient(${client.id}, '${escapeHtml(client.name)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path></svg>
                        Remover
                    </button>
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="activity-empty"><p>Relatórios não conectado</p><small>${escapeHtml(err.message)}</small></div></div>`;
    }
}

// ---- Executions ----

async function loadRelatorioExecutions() {
    const container = $('#relatorio-executions');
    if (!container) return;
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/executions?limit=20`);
        if (!res.ok) throw new Error('offline');
        const execs = (await res.json()).data || [];

        if (execs.length === 0) {
            container.innerHTML = `<div class="activity-empty"><p>Nenhuma execução registrada</p></div>`;
            return;
        }
        container.innerHTML = execs.map(e => {
            const isError = e.status === 'error';
            const isSuccess = e.status === 'success';
            const color = isSuccess ? 'var(--success)' : isError ? 'var(--error)' : 'var(--warning)';
            const statusLabel = isSuccess ? 'Sucesso' : isError ? 'Erro' : escapeHtml(e.status || '—');
            const dt = e.created_at ? new Date(e.created_at).toLocaleString('pt-BR') : e.run_date || '—';
            const errorMsg = e.error_message || e.error || e.details || '';
            const errorBlock = isError && errorMsg
                ? `<div class="exec-error-detail"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span>${escapeHtml(errorMsg)}</span></div>`
                : '';
            return `<div class="activity-item${isError ? ' exec-error-row' : ''}">
                <div class="activity-dot" style="background:${color};"></div>
                <div class="activity-content">
                    <span class="activity-title">${escapeHtml(e.client_name || String(e.client_id))} — ${escapeHtml(e.execution_type || '—')}</span>
                    <span class="activity-meta">${escapeHtml(dt)} · <span style="color:${color};font-weight:600;">${statusLabel}</span></span>
                    ${errorBlock}
                </div>
            </div>`;
        }).join('');
    } catch {
        container.innerHTML = `<div class="activity-empty"><p>Sem dados de execução</p></div>`;
    }
}

// ---- Modal (novo/editar) ----

function extractSheetId(value) {
    // Aceita URL completa ou só o ID
    const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : value.trim();
}

async function openRelatorioModal(client = null) {
    relatorioEditId = client ? client.id : null;
    relCurrentMetricsConfig = client?.metrics_config || null;
    const isEdit = !!client;

    $('#modal-relatorio-title').textContent = isEdit ? 'Editar Cliente' : 'Novo Cliente';
    $('#relatorio-client-edit-id').value = client?.id || '';
    $('#rel-semanal-tab').value = client?.semanal_tab_name || 'Atualizar Projeção Semanal';
    $('#rel-mensal-tab').value = client?.mensal_tab_name || 'Métricas Gerenciadores';
    $('#rel-lead-metric').value = client?.lead_metric || 'fb_ads:actions_lead';
    $('#rel-notes').value = client?.notes || '';
    $('#rel-spreadsheet-url').value = client?.spreadsheet_id || '';
    $('#rel-spreadsheet-id').value = client?.spreadsheet_id || '';
    const mcBlock = $('#rel-metrics-config-block');
    if (mcBlock) { mcBlock.style.display = 'none'; }
    const mcContainer = $('#rel-metrics-config-container');
    if (mcContainer) mcContainer.innerHTML = '';

    // Reset blocos
    const sel = $('#rel-reportei-select');
    const intBlock = $('#rel-integrations-block');
    const sheetBlock = $('#rel-sheet-block');
    const advBlock = $('#rel-advanced-block');
    const submitBtn = $('#btn-rel-submit');

    if (intBlock) intBlock.style.display = 'none';
    if (sheetBlock) sheetBlock.style.display = 'none';
    if (advBlock) advBlock.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;

    // Carrega clientes do Reportei
    if (sel) {
        sel.innerHTML = '<option value="">Carregando clientes do Reportei...</option>';
        sel.disabled = true;
        try {
            const res = await fetch(`${RELATORIO_API_BASE}/reportei/clients`);
            const clients = (await res.json()).data || [];
            sel.innerHTML = '<option value="">Selecione o cliente...</option>' +
                clients.map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
            sel.disabled = false;

            // Em modo edição, pré-seleciona o cliente
            if (isEdit && client.reportei_client_id) {
                sel.value = String(client.reportei_client_id);
                await onReporteiClientSelected(client.reportei_client_id, client);
            }
        } catch (err) {
            sel.innerHTML = `<option value="">Erro ao carregar: ${escapeHtml(err.message)}</option>`;
        }
    }

    $('#modal-relatorio-client').classList.add('visible');
    document.body.style.overflow = 'hidden';
}

async function onReporteiClientSelected(reporteiId, existingClient = null) {
    const intBlock = $('#rel-integrations-block');
    const sheetBlock = $('#rel-sheet-block');
    const advBlock = $('#rel-advanced-block');
    const submitBtn = $('#btn-rel-submit');
    const metaSel = $('#rel-meta-select');
    const googleSel = $('#rel-google-select');
    const hint = $('#rel-select-hint');

    if (!reporteiId) {
        if (intBlock) intBlock.style.display = 'none';
        if (sheetBlock) sheetBlock.style.display = 'none';
        if (advBlock) advBlock.style.display = 'none';
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    // Atualiza hidden fields com nome e ID
    const sel = $('#rel-reportei-select');
    const opt = sel?.querySelector(`option[value="${reporteiId}"]`);
    $('#rel-reportei-id').value = reporteiId;
    $('#rel-client-name').value = opt?.dataset?.name || (existingClient?.name || '');
    if (hint) hint.textContent = `Cliente selecionado: ${opt?.dataset?.name || ''}`;

    // Carrega integrações
    if (metaSel) metaSel.innerHTML = '<option value="">Carregando...</option>';
    if (googleSel) googleSel.innerHTML = '<option value="">Carregando...</option>';
    if (intBlock) intBlock.style.display = '';

    try {
        const res = await fetch(`${RELATORIO_API_BASE}/reportei/clients/${reporteiId}/integrations`);
        const integrations = (await res.json()).data || [];

        const metaOpts = integrations.filter(i => i.integration_name === 'Meta Ads');
        const googleOpts = integrations.filter(i => i.integration_name === 'Google Ads');

        if (metaSel) {
            metaSel.innerHTML = '<option value="">Nenhuma</option>' +
                metaOpts.map(i => `<option value="${i.id}">${escapeHtml(i.full_name)}</option>`).join('');
            if (existingClient?.meta_ads_integration_id)
                metaSel.value = String(existingClient.meta_ads_integration_id);
            else if (metaOpts.length === 1)
                metaSel.value = String(metaOpts[0].id); // auto-seleciona se só tem 1
        }
        if (googleSel) {
            googleSel.innerHTML = '<option value="">Nenhuma</option>' +
                googleOpts.map(i => `<option value="${i.id}">${escapeHtml(i.full_name)}</option>`).join('');
            if (existingClient?.google_ads_integration_id)
                googleSel.value = String(existingClient.google_ads_integration_id);
            else if (googleOpts.length === 1)
                googleSel.value = String(googleOpts[0].id);
        }
    } catch {
        if (metaSel) metaSel.innerHTML = '<option value="">Erro ao carregar</option>';
        if (googleSel) googleSel.innerHTML = '<option value="">Erro ao carregar</option>';
    }

    if (sheetBlock) sheetBlock.style.display = '';
    if (advBlock) advBlock.style.display = '';
    if (submitBtn) submitBtn.disabled = false;

    // Build metrics config UI
    const mcBlock = $('#rel-metrics-config-block');
    if (mcBlock) mcBlock.style.display = '';
    buildRelatorioMetricsUI();
}

$('#rel-reportei-select')?.addEventListener('change', (e) => {
    onReporteiClientSelected(e.target.value);
});

function closeRelatorioModal() {
    $('#modal-relatorio-client').classList.remove('visible');
    document.body.style.overflow = '';
    relatorioEditId = null;
}

async function editRelatorioClient(id) {
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/clients`);
        const client = ((await res.json()).data || []).find(c => c.id === id);
        if (client) openRelatorioModal(client);
    } catch { showToast('Erro ao carregar cliente', 'error'); }
}

async function deleteRelatorioClient(id, name) {
    if (!confirm(`Remover "${name}"?`)) return;
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/clients/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Erro ao remover');
        showToast(`${name} removido`, 'success');
        await loadRelatorioClients();
        await loadRelatorioStats();
    } catch (err) { showToast(err.message, 'error'); }
}

// ---- Metrics Config UI ----

function buildRelatorioMetricsUI() {
    const container = $('#rel-metrics-config-container');
    if (!container) return;

    const metaId = $('#rel-meta-select')?.value;
    const googleId = $('#rel-google-select')?.value;

    const sections = [];
    if (metaId) {
        sections.push({ key: 'semanal_meta', label: 'Semanal — Meta Ads', integrationId: metaId, platform: 'meta' });
        sections.push({ key: 'mensal_meta', label: 'Mensal — Meta Ads', integrationId: metaId, platform: 'meta' });
    }
    if (googleId) {
        sections.push({ key: 'semanal_google', label: 'Semanal — Google Ads', integrationId: googleId, platform: 'google' });
        sections.push({ key: 'mensal_google', label: 'Mensal — Google Ads', integrationId: googleId, platform: 'google' });
    }

    if (sections.length === 0) {
        container.innerHTML = '<small style="color:var(--text-tertiary);">Selecione ao menos uma integração para configurar.</small>';
        return;
    }

    let html = '';
    for (const s of sections) {
        html += `<div style="border:1px solid var(--border-subtle);border-radius:8px;margin-bottom:8px;overflow:hidden;" data-rel-config-key="${s.key}">
            <div onclick="toggleRelMetricsSection(this)" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-surface);cursor:pointer;font-size:0.8rem;font-weight:600;color:var(--text-primary);user-select:none;">
                <span>${s.label}</span>
                <span style="transition:transform 150ms;font-size:0.65rem;color:var(--text-tertiary);">▶</span>
            </div>
            <div style="display:none;padding:10px 12px;" class="rel-mc-body">
                <table style="width:100%;font-size:0.78rem;border-collapse:collapse;">
                    <thead><tr>
                        <th style="text-align:center;padding:3px 4px;font-weight:600;color:var(--text-tertiary);font-size:0.7rem;width:32px;">Col</th>
                        <th style="text-align:left;padding:3px 4px;font-weight:600;color:var(--text-tertiary);font-size:0.7rem;">Campo</th>
                        <th style="text-align:left;padding:3px 4px;font-weight:600;color:var(--text-tertiary);font-size:0.7rem;">Métrica Reportei</th>
                    </tr></thead>
                    <tbody id="rel-mc-rows-${s.key}"><tr><td colspan="3" style="text-align:center;padding:8px;color:var(--text-tertiary);">Carregando widgets...</td></tr></tbody>
                </table>
            </div>
        </div>`;
    }
    container.innerHTML = html;

    for (const s of sections) {
        loadRelWidgetsForSection(s.key, s.integrationId, s.platform);
    }
}

function toggleRelMetricsSection(headerEl) {
    const body = headerEl.nextElementSibling;
    const arrow = headerEl.querySelector('span:last-child');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

const METRIC_TRANSLATIONS = {
    // Meta Ads (Facebook/Instagram)
    'fb_ads:spend': 'Valor gasto',
    'fb_ads:impressions': 'Impressões',
    'fb_ads:cpm': 'CPM',
    'fb_ads:cpc': 'CPC',
    'fb_ads:cpc_facebook': 'CPC (Facebook)',
    'fb_ads:cpc_instagram': 'CPC (Instagram)',
    'fb_ads:ctr': 'CTR',
    'fb_ads:inline_link_clicks': 'Cliques no link',
    'fb_ads:facebook_link_clicks': 'Cliques no link (Facebook)',
    'fb_ads:instagram_link_clicks': 'Cliques no link (Instagram)',
    'fb_ads:cost_per_inline_link_click': 'Custo por clique no link',
    'fb_ads:actions_lead': 'Leads',
    'fb_ads:actions_cost_per_lead': 'Custo por Lead',
    'fb_ads:actions_contacts': 'Contatos',
    'fb_ads:actions_omni_purchase': 'Compras',
    'fb_ads:actions_cost_per_purchase': 'Custo por compra',
    'fb_ads:purchase_conversion_value': 'Valor de conversão de compras',
    'fb_ads:purchase_roas': 'ROAS de compras',
    'fb_ads:actions_onsite_conversion.messaging_conversation_started_7d': 'Contatos por mensagem iniciada',
    'fb_ads:actions_onsite_conversion.messaging_conversation_started_7d_facebook': 'Contatos por msg iniciada (FB)',
    'fb_ads:actions_onsite_conversion.messaging_conversation_started_7d_instagram': 'Contatos por msg iniciada (IG)',
    'fb_ads:spend-actions_onsite_conversion.messaging_conversation_started_7d': 'Custo por mensagem iniciada',
    'fb_ads:actions_post_engagement': 'Engajamento com a publicação',
    'fb_ads:actions_post_engagement_facebook': 'Eng. publicação (Facebook)',
    'fb_ads:actions_post_engagement_instagram': 'Eng. publicação (Instagram)',
    'fb_ads:actions_page_engagement': 'Engajamento com a Página',
    'fb_ads:actions_comment': 'Comentários',
    'fb_ads:actions_video_view': 'Visualizações de vídeo',
    'fb_ads:actions_photo_view': 'Visualizações de foto',
    'fb_ads:actions_landing_page_view': 'Visualizações na página de destino',
    'fb_ads:page_follows': 'Novos Seguidores',
    'fb_ads:reach': 'Alcance',
    'fb_ads:frequency': 'Frequência',
    'fb_ads:count_campaigns': 'Quantidade de Campanhas',
    'fb_ads:count_ads': 'Quantidade de Anúncios',
    'fb_ads:cost_per_unique_click': 'Custo por clique único',
    'fb_ads:unique_clicks': 'Cliques únicos',
    'fb_ads:unique_ctr': 'CTR único',
    'sum_leads_messages': 'Soma (Leads + Mens. Iniciadas)',

    // Google Ads
    'gads:cost_micros': 'Custo',
    'gads:impressions': 'Impressões',
    'gads:cpm': 'CPM médio',
    'gads:clicks': 'Cliques',
    'gads:cpc': 'CPC médio',
    'gads:ctr': 'CTR',
    'gads:conversions': 'Conversões',
    'gads:cost_per_conversion': 'Custo / conversão',
    'gads:conversions_value': 'Valor das conversões',
    'gads:roas': 'Valor conv. / custo (ROAS)',
    'gads:search_impression_share': 'Parcela de impressão na rede de pesquisa'
};

function formatMetricName(key) {
    if (!key) return '';
    if (METRIC_TRANSLATIONS[key]) {
        return METRIC_TRANSLATIONS[key];
    }
    // Fallback: formata a string "meta: nome_da_metrica" ou semelhante
    let pretty = key.replace(/_/g, ' ');
    if (pretty.startsWith('fb ads:')) {
        pretty = pretty.replace('fb ads:', 'Meta: ');
    } else if (pretty.startsWith('gads:')) {
        pretty = pretty.replace('gads:', 'Google: ');
    }
    // Capitaliza a primeira letra de cada palavra
    return pretty.replace(/\b\w/g, c => c.toUpperCase());
}

async function loadRelWidgetsForSection(configKey, integrationId, platform) {
    const tbody = document.getElementById(`rel-mc-rows-${configKey}`);
    if (!tbody) return;
    try {
        let widgets;
        if (relWidgetCache[integrationId]) {
            widgets = relWidgetCache[integrationId];
        } else {
            const res = await fetch(`${RELATORIO_API_BASE}/reportei/integrations/${integrationId}/widgets`);
            widgets = (await res.json()).data || [];
            relWidgetCache[integrationId] = widgets;
        }

        const existingCfg = relCurrentMetricsConfig && relCurrentMetricsConfig[configKey];
        const defaults = platform === 'meta' ? REL_DEFAULT_META : REL_DEFAULT_GOOGLE;

        let html = '';
        for (const col of REL_COLUMNS) {
            let currentKey = '';
            if (existingCfg) {
                const entry = existingCfg.find(m => m.colIndex === col.colIndex);
                currentKey = entry ? (entry.key || '') : '';
            } else {
                currentKey = defaults[col.colIndex] || '';
            }

            let options = '<option value="">— Deixar vazio —</option>';
            for (const w of widgets) {
                const sel = w.reference_key === currentKey ? ' selected' : '';
                const displayLabel = formatMetricName(w.reference_key);
                options += `<option value="${escapeHtml(w.reference_key)}"${sel}>${escapeHtml(displayLabel)}</option>`;
            }
            if (currentKey && !widgets.find(w => w.reference_key === currentKey)) {
                const displayLabel = formatMetricName(currentKey);
                options += `<option value="${escapeHtml(currentKey)}" selected>${escapeHtml(displayLabel)} ✦</option>`;
            }

            html += `<tr style="border-top:1px solid var(--border-subtle);">
                <td style="text-align:center;padding:4px;font-weight:600;color:var(--text-tertiary);">${col.col}</td>
                <td style="padding:4px;color:var(--text-secondary);">${col.label}</td>
                <td style="padding:4px;"><select data-col-index="${col.colIndex}" data-rel-config-key="${configKey}" style="width:100%;font-size:0.78rem;padding:3px 4px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-surface);color:var(--text-primary);">${options}</select></td>
            </tr>`;
        }
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--error);padding:8px;">Erro: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function collectRelatorioMetricsConfig() {
    const config = {};
    const sections = document.querySelectorAll('[data-rel-config-key]');
    sections.forEach(section => {
        const key = section.dataset.relConfigKey;
        const selects = section.querySelectorAll('select[data-rel-config-key]');
        if (selects.length === 0) return;
        const entries = [];
        selects.forEach(sel => {
            const colIdx = parseInt(sel.dataset.colIndex);
            const metricKey = sel.value || null;
            const col = REL_COLUMNS.find(c => c.colIndex === colIdx);
            entries.push({ colIndex: colIdx, key: metricKey, label: col ? col.label : '' });
        });
        config[key] = entries;
    });
    return Object.keys(config).length > 0 ? config : null;
}

$('#form-relatorio-client')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sheetRaw = $('#rel-spreadsheet-url')?.value?.trim() || '';
    const sheetId = extractSheetId(sheetRaw);
    if (!sheetId) return showToast('Informe o link ou ID da planilha', 'error');

    const metricsConfig = collectRelatorioMetricsConfig();

    const payload = {
        name: $('#rel-client-name').value.trim(),
        reportei_client_id: parseInt($('#rel-reportei-id').value),
        meta_ads_integration_id: $('#rel-meta-select')?.value || null,
        google_ads_integration_id: $('#rel-google-select')?.value || null,
        spreadsheet_id: sheetId,
        semanal_tab_name: $('#rel-semanal-tab').value.trim() || 'Atualizar Projeção Semanal',
        mensal_tab_name: $('#rel-mensal-tab').value.trim() || 'Métricas Gerenciadores',
        lead_metric: $('#rel-lead-metric').value || 'fb_ads:actions_lead',
        metrics_config: metricsConfig,
        notes: $('#rel-notes').value.trim() || null,
        active: true,
    };
    try {
        const isEdit = !!relatorioEditId;
        const url = isEdit ? `${RELATORIO_API_BASE}/clients/${relatorioEditId}` : `${RELATORIO_API_BASE}/clients`;
        const res = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erro ao salvar'); }
        showToast(isEdit ? 'Cliente atualizado' : 'Cliente criado', 'success');
        closeRelatorioModal();
        await loadRelatorioClients();
        await loadRelatorioStats();
    } catch (err) { showToast(err.message, 'error'); }
});

$('#btn-add-relatorio-client')?.addEventListener('click', () => openRelatorioModal());

// ---- Automação manual ----

async function triggerClientRun(clientId, clientName, type) {
    if (!confirm(`Executar automação ${type === 'weekly' ? 'Semanal' : 'Mensal'} para "${clientName}"?`)) return;
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/clients/${clientId}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro');
        showToast(data.message, 'success');
        setTimeout(loadRelatorioExecutions, 6000);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function triggerRelatorioRun(type) {
    const btn = type === 'weekly' ? $('#btn-relatorio-run-weekly') : $('#btn-relatorio-run-monthly');
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Aguarde...'; }
    try {
        const res = await fetch(`${RELATORIO_API_BASE}/run`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro');
        showToast(data.message || 'Automação iniciada', 'success');
        setTimeout(() => Promise.all([loadRelatorioStats(), loadRelatorioExecutions()]), 3000);
    } catch (err) { showToast(err.message, 'error'); }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = type === 'weekly'
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Semanal</span>`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg><span>Mensal</span>`;
        }
    }
}

$('#btn-relatorio-run-weekly')?.addEventListener('click', () => triggerRelatorioRun('weekly'));
$('#btn-relatorio-run-monthly')?.addEventListener('click', () => triggerRelatorioRun('monthly'));
$('#btn-relatorio-refresh-execs')?.addEventListener('click', loadRelatorioExecutions);

$('#modal-relatorio-client')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeRelatorioModal();
});
