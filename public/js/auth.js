/**
 * Auth Service - Supabase Integration
 */
let supabaseClient = null;

async function initSupabase() {
    if (supabaseClient) return supabaseClient;

    try {
        // Fetch config from server to avoid hardcoding keys in frontend build if we were building, 
        // but here we fetch them to be safe and centralize config in env vars on server.
        const response = await fetch('/api/config');
        const config = await response.json();

        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            console.error('Supabase config missing');
            return null;
        }

        if (window.supabase && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        } else {
            console.error('Supabase library not loaded');
            return null;
        }
        return supabaseClient;
    } catch (error) {
        console.error('Failed to init Supabase:', error);
        return null;
    }
}

const auth = {
    /**
     * Initialize Auth Service
     */
    init: async () => {
        return await initSupabase();
    },

    /**
     * Login with Email and Password
     */
    login: async (email, password) => {
        if (!supabaseClient) await initSupabase();

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;
        return data;
    },

    /**
     * Logout
     */
    logout: async () => {
        if (!supabaseClient) await initSupabase();
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        window.location.href = '/login.html';
    },

    /**
     * Get Current User
     */
    getUser: async () => {
        if (!supabaseClient) await initSupabase();
        const { data: { user } } = await supabaseClient.auth.getUser();
        return user;
    },

    /**
     * Check if user is authenticated, redirect if not
     * @param {boolean} redirectIfUnauth - Auto redirect to login if false
     */
    checkAuth: async (redirectIfUnauth = true) => {
        if (!supabaseClient) await initSupabase();

        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session && redirectIfUnauth) {
            window.location.href = '/login.html';
            return null;
        }

        // Setup auth state listener
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || (!session && redirectIfUnauth)) {
                window.location.href = '/login.html';
            }
        });

        return session?.user;
    }
};

// Expose to window
window.authService = auth;
