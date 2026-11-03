import type { VercelRequest, VercelResponse } from '@vercel/node';

// Import all endpoint handlers from _handlers
import healthHandler from './_handlers/health.js';
import syncHandler from './_handlers/sync.js';
import authSignUpEmailHandler from './_handlers/auth/sign-up/email.js';
import authSignInEmailHandler from './_handlers/auth/sign-in/email.js';
import authSignInSocialHandler from './_handlers/auth/sign-in/social.js';
import authGetSessionHandler from './_handlers/auth/get-session.js';
import authSignOutHandler from './_handlers/auth/sign-out.js';
import authCallbackHandler from './_handlers/auth/callback.js';
import meIndexHandler from './_handlers/me/index.js';
import meProfileHandler from './_handlers/me/profile.js';
import pairInitHandler from './_handlers/pair/init.js';
import pairStatusHandler from './_handlers/pair/status.js';
import pairApproveHandler from './_handlers/pair/approve.js';
import pairVerifyHandler from './_handlers/pair/verify.js';
import themesHandler from './_handlers/themes/index.js';
import ytSearchHandler from './_handlers/yt/search.js';
import ytStreamHandler from './_handlers/yt/stream.js';
import ytRadioHandler from './_handlers/yt/radio.js';
import ytPlaylistHandler from './_handlers/yt/playlist.js';
import ytUserPlaylistsHandler from './_handlers/yt/user-playlists.js';
import ytUserPlaylistTracksHandler from './_handlers/yt/user-playlist-tracks.js';
import ytProxyStreamHandler from './_handlers/yt/proxy-stream.js';
import ytDownloadHandler from './_handlers/yt/download.js';
import importSpotifyHandler from './_handlers/import/spotify.js';
import userProfileHandler from './_handlers/users/[username].js';
import publicPlaylistHandler from './_handlers/public/playlists/[id].js';

type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<any> | any;

const STATIC_ROUTES: Record<string, ApiHandler> = {
    '': healthHandler,
    'health': healthHandler,
    'sync': syncHandler,
    'auth/sign-up/email': authSignUpEmailHandler,
    'auth/sign-in/email': authSignInEmailHandler,
    'auth/sign-in/social': authSignInSocialHandler,
    'auth/get-session': authGetSessionHandler,
    'auth/sign-out': authSignOutHandler,
    'auth/callback': authCallbackHandler,
    'auth/callback/google': authCallbackHandler,
    'me': meIndexHandler,
    'me/profile': meProfileHandler,
    'pair/init': pairInitHandler,
    'pair/status': pairStatusHandler,
    'pair/approve': pairApproveHandler,
    'pair/verify': pairVerifyHandler,
    'themes': themesHandler,
    'yt/search': ytSearchHandler,
    'yt/stream': ytStreamHandler,
    'yt/radio': ytRadioHandler,
    'yt/playlist': ytPlaylistHandler,
    'yt/user-playlists': ytUserPlaylistsHandler,
    'yt/user-playlist-tracks': ytUserPlaylistTracksHandler,
    'yt/proxy-stream': ytProxyStreamHandler,
    'yt/download': ytDownloadHandler,
    'import/spotify': importSpotifyHandler,
};

function extractRoute(req: VercelRequest): string {
    // 1. From __route query parameter injected by vercel.json rewrite
    if (typeof req.query?.__route === 'string') {
        return req.query.__route.trim();
    }
    if (Array.isArray(req.query?.__route)) {
        return req.query.__route.join('/').trim();
    }

    // 2. From Vercel routing headers
    const vercelPath = (req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-rewrite-url'] || req.headers['x-forwarded-uri']) as string | undefined;
    if (vercelPath) {
        const clean = vercelPath.split('?')[0];
        if (clean.startsWith('/api/')) {
            return clean.slice(5);
        }
        if (clean === '/api') {
            return '';
        }
    }

    // 3. From req.url
    if (req.url) {
        const clean = req.url.split('?')[0];
        if (clean.startsWith('/api/') && !clean.startsWith('/api/index')) {
            return clean.slice(5);
        }
        if (clean === '/api' || clean === '/api/') {
            return '';
        }
    }

    return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-Requested-With');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        let route = extractRoute(req);
        // Normalize: remove leading and trailing slashes
        route = route.replace(/^\/+|\/+$/g, '');

        // Initialize req.query if undefined
        if (!req.query) {
            (req as any).query = {};
        }

        // Clean internal __route param so handlers don't see it
        if ('__route' in req.query) {
            delete req.query.__route;
        }

        // If req.url has query params not in req.query (e.g. in test environments), populate them
        if (req.url && req.url.includes('?')) {
            const search = req.url.split('?')[1];
            const sp = new URLSearchParams(search);
            for (const [k, v] of sp.entries()) {
                if (req.query[k] === undefined && k !== '__route') {
                    req.query[k] = v;
                }
            }
        }

        // 1. Direct match
        const staticHandler = STATIC_ROUTES[route];
        if (staticHandler) {
            return await staticHandler(req, res);
        }

        // 2. Dynamic route: users/:username
        if (route.startsWith('users/')) {
            const rawUsername = route.slice('users/'.length);
            if (rawUsername) {
                req.query.username = decodeURIComponent(rawUsername);
                return await userProfileHandler(req, res);
            }
        }

        // 3. Dynamic route: public/playlists/:id
        if (route.startsWith('public/playlists/')) {
            const rawId = route.slice('public/playlists/'.length);
            if (rawId) {
                req.query.id = decodeURIComponent(rawId);
                return await publicPlaylistHandler(req, res);
            }
        }

        // Not Found
        return res.status(404).json({
            error: `API route not found: /api/${route}`,
        });
    } catch (err: any) {
        console.error('[API Router Error]', err);
        if (!res.headersSent) {
            return res.status(500).json({
                error: err.message || 'Internal Server Error',
            });
        }
    }
}
