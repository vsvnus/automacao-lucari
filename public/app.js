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
    const validSections = ['dashboard', 'clients', 'settings', 'client-details', 'logs'];
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
            searchLeads(''); // Auto-load
        }
    }
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
// Stats & Dashboard
// ============================================
async function updateDashboard() {
    const health = await fetchHealth();
    const stats = await fetchStats();

    const statusIndicator = $('#server-status .status-indicator');
    const statusText = $('#server-status-text');

    if (health) {
        // Stats
        $('#stat-clients').textContent = health.clients || 0;
        $('#stat-uptime').textContent = formatUptime(health.uptime);

        // Usar totalLeads do endpoint de stats, ou manter webhookCount local como fallback
        const totalLeads = (stats && stats.totalLeads !== undefined) ? stats.totalLeads : state.webhookCount;
        $('#stat-webhooks').textContent = totalLeads;

        // Server status
        statusIndicator?.classList.add('online');
        statusIndicator?.classList.remove('offline');
        if (statusText) statusText.textContent = 'Online';

        // Env badge
        const badge = $('#env-badge');
        if (badge) {
            const isProd = health.uptime > 0; // Simplificação
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

function formatUptime(seconds) {
    if (!seconds) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    return `${h}h ${m}m`;
}

async function loadDashboardClients() {
    const clients = await fetchClients();
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
            <div class="activity-arrow">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                     <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>`;
        container.appendChild(div);
    });
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
        const res = await fetch('/api/dashboard/search?q=');
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
                const adapted = {
                    result: (item.status && item.status.includes('Erro')) ? 'error' : 'success',
                    status: item.status ? item.status.replace(/^Processado: /, '') : 'Desconhecido',
                    event_type: item.type === 'event' ? 'webhook' : 'log',
                    timestamp: item.timestamp,
                    name: item.name || 'Sem nome',
                    phone: item.phone,
                    client: item.client,
                    error_message: item.payload?.error || (item.status.includes('Erro') ? item.status : null)
                };
                dashboardContainer.appendChild(renderLogItem(adapted));
            });
        }
    }
}

function renderLogItem(log, detailed = false) {
    const div = document.createElement('div');
    div.className = 'activity-item';

    // Sucesso, warning ou erro
    let resultType = 'success';
    if (log.result !== 'success' && log.result !== 'SUCCESS') resultType = 'error';

    const isUpdate = log.event_type === 'lead.update' || log.event_type === 'status_update';

    // Debug
    if (log.status && (log.status.includes('Recuperada') || log.status.includes('não encontrado'))) {
        console.log('Detectado lead recuperado:', log);
    }

    const timestamp = new Date(log.timestamp);
    const time = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fullDate = timestamp.toLocaleDateString('pt-BR') + ' ' + time;

    // Ícone e Cor baseados no tipo
    let icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>';
    let iconClass = 'stat-icon-webhook'; // Laranja padrão
    let badge = '<span class="badge-status badge-new">Novo Lead</span>';

    // 1. Erro (Prioridade máxima se falhou)
    if (resultType === 'error') {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        iconClass = 'stat-icon-webhook'; // Vermelho (via CSS error)
        badge = '<span class="badge-status badge-error">Erro</span>';
    }
    // 2. Status Específico (Se não for erro)
    else if (log.status === 'Venda') {
        badge = '<span class="badge-status badge-sale">Venda</span>';
        iconClass = 'stat-icon-status'; // Verde
    } else if (log.status && (log.status.includes('Recuperada') || log.status.includes('não encontrado'))) {
        badge = `<span class="badge-status badge-warning">${escapeHtml(log.status)}</span>`;
        iconClass = 'stat-icon-warning'; // Amarelo
    }
    // 3. Atualização Genérica
    else if (isUpdate) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>';
        iconClass = 'stat-icon-clients'; // Roxo/Azul
        badge = '<span class="badge-status badge-update">Atualização</span>';
    }

    div.innerHTML = `
        <div class="activity-icon-wrapper ${iconClass}">
            ${icon}
        </div>
        <div class="activity-content">
            <div class="activity-title">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
                    ${escapeHtml((log.name && log.name !== 'Sem nome') ? log.name : formatPhoneDisplay(log.phone))}
                </span>
                ${badge}
                
                ${/* Tooltip de Erro */ ''}
                ${(resultType === 'error' && log.error_message) ? `
                    <span class="error-icon-container" data-tooltip="${escapeHtml(log.error_message)}">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </span>
                ` : ''}

                ${/* Tooltip de Aviso (Recuperada) */ ''}
                ${(log.status && (log.status.includes('Recuperada') || log.status.includes('não encontrado'))) ? `
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
                ${escapeHtml(log.client)} • ${formatPhoneDisplay(log.phone)}
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
            const isSupa = stats.dataSource === 'supabase';
            badge.textContent = isSupa ? '☁️ Supabase' : '📁 Local (JSON)';
            badge.style.background = isSupa ? 'var(--accent-green-subtle)' : 'var(--accent-orange-subtle)';
            badge.style.color = isSupa ? 'var(--accent-green)' : 'var(--accent-orange)';
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
        case '4': navigateTo('settings'); break;
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

function setupInvestigationListeners() {
    const btn = $('#btn-investigate');
    const input = $('#investigation-search');

    if (btn && input) {
        // Remove listeners to avoid duplicates if re-run (though app.js runs once)
        // Since we can't easily remove anonymous listeners, we trust init runs once.
        btn.addEventListener('click', () => {
            const query = input.value.trim();
            if (query) searchLeads(query);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = input.value.trim();
                if (query) searchLeads(query);
            }
        });
    }
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
        const res = await fetch(`/api/dashboard/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        renderInvestigationResults(results);
    } catch (err) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Erro na busca</p>
                <small>${err.message}</small>
            </div>`;
    }
}

function renderInvestigationResults(results) {
    const container = $('#investigation-results');
    if (!container) return;

    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Nenhum resultado encontrado</p>
                <small>Tente outro termo</small>
            </div>`;
        return;
    }

    container.innerHTML = '';
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'activity-item';

        const timestamp = new Date(item.timestamp).toLocaleString('pt-BR');

        let badgeClass = 'badge-status';
        let iconClass = 'stat-icon-webhook';
        let detailsHtml = '';

        if (item.status.toLowerCase().includes('erro') || item.status === 'error' || item.status === 'Erro Processamento') {
            badgeClass += ' badge-error';
            iconClass = 'stat-icon-status';
            // Show specific error from payload if available
            const errorMsg = item.payload?.error || 'Erro desconhecido';
            detailsHtml = `<div style="color:var(--accent-red);font-size:0.85rem;margin-top:4px;">❌ ${escapeHtml(errorMsg)}</div>`;
        } else if (item.status.includes('Processado') || item.status === 'success') {
            badgeClass += ' badge-sale';
            iconClass = 'stat-icon-sale';
            // Show destination sheet
            const sheet = item.payload?.sheet || '?';
            const aba = item.payload?.sheet_name || 'auto'; // Some logs might not have this, check payload structure
            detailsHtml = `<div style="color:var(--accent-green);font-size:0.85rem;margin-top:4px;">✅ Enviado para: <strong>${escapeHtml(sheet)}</strong></div>`;
        } else {
            badgeClass += ' badge-new';
            detailsHtml = `<div style="color:var(--text-tertiary);font-size:0.85rem;margin-top:4px;">📥 Webhook recebido</div>`;
        }

        let statusBadge = `<span class="${badgeClass}">${item.status}</span>`;

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
                    <span>${formatPhoneDisplay(item.phone) || 'Sem telefone'}</span>
                    ${statusBadge}
                </div>
                <div class="activity-subtitle">
                    ${escapeHtml(item.client)} · ${timestamp}
                </div>
                ${detailsHtml}
                
                <div style="margin-top:8px;">
                     <button class="btn-text btn-sm" onclick="togglePayload('${payloadId}')">
                        Ver Payload
                    </button>
                    <div id="${payloadId}" class="payload-preview" style="display:none; margin-top: 8px;">
                        <div class="payload-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <span style="font-weight:600; font-size:0.8rem; color: #000;">Payload JSON</span>
                            <button class="btn-icon btn-sm" onclick="togglePayload('${payloadId}')" title="Fechar" style="color: #000;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                        <pre style="color: #000; background: #f5f5f5; padding: 10px; border-radius: 6px; overflow-x: auto;">${escapeHtml(JSON.stringify(item.payload, null, 2))}</pre>
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
    const container = $('#investigation-results');
    if (container) {
        container.innerHTML = `
            <div class="activity-empty">
                <p>Carregando erros recentes...</p>
            </div>`;

        try {
            const res = await fetch('/api/dashboard/errors');
            const errors = await res.json();

            const adapted = errors.map(e => ({
                id: e.id,
                timestamp: e.created_at,
                phone: e.phone,
                client: e.clients?.name || 'Desconhecido',
                status: 'Erro Processamento',
                payload: {
                    error: e.error_message,
                    ...e
                }
            }));
            renderInvestigationResults(adapted);
        } catch (err) {
            container.innerHTML = `<div class="activity-empty"><p class="error">Erro ao carregar</p></div>`;
        }
    }
}
window.loadRecentErrors = loadRecentErrors;

function setupInvestigationListeners() {
    const btn = $('#btn-investigate');
    const input = $('#investigation-search');

    if (btn && input) {
        const doSearch = () => {
            const term = input.value.trim();
            if (term) searchLeads(term);
            else searchLeads(''); // Auto-load if empty
        };

        btn.onclick = doSearch;
        input.onkeypress = (e) => {
            if (e.key === 'Enter') doSearch();
        };
    }

    // Auto-load on init
    const container = $('#investigation-results');
    if (container && container.innerHTML.includes('Carregando')) {
        searchLeads('');
    }
}

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

// Update form submit handler
refs.clientForm?.removeEventListener('submit', refs.clientForm.submitHandler); // This won't work easily as handler is anon.
// Instead, I will modify the existing handler or just check the mode inside a new handler if I can replace it.
// Since I can't easily replace the anonymous listener, I will use a dirty trick: 
// I'll make the form submit logic check for the 'disabled' ID field or dataset.

// Wait, I can't remove the previous event listener because it was an anonymous function.
// I will just RELOAD the window or REWRITE the event listener logic by replacing the element (cloneNode) to strip listeners
// OR better: I will accept that the previous listener runs... wait.
// If the previous listener runs, it calls 'addClient' which does POST.
// If I'm editing, I need PUT.
// This is messy. I should rewrite the form submit handler in the file properly.
