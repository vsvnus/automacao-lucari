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

### Git Workflow (OBRIGATÓRIO — leia antes de qualquer alteração)

Este projeto é administrado por agentes de IA. O processo abaixo **DEVE** ser seguido à risca para evitar conflitos de merge e perda de trabalho.

#### Regra de Ouro
> **NUNCA edite código na branch `main`.** Todo trabalho começa e acontece na branch `staging`.

#### Processo Completo — Feature ou Ajuste

```
FASE 1 — PREPARAÇÃO (antes de escrever qualquer código)
──────────────────────────────────────────────────────
1. git checkout staging
2. git pull origin staging          ← pega últimas mudanças do staging remoto
3. git pull origin main             ← sincroniza staging com produção
   (se houver conflito aqui, resolva ANTES de começar)
4. git push origin staging          ← staging agora está alinhado com main

FASE 2 — DESENVOLVIMENTO
──────────────────────────────────────────────────────
5. Faça todas as alterações na branch staging
6. git add <arquivos específicos>   ← NUNCA use "git add ." ou "git add -A"
7. git commit -m "descrição clara"
8. git push origin staging

FASE 3 — DEPLOY STAGING
──────────────────────────────────────────────────────
9.  SSH no servidor: ssh -i ~/.ssh/hetzner_lucari root@178.156.164.91
10. bash /opt/staging/deploy.sh
11. Testar em staging.vin8n.online
12. Se houver bug, volte à FASE 2 e corrija

FASE 4 — PROMOÇÃO PARA PRODUÇÃO
──────────────────────────────────────────────────────
13. git checkout main
14. git pull origin main             ← SEMPRE puxar antes de mergear
15. git merge staging                ← merge (NÃO rebase) staging em main
    (merge deve ser limpo se FASE 1 foi seguida)
16. git push origin main
17. Coolify auto-deploys em ~1 min
18. git checkout staging             ← volte para staging imediatamente
```

#### Regras Críticas

| Regra | Por quê |
|-------|---------|
| Sempre começar com `git checkout staging` + `git pull` | Evita trabalhar sobre versão desatualizada |
| Sincronizar staging com main ANTES de começar (`git pull origin main` na staging) | Evita divergência entre branches |
| Usar `git merge` (não `git rebase`) para staging→main | Rebase reescreve histórico e causa conflitos em cascata |
| Nunca usar `git push --force` | Destrói histórico de outros contribuidores |
| Nunca fazer commit direto na main | Main só recebe merges de staging |
| Usar `git add <arquivo>` específico, nunca `git add .` | Evita commitar .env, credenciais, arquivos temporários |
| Voltar para staging após push na main | Próximo trabalho já começa no lugar certo |

#### Resolução de Conflitos

Se um conflito aparecer em qualquer etapa:
1. **PARE** — não force ou ignore
2. Identifique o arquivo com conflito (`git status`)
3. Abra o arquivo e resolva manualmente (manter as duas versões se fizerem sentido)
4. `git add <arquivo resolvido>` → `git commit`
5. Continue o processo

**Se o conflito é muito complexo** (muitos arquivos, mudanças entrelaçadas):
1. `git merge --abort` ou `git rebase --abort`
2. Avise o usuário sobre a situação
3. Não tente resolver forçadamente — peça orientação

#### Checklist Pré-Push (para o agente de IA)

Antes de cada `git push`, verifique:
- [ ] Estou na branch correta? (`git branch --show-current`)
- [ ] Puxei as últimas mudanças? (`git pull origin <branch>`)
- [ ] Os arquivos commitados são apenas os relevantes? (`git diff --cached --name-only`)
- [ ] Nenhum arquivo sensível está incluído? (`.env`, `credentials`, `*.key`)

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
