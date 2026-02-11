/**
 * Login Page Logic
 */

// UI Transitions
function showLogin() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const loginScreen = document.getElementById('login-screen');

    welcomeScreen.classList.add('fade-out');

    setTimeout(() => {
        welcomeScreen.style.display = 'none';
        loginScreen.style.display = 'block';
        // Small delay to allow display:block to apply before adding opacity class
        setTimeout(() => {
            loginScreen.classList.add('fade-in');
        }, 50);
    }, 400); // Wait for transition out
}

function showWelcome() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const loginScreen = document.getElementById('login-screen');

    loginScreen.classList.remove('fade-in');

    setTimeout(() => {
        loginScreen.style.display = 'none';
        welcomeScreen.style.display = 'block';

        setTimeout(() => {
            welcomeScreen.classList.remove('fade-out');
        }, 50);
    }, 300);
}

// Form Handling
document.addEventListener('DOMContentLoaded', async () => {
    // Check if already logged in
    const sb = await window.authService.init();
    if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
            window.location.href = '/';
        }
    }

    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const btnSubmit = document.getElementById('btn-submit');
    const errorMsg = document.getElementById('login-error');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value;
        const password = passwordInput.value;

        // Reset state
        errorMsg.style.display = 'none';
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span class="loading-dots">Entrando...</span>';

        try {
            await window.authService.login(email, password);
            // Login success - redirect handled by success or manual redirect
            window.location.href = '/';
        } catch (error) {
            console.error('Login error:', error);
            errorMsg.textContent = error.message === 'Invalid login credentials'
                ? 'E-mail ou senha incorretos.'
                : 'Erro ao fazer login: ' + error.message;
            errorMsg.style.display = 'block';
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Entrar no Sistema';
        }
    });
});
