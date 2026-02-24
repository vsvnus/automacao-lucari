// ============================================================
// Alertas de Clientes Sem Leads
// ============================================================

async function loadClientAlerts() {
    try {
        const res = await fetch("/api/alerts/clients-without-leads?days=2");
        const alerts = await res.json();

        const container = document.getElementById("dashboard-alerts");
        if (!container) return;

        if (!alerts || alerts.length === 0) {
            container.style.display = "none";
            return;
        }

        container.style.display = "block";
        container.innerHTML = alerts.map(alert => {
            const daysText = alert.last_lead_date
                ? "Sem leads há " + alert.days_without_leads + " dias"
                : "Nenhum lead recebido ainda";

            return `
            <div class="alert-card alert-danger">
                <div class="alert-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <div class="alert-content">
                    <div class="alert-title">${alert.name}</div>
                    <div class="alert-message">${daysText}</div>
                    <div class="alert-meta">
                        <span class="badge badge-sm badge-warning">Instância: ${alert.tintim_instance_id.substring(0, 8)}...</span>
                    </div>
                </div>
                <button class="btn-alert-action" onclick="navigateToLogs('${alert.slug}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    Investigar
                </button>
                <button class="btn-dismiss" onclick="dismissAlert(this)" title="Fechar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `}).join("");
    } catch (e) {
        console.error("Erro ao carregar alertas:", e);
    }
}

function dismissAlert(btn) {
    const card = btn.closest(".alert-card");
    card.style.animation = "fadeOut 0.2s ease-out forwards";
    setTimeout(() => {
        card.remove();
        const container = document.getElementById("dashboard-alerts");
        if (container && container.children.length === 0) {
            container.style.display = "none";
        }
    }, 200);
}

function navigateToLogs(clientSlug) {
    navigateTo("logs");
    setTimeout(() => {
        const clientSelect = document.getElementById("log-client-select");
        if (clientSelect && clientSlug) {
            clientSelect.value = clientSlug;
            searchLeads("");
        }
    }, 100);
}

// Load alerts on page load
document.addEventListener("DOMContentLoaded", () => {
    loadClientAlerts();
});
