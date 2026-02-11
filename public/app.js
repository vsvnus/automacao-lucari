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
function navigateTo(section) {
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

    // Refresh section data
    if (section === 'clients') loadClients();
    if (section === 'settings') loadSettings();
    if (section === 'activity') loadDashboardActivity();
}

// Sidebar navigation clicks
$$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.section);
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
        div.className = 'activity-item';
        div.innerHTML = `
            <div class="activity-icon-wrapper" style="background:var(--accent-primary-subtle);color:var(--accent-primary)">
                ${escapeHtml(initial)}
            </div>
            <div class="activity-content">
                <div class="activity-title">${escapeHtml(client.name)}</div>
                <div class="activity-subtitle">${isActive ? '🟢 Ativo' : '🔴 Inativo'} · ${escapeHtml(client.id)}</div>
            </div>`;
        container.appendChild(div);
    });
}

async function loadDashboardActivity() {
    const logs = await fetchActivity();
    state.activityLog = logs;

    // 1. Dashboard Preview (Top 5)
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
            logs.slice(0, 5).forEach(log => {
                dashboardContainer.appendChild(renderLogItem(log));
            });
        }
    }

    // 2. Full Activity Feed
    const feedContainer = $('#log-stream');
    if (feedContainer && state.currentSection === 'activity') {
        if (logs.length === 0) {
            feedContainer.innerHTML = `
                <div class="activity-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    <p>Nenhuma atividade registrada ainda.</p>
                </div>`;
        } else {
            feedContainer.innerHTML = '';
            logs.forEach(log => {
                feedContainer.appendChild(renderLogItem(log, true));
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

    const timestamp = new Date(log.timestamp);
    const time = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fullDate = timestamp.toLocaleDateString('pt-BR') + ' ' + time;

    // Ícone e Cor baseados no tipo
    let icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>';
    let iconClass = 'stat-icon-webhook'; // Laranja padrão
    let badge = '<span class="badge-status badge-new">Novo Lead</span>';

    if (isUpdate) {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>';
        iconClass = 'stat-icon-clients'; // Roxo/Azul
        badge = '<span class="badge-status badge-update">Atualização</span>';
    }

    if (resultType === 'error') {
        icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        iconClass = 'stat-icon-webhook'; // Vermelho (via CSS error)
        badge = '<span class="badge-status badge-error">Erro</span>';
    }

    // Status específico se houver
    if (log.status === 'Venda') {
        badge = '<span class="badge-status badge-sale">Venda</span>';
        iconClass = 'stat-icon-status'; // Verde
    }

    div.innerHTML = `
        <div class="activity-icon-wrapper ${iconClass}">
            ${icon}
        </div>
        <div class="activity-content">
            <div class="activity-title">
                ${escapeHtml(log.name || 'Sem nome')}
                ${badge}
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
                        <span style="font-size:0.75rem;color:var(--text-tertiary);">${escapeHtml(client.id)}</span>
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
        await addClient(clientData);
        closeModal();
        showToast(`Cliente "${clientData.name}" adicionado!`, 'success');
        loadClients();
        updateDashboard();
    } catch (err) {
        showToast(err.message || 'Erro ao salvar cliente', 'error');
    }
});

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
        case '3': navigateTo('activity'); break;
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
    // Load everything
    await loadSettings();
    updateDashboard();

    // Auto-refresh every 30s
    setInterval(updateDashboard, 30000);
}

init();
