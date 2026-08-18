# Automação Lucari

<!-- Ficha (RG) do projeto · padrão Esteira de Projetos. Fonte da verdade do estado deste repo.
     Vive na raiz da pasta de execução, viaja com o código. Preencher toda linha. -->

- **Slug:** cliente-automacao-lucari
- **Tipo:** cliente
- **O que é:** Automação de leads do WhatsApp da Lucari · webhook do Tintim registra leads nas planilhas Google Sheets de cada cliente (multi-tenant, abas mensais, status de venda) + dashboard · Node + Supabase
- **Dono/cliente:** Lucari
- **Status:** 🟢 vivo
- **Repo:** https://github.com/vsvnus/automacao-lucari.git
- **Tronco:** main
- **Deploy/infra:** servidor Hetzner da Lucari (178.156.164.91) · produção via Coolify (auto-deploy no push pra main) · staging manual em /opt/staging/dashboard
- **URL staging:** https://staging.vin8n.online
- **URL produção:** https://dashboard.vin8n.online
- **Ponte AIOS:** lucari/

## Estado atual

Em produção capturando leads e alimentando as planilhas. Branch fix/reconciliation-loop está checked out com trabalho não mergeado: fix da query de phones (18/05) e scripts one-off de correção da Rotta preservados (17/08). Falta decidir o merge dessa branch na main.
