// js/accounts/config.js
import { createAuthClient } from 'better-auth/client';

const getBaseURL = () => {
    const local = localStorage.getItem('echos-auth-url') || localStorage.getItem('monochrome-auth-url');
    if (local) return local;

    if (window.__AUTH_URL__) return window.__AUTH_URL__;

    // Default to current host when hosted on Vercel or custom domain
    return typeof window !== 'undefined' ? window.location.origin : '';
};

export const AUTH_BASE_URL = getBaseURL();

export const authClient = createAuthClient({
    baseURL: AUTH_BASE_URL,
});

export { authClient as auth };
