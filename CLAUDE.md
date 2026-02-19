# Lucari Ecosystem — Infrastructure Guide

## Server
- **IP**: 178.156.164.91 (Hetzner)
- **SSH**: `ssh -i ~/.ssh/hetzner_lucari root@178.156.164.91`
- **Coolify Panel**: http://178.156.164.91:8000
- **Domain**: *.vin8n.online (Traefik proxy with Let's Encrypt)

## Projects

| Project | Repo (`github.com/vsvnus/`) | Prod URL | Staging URL |
|---------|----------------------------|----------|-------------|
| Dashboard + Automação Planilhas | `automacao-lucari` | dashboard.vin8n.online | staging.vin8n.online |
| SDR de IA (atendimento WhatsApp) | `sdr-ia-lucari` | sdr.vin8n.online | staging-sdr.vin8n.online |
| Calculadora Salário Maternidade | `calculadora-lucari` | calc.vin8n.online | — |
| Automação Relatórios (Reportei) | `relatorio-lucari` | porta 3003 (sem domínio) | — |
| Evolution API (WhatsApp) | terceiro (evoapicloud) | evolution.vin8n.online | — |

## Architecture

### Production (managed by Coolify)
- Coolify auto-deploys from `main` branch when code is pushed
- Container names are random hashes (ex: `mg4ko84ks4os0c44k4socokk-new`)
- Env vars are configured in Coolify panel — they persist across restarts
- **NEVER edit production containers directly** — changes are lost on redeploy

### Staging (managed by deploy.sh)
- Code lives in `/opt/staging/{dashboard,sdr}/` on the server
- Uses `staging` branch (not main)
- Env files: `/opt/staging/.env.dashboard` and `/opt/staging/.env.sdr`
- Deploy: `bash /opt/staging/deploy.sh`
- Container names are fixed: `dashboard-staging`, `sdr-staging`

### Workflow
```
1. Edit code on staging branch
2. git push origin staging
3. bash /opt/staging/deploy.sh
4. Test on staging.vin8n.online
5. git checkout main && git merge staging && git push origin main
6. Coolify auto-deploys to production
```

## Databases (PostgreSQL on coolify-db container)

| Database | Project | User |
|----------|---------|------|
| `leads_automation` | Dashboard PROD | leads_user |
| `leads_automation_staging` | Dashboard STAGING | leads_user |
| `sdr_ia` | SDR PROD | sdr_user |
| `sdr_ia_staging` | SDR STAGING | sdr_user |
| `evolution` | Evolution API | coolify |

Access: `docker exec coolify-db psql -U leads_user -d leads_automation`

## Key Services & Integrations

### Google Sheets (Dashboard)
- Service account: `automacao-wpp@automacao-planilha-487020.iam.gserviceaccount.com`
- PROD: credentials via `GOOGLE_CREDENTIALS_JSON` env var (set in Coolify)
- STAGING: credentials via file `config/google-credentials.json` (in .gitignore)
- The sheetsService has graceful fallback: B64 env → JSON env → file

### Tintim (Webhook source for leads)
- Sends webhooks to `POST /webhook/tintim`
- Events: `lead.create` (new lead), `lead.update` (status change)
- Each client has a `tintim_instance_id` that maps to `account.code` in the payload
- Only Meta Ads / Google Ads leads go to spreadsheet; organic WhatsApp is filtered

### Evolution API (WhatsApp for SDR)
- Container: `w0s0cowks8scc8004sswcss4-065145829442`
- Internal URL: `http://w0s0cowks8scc8004sswcss4-065145829442:8080`
- API Key: configured in SDR env vars

## File Structure (Dashboard)

```
src/
├── server.js          — Express server, routes, auth, health endpoint
├── webhookHandler.js  — Tintim webhook processing (new leads + status updates)
├── sheetsService.js   — Google Sheets API (insert/update leads, monthly tabs)
├── pgService.js       — PostgreSQL (logging, clients, dashboard stats, alerts)
├── clientManager.js   — Client config loader (from PostgreSQL)
├── supabaseService.js — Legacy (not actively used)
└── utils/
    ├── logger.js      — Winston logger
    ├── formatter.js   — Phone/date formatting (BR)
    └── validator.js   — Tintim payload validation
public/
├── index.html         — Dashboard SPA
├── app.js             — Dashboard frontend logic
├── alerts.js          — Client alert system
├── style.css          — All styles
└── login.html         — Login page
```

## Common Issues & Solutions

### "Google Sheets não disponível"
- Check `GOOGLE_CREDENTIALS_JSON` env var or `config/google-credentials.json` file
- The JSON must contain `client_email` field — empty `{}` will fail silently
- Health endpoint shows: `GET /health` → `integrations.googleSheets`

### Leads not going to spreadsheet
- Check if leads are organic (filtered by design — only Meta/Google Ads go through)
- Check `docker logs <container>` for `🚫 Lead orgânico ignorado`
- Check `leads_log` table for `processing_result` column

### Duplicate leads
- Idempotency window is 30 seconds (`checkDuplicateWebhook`)
- Depends on `webhook_events` table having records
- Tintim sometimes sends the same webhook multiple times

## Owner
- **Vinicius Pimentel** (vinnipimentelgestor@gmail.com)
- GitHub: vsvnus
- Company: Lucari
