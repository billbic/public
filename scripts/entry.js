// This file acts as the main entry point for scripts.

/**
 * Updates the header UI to reflect the user's login status.
 * @param {boolean} isLoggedIn - Whether the user is logged in.
 * @param {string} [username] - The user's username if logged in.
 */
function updateHeaderUI(isLoggedIn, username = '') {	
    const desktopAuthContainer = document.querySelector('.desktop-auth');
    const mobileAuthContainer = document.querySelector('.mobile-auth .mobile-auth-links');
	
    if (!desktopAuthContainer) {
		console.log('did not web auth');
		return};
	if (!mobileAuthContainer) {
		console.log('did not mobile auth');
		};
	//if (!desktopAuthContainer || !mobileAuthContainer) return;
	
    if (isLoggedIn && username) {
        desktopAuthContainer.innerHTML = `
            <span class="nav-link" style="color: #a0a0a0; cursor: default;">Hi, ${username}</span>
            <a href="#" id="logout-btn" class="btn btn-primary">Logout</a>
        `;
		if (mobileAuthContainer){
        mobileAuthContainer.innerHTML = `
            <span class="mobile-auth-link" style="color: #a0a0a0;">Hi, ${username}</span>
            <a href="#" id="mobile-logout-btn" class="btn btn-primary mobile-signup">Logout</a>
        `;}

        document.getElementById('logout-btn').addEventListener('click', handleLogout);
        if (mobileAuthContainer){
		document.getElementById('mobile-logout-btn').addEventListener('click', handleLogout);}
    } else {
        desktopAuthContainer.innerHTML = `
            <a href="/login.html" class="nav-link">Login</a>
            <a href="/signup.html" class="btn btn-primary">Sign Up</a>
        `;
        mobileAuthContainer.innerHTML = `
            <a href="/login.html" class="mobile-auth-link">Login</a>
            <a href="/signup.html" class="btn btn-primary mobile-signup">Sign Up</a>
        `;
    }
}

/**
 * Handles the logout process by calling the server to clear the auth cookie.
 */
async function handleLogout(event) {
    event.preventDefault();
    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Logout request failed:', error);
    } finally {
        localStorage.removeItem('username');
        window.location.assign('/index.html');
    }
}

/**
 * Checks the user's authentication status with the server and updates the UI.
 */
async function checkAndUpdateLoginState() {
    try {
        const response = await fetch('/api/check-auth', {
            method: 'GET',
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.loggedIn && result.username) {
            localStorage.setItem('username', result.username);
            updateHeaderUI(true, result.username);
        } else {
            localStorage.removeItem('username');
            updateHeaderUI(false);
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('username');
        updateHeaderUI(false);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const cachedUsername = localStorage.getItem('username');
    if (cachedUsername) {
        updateHeaderUI(true, cachedUsername);
    }
    checkAndUpdateLoginState();

    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    const menuIconOpen = document.getElementById('menu-icon-open');
    const menuIconClose = document.getElementById('menu-icon-close');

    if (mobileMenuButton && mobileMenu && menuIconOpen && menuIconClose) {
        mobileMenuButton.addEventListener('click', () => {
            const isMenuOpen = mobileMenuButton.getAttribute('aria-expanded') === 'true';
            mobileMenuButton.setAttribute('aria-expanded', String(!isMenuOpen));
            mobileMenu.classList.toggle('hidden');
            menuIconOpen.classList.toggle('hidden');
            menuIconClose.classList.toggle('hidden');
        });
    }

    const statusIndicator = document.getElementById('server-status');
    const authForm = document.querySelector('.auth-form');

    async function checkServerStatus() {
        if (!statusIndicator) return;
        const statusTextElement = statusIndicator.querySelector('.status-text');

        try {
            const response = await fetch('/api/db-status');
            const result = await response.json();

            if (response.ok) {
                statusIndicator.classList.remove('status-error');
                statusIndicator.classList.add('status-ok');
                statusTextElement.textContent = result.message;
            } else {
                statusIndicator.classList.remove('status-ok');
                statusIndicator.classList.add('status-error');
                const errorMessage = result.message || 'Database Connection Failed';
                statusTextElement.innerHTML = `${errorMessage} <a href="/database-troubleshooting.html" class="status-link">Troubleshoot</a>`;
            }
        } catch (error) {
            statusIndicator.classList.remove('status-ok');
            statusIndicator.classList.add('status-error');
            statusTextElement.innerHTML = `Error: Cannot reach the server. <a href="/database-troubleshooting.html" class="status-link">Troubleshoot</a>`;
            console.error('Server status check failed:', error);
        }
    }

    if (authForm) {
        checkServerStatus();

        authForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const isSignup = window.location.pathname.includes('signup');
            const url = isSignup ? '/api/signup' : '/api/login';

            const formData = new FormData(authForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (response.ok) {
                    if (isSignup) {
                        alert(result.message);
                        window.location.href = '/login.html';
                    } else {
                        if (result.username) {
                            localStorage.setItem('username', result.username);
                        }
                        window.location.href = '/index.html';
                    }
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Form submission error:', error);
                alert('An unexpected error occurred. Please try again.');
            }
        });
    }
});
