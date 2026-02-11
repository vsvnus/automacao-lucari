# 📄 Guia de Entrega (Handover) - Automação de Leads

Este documento explica como transferir o controle total do sistema para a agência/chefe e como gerenciar a ferramenta no dia a dia.

---

## 1. Como dar controle total (Transferência)

Para que seu chefe tenha 100% de posse, ele precisa de acesso a 3 lugares:

### A. Meta for Developers (Webhook e API)
1. No [Meta for Developers](https://developers.facebook.com/), ele deve entrar em **Settings** -> **App Roles**.
2. Clique em **Add Administrators** e adicione o Facebook dele.
3. Agora ele pode gerenciar os webhooks, o App Secret e ver os logs no Meta.

### B. Google Cloud (Planilhas)
1. Ele deve ter acesso à conta que criou a **Service Account**.
2. O arquivo `config/google-credentials.json` é a "chave" de acesso. Guarde-o em local seguro.
3. Todas as planilhas dos clientes devem ser compartilhadas com o email da Service Account (ex: `automacao-wpp@...iam.gserviceaccount.com`) como **Editor**.

### C. Hospedagem (Onde o código roda)
Para o sistema ficar 24h online, recomendo hospedar em um destes (seu chefe precisará criar uma conta):
- **Railway.app** (Muito simples, conecta com seu GitHub e pronto)
- **Render.com** (Ótima alternativa gratuita/barata)
- **VPS (DigitalOcean/Linode)** (Para quem quer controle total via Linux)

---

## 2. A Interface Administrativa (Dashboard)

Agora o sistema tem uma cara profissional! Seu chefe não precisa de você para cadastrar clientes.

**Como acessar:**
Basta abrir o endereço do servidor no navegador (ex: `http://localhost:3000` ou `https://sua-url.com`).

**O que ele pode fazer lá:**
- **Visualizar estatísticas:** Ver quantos clientes estão ativos e o tempo que o sistema está online.
- **Cadastrar Clientes:** Clicar em "+ Novo Cliente" e preencher os IDs (WABA, Phone ID e Spreadsheet ID).
- **Remover Clientes:** Excluir clientes que não fazem mais parte da agência.
- **Monitorar:** Ver se os leads estão chegando em tempo real (Logs).

---

## 3. Como cobrar o cliente (Modelo de Negócio)

Como você está entregando uma **infraestrutura multi-cliente**, seu chefe pode:
1. **Cobrar uma taxa de setup:** Pela configuração inicial.
2. **Cobrar uma mensalidade (SaaS):** Por manter o robô de leads rodando e a planilha organizada em tempo real.
3. **Escalabilidade:** Ele pode ter 50 clientes rodando no mesmo servidor, apenas adicionando os IDs no Dashboard.

---

## 4. Segurança Importante

- **Acesso ao Dashboard:** Por enquanto o Dashboard é aberto para quem tiver a URL. Em uma versão 2.0, podemos adicionar uma senha simples de login.
- **HTTPS:** Ao colocar em produção, use sempre **HTTPS**. O Meta não aceita webhooks em sites `http://` comuns.

---

**Pronto para o próximo nível! 🚀**
Caso queira adicionar login com senha no dashboard ou filtros por data nos leads, é só me avisar.
