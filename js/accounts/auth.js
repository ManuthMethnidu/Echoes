// js/accounts/auth.js
import { AUTH_BASE_URL, authClient } from './config.js';

const PRIMARY_AUTH_TOKEN_KEY = 'echos-auth-token';
const LEGACY_AUTH_TOKEN_KEY = 'monochrome-auth-token';
const NATIVE_OAUTH_HANDLED_URLS_KEY = 'echos-native-oauth-handled-urls';
const NATIVE_OAUTH_SCHEME = 'echos';
const NATIVE_OAUTH_HOST = 'auth-callback';
let authToken = localStorage.getItem(PRIMARY_AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) || '';

function normalizeUser(user) {
    if (!user) return null;
    return { ...user, $id: user.id };
}

export function getAuthToken() {
    return authToken;
}

function storeAuthToken(token) {
    authToken = token || '';
    if (authToken) {
        localStorage.setItem(PRIMARY_AUTH_TOKEN_KEY, authToken);
        localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, authToken);
    } else {
        localStorage.removeItem(PRIMARY_AUTH_TOKEN_KEY);
        localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    }
}

function clearAuthToken() {
    authToken = '';
    localStorage.removeItem(PRIMARY_AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
}

export function resetSessionData() {
    clearAuthToken();
    try {
        localStorage.removeItem('cached_user_profile');
        localStorage.removeItem('party_guest_profile');
        localStorage.removeItem('party_member_guest');
        localStorage.removeItem('echos_yt_token');
        localStorage.removeItem('search-history');

        // Clear user-specific party tokens and cached profiles
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
                key &&
                (key.startsWith('party_user_profile_') ||
                    key.startsWith('party_member_user_') ||
                    key.startsWith('party_host_token_') ||
                    key.startsWith('party_guest_member_') ||
                    key.startsWith('echos_party_host_') ||
                    key.startsWith('playlist-sort-'))
            ) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_e) {}
}

function isCapacitorNative() {
    return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web');
}

function getCapacitorPlugin(name) {
    return window.Capacitor?.Plugins?.[name];
}

async function getBrowserPlugin() {
    const plugin = getCapacitorPlugin('Browser');
    if (plugin?.open) return plugin;

    try {
        const { Browser } = await import('@capacitor/browser');
        return Browser;
    } catch {
        return plugin;
    }
}

async function getAppPlugin() {
    const plugin = getCapacitorPlugin('App');
    if (plugin?.addListener) return plugin;

    try {
        const { App } = await import('@capacitor/app');
        return App;
    } catch {
        return plugin;
    }
}

function getNativeOAuthCallbackURL() {
    return `${AUTH_BASE_URL}/api/native/oauth/callback`;
}

function getOAuthParams(urlString = window.location.href) {
    let url;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    const params = new URLSearchParams(url.search);
    if (!params.size && url.hash?.startsWith('#')) {
        const hashParams = new URLSearchParams(url.hash.slice(1));
        if (hashParams.size) return hashParams;
    }
    return params;
}

function hasOAuthParams(params) {
    return !!(
        params &&
        (params.has('oauth') ||
            params.has('userId') ||
            params.has('secret') ||
            params.has('token') ||
            params.has('session_token') ||
            params.has('error'))
    );
}

function getHandledNativeOAuthUrls() {
    try {
        const urls = JSON.parse(sessionStorage.getItem(NATIVE_OAUTH_HANDLED_URLS_KEY) || '[]');
        return Array.isArray(urls) ? urls : [];
    } catch {
        return [];
    }
}

function wasNativeOAuthUrlHandled(url) {
    return getHandledNativeOAuthUrls().includes(url);
}

function markNativeOAuthUrlHandled(url) {
    if (!url) return;
    const urls = getHandledNativeOAuthUrls().filter((value) => value !== url);
    urls.unshift(url);
    sessionStorage.setItem(NATIVE_OAUTH_HANDLED_URLS_KEY, JSON.stringify(urls.slice(0, 10)));
}

function getNativeOAuthError(params) {
    if (!params?.has('error')) return null;
    const error = params.get('error') || 'unknown_error';
    const description = params.get('error_description');
    return description ? `${error}: ${description}` : error;
}

function getErrorMessage(data, fallback) {
    if (data?.error?.message) return data.error.message;
    if (typeof data?.error === 'string') return data.error;
    if (data?.message) return data.message;
    if (typeof data === 'string' && data.trim()) return data;
    return fallback;
}

function findOAuthUrl(data, response) {
    const candidates = [
        data?.url,
        data?.data?.url,
        data?.redirectURL,
        data?.redirectUrl,
        data?.data?.redirectURL,
        data?.data?.redirectUrl,
        response?.redirected ? response.url : null,
    ];

    return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
}

async function readAuthResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();

    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
async function openNativeOAuthUrl(url) {
    const Browser = await getBrowserPlugin();
    if (Browser?.open) {
        await Browser.open({ url, presentationStyle: 'fullscreen' });
        return;
    }

    const opened = window.open(url, '_system');
    if (!opened) {
        window.location.href = url;
    }
}

async function closeNativeOAuthBrowser() {
    try {
        await (await getBrowserPlugin())?.close?.();
    } catch {
        // Browser.close throws on Android when no custom tab is active.
    }
}

async function getSessionFromBearerToken() {
    const token = getAuthToken();
    if (!token) return null;

    const response = await fetch(`${AUTH_BASE_URL}/api/me`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
        clearAuthToken();
        return null;
    }
    if (!response.ok) throw new Error(`Session check failed: ${response.status}`);
    return response.json();
}

async function getCurrentSession() {
    try {
        const { data: session } = await authClient.getSession();
        if (session?.user) {
            if (session.session?.token) {
                storeAuthToken(session.session.token);
            }
            return session;
        }
    } catch (_e) {}

    if (getAuthToken()) {
        const bearerSession = await getSessionFromBearerToken().catch(() => null);
        if (bearerSession?.user) return bearerSession;
    }

    return null;
}

export class AuthManager {
    constructor() {
        this.user = null;
        this.authListeners = [];
        this.authRefreshId = 0;

        // Listen for OAuth completion from popup / child window
        if (typeof window !== 'undefined') {
            window.addEventListener('message', async (event) => {
                if (event.data?.type === 'echos:auth-success') {
                    const token = event.data.token;
                    if (token) {
                        storeAuthToken(token);
                        await this.refreshAuthState();
                    }
                }
            });

            window.addEventListener('storage', async (event) => {
                if (event.key === PRIMARY_AUTH_TOKEN_KEY || event.key === LEGACY_AUTH_TOKEN_KEY) {
                    if (event.newValue && event.newValue !== authToken) {
                        authToken = event.newValue;
                        await this.refreshAuthState();
                    }
                }
            });
        }

        this.setupNativeOAuthListener().catch(console.error);
        this.init().catch(console.error);
    }

    async init() {
        const params = getOAuthParams();
        if (this.applyOAuthParams(params)) {
            window.history.replaceState({}, '', window.location.pathname);
        }

        await this.refreshAuthState();
    }

    applyOAuthParams(params) {
        if (!hasOAuthParams(params)) return false;

        const nativeOAuthError = getNativeOAuthError(params);
        if (nativeOAuthError) {
            console.error('Native OAuth failed:', nativeOAuthError);
            alert(`Login failed: ${nativeOAuthError}`);
            return true;
        }

        if (params.has('error')) {
            const err = params.get('error');
            const details = params.get('details');
            const msg = details ? `${err}: ${details}` : err;
            console.error('OAuth failed:', msg);
            alert(`Google sign in failed: ${msg}`);
            return true;
        }

        if (params.has('secret')) {
            storeAuthToken(params.get('secret'));
        } else if (params.has('token')) {
            storeAuthToken(params.get('token'));
        } else if (params.has('session_token')) {
            storeAuthToken(params.get('session_token'));
        }
        if (params.has('yt_token')) {
            localStorage.setItem('echos_yt_token', params.get('yt_token'));
        }
        return true;
    }

    setUser(user) {
        this.user = normalizeUser(user);
        this.updateUI(this.user);
        this.authListeners.forEach((listener) => listener(this.user));
    }

    async refreshAuthState() {
        const refreshId = ++this.authRefreshId;
        const applyUser = (user) => {
            if (refreshId !== this.authRefreshId) return false;
            this.setUser(user);
            return true;
        };

        try {
            const session = await getCurrentSession();
            applyUser(session?.user);
        } catch (error) {
            if (refreshId !== this.authRefreshId) return;
            console.warn('Session check failed:', error);
            this.setUser(null);
        }
    }

    async setupNativeOAuthListener() {
        if (!isCapacitorNative()) return;

        const App = await getAppPlugin();
        if (!App?.addListener) return;

        App.addListener('appUrlOpen', async (event) => {
            await this.handleNativeOAuthCallback(event?.url);
        });

        const launchEvent = await App.getLaunchUrl?.();
        if (launchEvent?.url) this.handleNativeOAuthCallback(launchEvent.url);
    }

    async handleNativeOAuthCallback(url) {
        if (!url || wasNativeOAuthUrlHandled(url)) return false;

        const params = getOAuthParams(url);
        if (!hasOAuthParams(params)) return false;

        markNativeOAuthUrlHandled(url);
        await closeNativeOAuthBrowser();

        const shouldReload = params.has('secret') && !params.has('error');
        this.applyOAuthParams(params);
        window.history.replaceState({}, '', window.location.pathname);

        if (shouldReload) {
            window.location.reload();
            return true;
        }

        await this.refreshAuthState();
        return true;
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async _signInSocial(provider) {
        if (provider === 'google') {
            return this.signInWithGoogle();
        }
        try {
            const isNative = isCapacitorNative();
            const authUrl = `${AUTH_BASE_URL}/api/auth/sign-in/social?provider=${encodeURIComponent(provider)}`;
            if (isNative) {
                await openNativeOAuthUrl(authUrl);
                return;
            }

            const width = 540;
            const height = 680;
            const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
            const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
            const authWindow = window.open(
                authUrl,
                `echos_${provider}_oauth`,
                `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes,resizable=yes`
            );
            if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
                window.open(authUrl, '_blank');
            }
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
        }
    }

    async signInWithGoogle() {
        const isNative = isCapacitorNative();
        if (isNative) {
            const authUrl = `${AUTH_BASE_URL}/api/auth/sign-in/social?provider=google`;
            openNativeOAuthUrl(authUrl);
            return;
        }

        const width = 540;
        const height = 680;
        const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
        const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);

        // Open in new tab / popup window SYNCHRONOUSLY to prevent browser popup blockers
        const authWindow = window.open(
            'about:blank',
            'echos_google_oauth',
            `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes,resizable=yes`
        );

        if (authWindow) {
            try {
                authWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Connecting to Google...</title>
    <style>
        body {
            background-color: #0c0d0e;
            color: #f3f4f6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 1rem;
            box-sizing: border-box;
        }
        .container { text-align: center; }
        .spinner {
            width: 38px;
            height: 38px;
            border: 3px solid rgba(255, 255, 255, 0.12);
            border-top: 3px solid #ffffff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 16px auto;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        h3 { margin: 0 0 6px 0; font-size: 1.1rem; font-weight: 600; }
        p { color: #9ca3af; font-size: 0.88rem; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h3>Connecting to Google...</h3>
        <p>Please wait a moment</p>
    </div>
</body>
</html>`);
            } catch (_e) {}
        }

        try {
            // Fetch direct OAuth initiation URL via POST API call (never intercepted by Service Worker navigation route)
            const res = await fetch(`${AUTH_BASE_URL}/api/auth/sign-in/social`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'google' }),
            });
            const data = await res.json().catch(() => null);

            if (data?.url) {
                if (authWindow && !authWindow.closed) {
                    authWindow.location.href = data.url;
                } else {
                    window.open(data.url, '_blank');
                }
            } else {
                throw new Error(data?.error?.message || 'Failed to initiate Google sign-in');
            }
        } catch (error) {
            console.error('Login initiation failed:', error);
            if (authWindow) {
                try { authWindow.close(); } catch (_e) {}
            }
            alert(`Login initiation failed: ${error.message || error}`);
            return;
        }

        // Active listener & poller to detect completion without user needing to reload
        const initialToken = getAuthToken();
        const pollTimer = setInterval(async () => {
            const currentToken = localStorage.getItem(PRIMARY_AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_AUTH_TOKEN_KEY);
            if (currentToken && currentToken !== initialToken) {
                clearInterval(pollTimer);
                authToken = currentToken;
                await this.refreshAuthState();
            }
            if (authWindow && authWindow.closed) {
                clearInterval(pollTimer);
                setTimeout(() => this.refreshAuthState(), 600);
            }
        }, 1000);

        setTimeout(() => clearInterval(pollTimer), 300000);
    }

    async signInWithEmail(email, password) {
        try {
            const res = await fetch(`${AUTH_BASE_URL}/api/auth/sign-in/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), password }),
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);

            if (res.status === 429) {
                const msg = data?.error?.message || 'Too many login attempts. Please wait before trying again.';
                alert(msg);
                throw new Error(msg);
            }

            if (!res.ok || data?.error) {
                const msg = data?.error?.message || `Login failed (${res.status})`;
                alert(`Login failed: ${msg}`);
                throw new Error(msg);
            }

            storeAuthToken(data.token);
            this.user = normalizeUser(data.user);
            this.updateUI(this.user);
            const authModal = document.getElementById('email-auth-modal');
            if (authModal) {
                authModal.classList.remove('active');
            }
            this.authListeners.forEach((listener) => {
                try {
                    listener(this.user);
                } catch (e) {
                    console.error('[Auth Listener Error]:', e);
                }
            });
            return this.user;
        } catch (error) {
            console.error('Email Login failed:', error);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        try {
            const res = await fetch(`${AUTH_BASE_URL}/api/auth/sign-up/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    password,
                    name: email.split('@')[0],
                }),
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);

            if (res.status === 429) {
                const msg = data?.error?.message || 'Too many sign-up attempts. Please wait before creating another account.';
                alert(msg);
                throw new Error(msg);
            }

            if (!res.ok || data?.error) {
                const msg = data?.error?.message || `Sign up failed (${res.status})`;
                alert(`Sign Up failed: ${msg}`);
                throw new Error(msg);
            }

            storeAuthToken(data.token);
            this.user = normalizeUser(data.user);
            this.updateUI(this.user);
            const authModal = document.getElementById('email-auth-modal');
            if (authModal) {
                authModal.classList.remove('active');
            }
            this.authListeners.forEach((listener) => {
                try {
                    listener(this.user);
                } catch (e) {
                    console.error('[Auth Listener Error]:', e);
                }
            });
            return this.user;
        } catch (error) {
            console.error('Sign Up failed:', error);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            const res = await fetch(`${AUTH_BASE_URL}/api/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    redirectTo: window.location.origin + '/reset-password',
                }),
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);

            if (!res.ok || data?.error) {
                const msg = data?.error?.message || data?.error || `Failed to send reset email (${res.status})`;
                throw new Error(msg);
            }

            if (data?.resetUrl && (!data.emailSent || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                const proceed = confirm(`Password reset link generated for ${email}!\n\nWould you like to open the reset page now?`);
                if (proceed) {
                    window.location.href = data.resetUrl;
                    return;
                }
            }

            alert(`Password reset instructions sent to ${email}. Please check your inbox.`);
        } catch (error) {
            console.error('Password reset failed:', error);
            alert(`Failed to send reset email: ${error.message || error}`);
            throw error;
        }
    }

    async resetPassword(token, password, confirmPassword) {
        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }
        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }
        try {
            const res = await fetch(`${AUTH_BASE_URL}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    newPassword: password,
                }),
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);

            if (!res.ok || data?.error) {
                const msg = data?.error?.message || data?.error || `Password reset failed (${res.status})`;
                throw new Error(msg);
            }

            return data;
        } catch (error) {
            console.error('Password reset failed:', error);
            throw error;
        }
    }

    async signOut() {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Remote logout failed:', error);
        } finally {
            resetSessionData();
            try {
                const { db } = await import('../db.js');
                await db.clearUserData();
            } catch (e) {
                console.warn('[signOut] Failed to clear user database stores:', e);
            }

            this.user = null;
            this.updateUI(null);
            this.authListeners.forEach((listener) => {
                try {
                    listener(null);
                } catch (e) {
                    console.error('[signOut] Listener error:', e);
                }
            });

            window.dispatchEvent(new CustomEvent('library-changed'));
            window.dispatchEvent(new CustomEvent('history-changed'));

            if (window.__AUTH_GATE__) {
                window.location.href = '/login';
            } else {
                window.location.reload();
            }
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('auth-connect-btn');
        const clearDataBtn = document.getElementById('auth-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const emailContainer = document.getElementById('email-auth-container');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');
        const githubBtn = document.getElementById('auth-github-btn');
        const discordBtn = document.getElementById('auth-discord-btn');

        if (user) {
            const authModal = document.getElementById('email-auth-modal');
            if (authModal) {
                authModal.classList.remove('active');
            }
        }

        if (!connectBtn) return;

        if (window.__AUTH_GATE__) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = user ? `Signed in as ${user.email}` : 'Signed in';

            const accountPage = document.getElementById('page-account');
            if (accountPage) {
                const title = accountPage.querySelector('.section-title');
                if (title) title.textContent = 'Account';
                accountPage.querySelectorAll('.account-content > p, .account-content > div').forEach((el) => {
                    if (el.id !== 'auth-status' && el.id !== 'auth-buttons-container') {
                        el.style.display = 'none';
                    }
                });
            }

            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn) {
                const pbFromEnv = !!window.__POCKETBASE_URL__;
                if (pbFromEnv) {
                    const settingItem = customDbBtn.closest('.setting-item');
                    if (settingItem) settingItem.style.display = 'none';
                }
            }

            return;
        }

        if (user) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();

            if (clearDataBtn) clearDataBtn.style.display = 'block';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = `Signed in as ${user.email}`;
        } else {
            connectBtn.textContent = 'Connect with Google';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithGoogle();

            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'inline-block';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = 'Sync your library across devices';
        }
    }
}

export const authManager = new AuthManager();
