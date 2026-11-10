import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockFlows = new Map();
let mockNeonSessions = [];
let mockUsers = [];

const mockSql = vi.fn(async (strings, ...values) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim();

    if (query.startsWith('DELETE FROM oauth_flows WHERE expires_at')) {
        return [];
    }

    if (query.startsWith('INSERT INTO oauth_flows')) {
        const [flowId, provider, stateNonce] = values;
        mockFlows.set(flowId, {
            flow_id: flowId,
            provider,
            state_nonce: stateNonce,
            created_at: new Date().toISOString(),
            expires_at: Date.now() + 15 * 60 * 1000,
        });
        return [];
    }

    if (query.startsWith('DELETE FROM oauth_flows WHERE flow_id =')) {
        const [flowId] = values;
        const row = mockFlows.get(flowId);
        if (row && row.expires_at > Date.now()) {
            mockFlows.delete(flowId);
            return [row];
        }
        return [];
    }

    if (query.includes('FROM neon_auth.session')) {
        if (query.includes('WHERE s.token =')) {
            const [token] = values;
            return mockNeonSessions.filter((s) => s.token === token);
        }
        return mockNeonSessions;
    }

    if (query.startsWith('SELECT id, email, name, avatar_url FROM users')) {
        return mockUsers;
    }

    return [];
});

vi.mock('../../api/_lib/db.js', () => ({
    getDb: () => mockSql,
    ensureSchema: vi.fn(async () => {}),
}));

import {
    OAUTH_STATE_COOKIE_NAME,
    createSignedOAuthState,
    verifySignedOAuthState,
    createToken,
    setOAuthStateCookie,
    clearOAuthStateCookie,
    setSessionCookie,
    extractOAuthStateCookie,
    getSafeOrigin,
    sanitizeCallbackUrl,
} from '../../api/_lib/auth.js';
import socialHandler from '../../api/_handlers/auth/sign-in/social.js';
import neonCallbackHandler from '../../api/_handlers/auth/neon-callback.js';
import directCallbackHandler from '../../api/_handlers/auth/callback.js';

function createMockResponse() {
    const headers = new Map();
    const res = {
        statusCode: 200,
        body: null,
        redirectUrl: null,
        headers,
        getHeader(name) {
            return headers.get(name.toLowerCase());
        },
        setHeader(name, value) {
            headers.set(name.toLowerCase(), value);
            return res;
        },
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(data) {
            res.body = data;
            return res;
        },
        send(html) {
            res.body = html;
            return res;
        },
        redirect(statusOrUrl, url) {
            if (typeof statusOrUrl === 'number') {
                res.statusCode = statusOrUrl;
                res.redirectUrl = url;
            } else {
                res.statusCode = 302;
                res.redirectUrl = statusOrUrl;
            }
            return res;
        },
    };
    return res;
}

function getSetCookiesArray(res) {
    const raw = res.getHeader('Set-Cookie');
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

function extractCookieValue(res, cookieName) {
    const cookies = getSetCookiesArray(res);
    for (const c of cookies) {
        const match = c.match(new RegExp(`^${cookieName}=([^;]+)`));
        if (match && match[1]) {
            return decodeURIComponent(match[1]);
        }
    }
    return null;
}

describe('OAuth State Protection', () => {
    beforeEach(() => {
        mockFlows.clear();
        mockNeonSessions = [];
        mockUsers = [];
        vi.clearAllMocks();
    });

    test('createSignedOAuthState and verifySignedOAuthState round-trip and reject other JWT purposes', async () => {
        const signed = await createSignedOAuthState({
            flowId: 'flow-123',
            nonce: 'nonce-abc',
            provider: 'google',
        });

        const verified = await verifySignedOAuthState(signed);
        expect(verified).not.toBeNull();
        expect(verified.flowId).toBe('flow-123');
        expect(verified.nonce).toBe('nonce-abc');
        expect(verified.provider).toBe('google');
        expect(verified.purpose).toBe('oauth_state');

        // A user session JWT must not verify as an OAuth state token
        const sessionJwt = await createToken({ id: 'u1', email: 'test@example.com' });
        expect(await verifySignedOAuthState(sessionJwt)).toBeNull();
        expect(await verifySignedOAuthState(`${signed}tamper`)).toBeNull();
    });

    test('setOAuthStateCookie preserves existing Set-Cookie headers with setSessionCookie', () => {
        const res = createMockResponse();
        const req = { headers: { 'x-forwarded-proto': 'https', host: 'echoes.mteck.tech' } };

        setOAuthStateCookie(res, 'signed-state-jwt', req);
        setSessionCookie(res, 'session-jwt');

        const cookies = getSetCookiesArray(res);
        expect(cookies.length).toBe(2);
        expect(cookies[0]).toContain(`${OAUTH_STATE_COOKIE_NAME}=signed-state-jwt`);
        expect(cookies[0]).toContain('HttpOnly');
        expect(cookies[0]).toContain('SameSite=Lax');
        expect(cookies[0]).toContain('Secure');
        expect(cookies[1]).toContain('mono_session=session-jwt');
    });

    test('getSafeOrigin supports HTTP localhost dev host and rejects arbitrary origins', () => {
        expect(getSafeOrigin({ headers: { host: 'localhost:3000' } })).toBe('http://localhost:3000');
        expect(getSafeOrigin({ headers: { host: 'localhost:5173' } })).toBe('http://localhost:5173');
        expect(getSafeOrigin({ headers: { origin: 'https://evil.attacker.com', host: 'evil.attacker.com' } })).toBe(
            'https://echoes.mteck.tech'
        );
        expect(sanitizeCallbackUrl('https://evil.attacker.com/steal', 'https://echoes.mteck.tech')).toBe(
            'https://echoes.mteck.tech/index.html'
        );
    });

    test('social initiation sets signed HttpOnly state cookie, persists nonce in DB, and appends state param', async () => {
        let capturedBody = null;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return {
                ok: true,
                status: 200,
                json: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1' }),
            };
        });

        try {
            const req = {
                method: 'POST',
                headers: { origin: 'https://echoes.mteck.tech', 'x-forwarded-proto': 'https' },
                body: { provider: 'google' },
            };
            const res = createMockResponse();

            await socialHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.url).toContain('accounts.google.com');

            // Verify callbackURL sent to Neon Auth contains flow & state
            const callbackUrl = new URL(capturedBody.callbackURL);
            const flowId = callbackUrl.searchParams.get('flow');
            const stateParam = callbackUrl.searchParams.get('state');
            expect(flowId).toBeTruthy();
            expect(stateParam).toBeTruthy();
            expect(stateParam.length).toBe(64);

            // Verify DB record matches
            const storedFlow = mockFlows.get(flowId);
            expect(storedFlow).toBeDefined();
            expect(storedFlow.state_nonce).toBe(stateParam);

            // Verify signed HttpOnly cookie matches both flowId & stateParam
            const cookieToken = extractCookieValue(res, OAUTH_STATE_COOKIE_NAME);
            expect(cookieToken).toBeTruthy();
            const parsedCookie = await verifySignedOAuthState(cookieToken);
            expect(parsedCookie.flowId).toBe(flowId);
            expect(parsedCookie.nonce).toBe(stateParam);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('neon-callback rejects requests missing flow, state, or cookie (prevents CSRF & session grab)', async () => {
        mockNeonSessions = [
            {
                userId: 'victim-id',
                token: 'victim-neon-token',
                email: 'victim@example.com',
                name: 'Victim User',
                image: '',
            },
        ];

        // 1. Missing both flow and state (previously bypassed to fallback DB session grab!)
        const resNoParams = createMockResponse();
        await neonCallbackHandler({ query: {}, headers: {} }, resNoParams);
        expect(resNoParams.statusCode).toBe(403);
        expect(resNoParams.body).toContain('Invalid OAuth State');

        // 2. Valid DB flow + params, but attacker omits victim cookie (Login CSRF)
        const flowId = 'flow-csrf-1';
        const nonce = 'nonce-csrf-1';
        mockFlows.set(flowId, {
            flow_id: flowId,
            provider: 'google',
            state_nonce: nonce,
            created_at: new Date().toISOString(),
            expires_at: Date.now() + 60000,
        });

        const resNoCookie = createMockResponse();
        await neonCallbackHandler({ query: { flow: flowId, state: nonce }, headers: {} }, resNoCookie);
        expect(resNoCookie.statusCode).toBe(403);

        // 3. Cookie belongs to a DIFFERENT flow (attacker tries to pair victim cookie with attacker flow)
        const attackerCookie = await createSignedOAuthState({
            flowId: 'other-flow',
            nonce,
            provider: 'google',
        });
        const resMismatchedCookie = createMockResponse();
        await neonCallbackHandler(
            {
                query: { flow: flowId, state: nonce },
                headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(attackerCookie)}` },
            },
            resMismatchedCookie
        );
        expect(resMismatchedCookie.statusCode).toBe(403);
    });

    test('neon-callback succeeds for valid bound flow, clears state cookie, sets session cookie, and rejects replay', async () => {
        const flowId = 'valid-flow-uuid';
        const nonce = 'valid-nonce-hex-64';
        mockFlows.set(flowId, {
            flow_id: flowId,
            provider: 'google',
            state_nonce: nonce,
            created_at: new Date().toISOString(),
            expires_at: Date.now() + 60000,
        });
        mockNeonSessions = [
            {
                userId: 'user-1',
                token: 'neon-sess-1',
                email: 'user@example.com',
                name: 'Real User',
                image: 'https://example.com/avatar.png',
            },
        ];
        mockUsers = [{ id: 'user-1', email: 'user@example.com', name: 'Real User', avatar_url: '' }];

        const cookieJwt = await createSignedOAuthState({ flowId, nonce, provider: 'google' });
        const req = {
            query: { flow: flowId, state: nonce },
            headers: {
                cookie: `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(cookieJwt)}`,
                'x-forwarded-proto': 'https',
            },
        };

        const res = createMockResponse();
        await neonCallbackHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Connected with Google');
        expect(mockFlows.has(flowId)).toBe(false);

        const cookies = getSetCookiesArray(res);
        expect(cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
        expect(cookies.some((c) => c.startsWith('mono_session=') && !c.includes('Max-Age=0'))).toBe(true);

        // Replaying the exact same callback must fail with 403
        const replayRes = createMockResponse();
        await neonCallbackHandler(req, replayRes);
        expect(replayRes.statusCode).toBe(403);
        expect(replayRes.body).toContain('Invalid Flow');
    });

    test('direct google callback rejects forged base64 state without cookie before touching Google token endpoint', async () => {
        const fetchSpy = vi.fn();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchSpy;

        try {
            const forgedState = btoa(JSON.stringify({ callbackURL: 'https://evil.com', provider: 'google' }));
            const res = createMockResponse();
            await directCallbackHandler(
                {
                    query: { code: 'auth-code-123', state: forgedState },
                    headers: { host: 'echoes.mteck.tech' },
                },
                res
            );

            expect(res.statusCode).toBe(403);
            expect(res.body).toContain('invalid_oauth_state');
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(extractOAuthStateCookie({ headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=abc` } })).toBe('abc');
            clearOAuthStateCookie(res);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
