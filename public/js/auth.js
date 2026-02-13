/**
 * Auth Service — Session-based (PostgreSQL)
 * Substitui a autenticação via Supabase
 */

const auth = {
    /**
     * Login com email e senha
     */
    login: async (email, password) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao fazer login');
        return data;
    },

    /**
     * Logout
     */
    logout: async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    },

    /**
     * Retorna o usuário atual ou null
     */
    getUser: async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) return null;
            const data = await res.json();
            return data.user;
        } catch {
            return null;
        }
    },

    /**
     * Verifica se o usuário está autenticado.
     * Redireciona para /login.html se não estiver.
     */
    checkAuth: async (redirectIfUnauth = true) => {
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) {
                if (redirectIfUnauth) window.location.href = '/login.html';
                return null;
            }
            const data = await res.json();
            return data.user;
        } catch {
            if (redirectIfUnauth) window.location.href = '/login.html';
            return null;
        }
    },

    /**
     * Setup inicial (cria primeiro admin)
     */
    setup: async (email, password, name) => {
        const res = await fetch('/api/auth/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro no setup');
        return data;
    }
};

window.authService = auth;
