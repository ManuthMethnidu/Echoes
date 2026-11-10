import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db.js';

function getEnv(name: string): string | undefined {
    return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

let ephemeralSecret: Uint8Array | null = null;
export function getJwtSecret(): Uint8Array {
    const configured = getEnv('AUTH_SECRET') || getEnv('JWT_SECRET');
    if (configured) {
        return new TextEncoder().encode(configured);
    }
    if (getEnv('NODE_ENV') === 'production') {
        throw new Error('FATAL: AUTH_SECRET or JWT_SECRET must be configured in production');
    }
    if (!ephemeralSecret) {
        console.warn('[SECURITY WARNING] AUTH_SECRET is not configured. Generating ephemeral secret key for this process.');
        const rand = new Uint8Array(32);
        crypto.getRandomValues(rand);
        ephemeralSecret = rand;
    }
    return ephemeralSecret;
}
const JWT_EXPIRES_IN = '30d';

const NEON_JWKS_URL =
    getEnv('NEON_AUTH_JWKS_URL') ||
    'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/.well-known/jwks.json';

let remoteJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
try {
    if (NEON_JWKS_URL) {
        remoteJWKS = createRemoteJWKSet(new URL(NEON_JWKS_URL));
    }
} catch (e) {
    console.warn('[Neon Auth JWKS Init]', e);
}

// PBKDF2 Password Hashing using standard Web Crypto API
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    const derivedKey = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        256
    );

    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(new Uint8Array(derivedKey)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${hashHex}`;
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

export async function dummyPasswordVerification(): Promise<void> {
    try {
        await hashPassword('dummy-password-timing-defense');
    } catch {}
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [saltHex, originalHashHex] = parts;
    const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    const derivedKey = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        256
    );

    const hashHex = Array.from(new Uint8Array(derivedKey)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return constantTimeEqual(hashHex, originalHashHex);
}

export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
}

export async function createToken(user: AuthUser): Promise<string> {
    return new SignJWT({
        id: user.id,
        email: user.email,
        name: user.name || '',
        avatar: user.avatar || '',
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(JWT_EXPIRES_IN)
        .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
    try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        return {
            id: (payload.id || payload.sub) as string,
            email: (payload.email || '') as string,
            name: payload.name as string | undefined,
            avatar: (payload.avatar || payload.image) as string | undefined,
        };
    } catch {
        // Fallback 1: Verify with Neon Better Auth JWKS
        if (remoteJWKS) {
            try {
                const { payload } = await jwtVerify(token, remoteJWKS);
                return {
                    id: (payload.sub || payload.id) as string,
                    email: (payload.email || '') as string,
                    name: payload.name as string | undefined,
                    avatar: (payload.avatar || payload.image) as string | undefined,
                };
            } catch {}
        }

        // Fallback 2: Check neon_auth.session table (for Better Auth session tokens)
        try {
            const sql = getDb();
            const sessions = await sql`
                SELECT s."userId", u.email, u.name, u.image
                FROM neon_auth.session s
                JOIN neon_auth."user" u ON s."userId" = u.id
                WHERE s.token = ${token} AND s."expiresAt" > NOW()
                LIMIT 1
            `;
            if (sessions.length > 0) {
                const sess = sessions[0];
                const uid = String(sess.userId);
                const email = sess.email || '';
                const name = sess.name || email.split('@')[0];
                const avatar = sess.image || '';

                await sql`
                    INSERT INTO users (id, email, name, avatar_url)
                    VALUES (${uid}, ${email}, ${name}, ${avatar})
                    ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
                `;
                await sql`
                    INSERT INTO profiles (id, user_id, name, username, display_name, avatar_url)
                    VALUES (${uid}, ${uid}, ${name}, ${email.split('@')[0]}, ${name}, ${avatar})
                    ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url)
                `;
                await sql`
                    INSERT INTO user_sync_data (user_id, library, history, user_playlists, user_folders)
                    VALUES (${uid}, '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)
                    ON CONFLICT (user_id) DO NOTHING
                `;

                return {
                    id: uid,
                    email,
                    name,
                    avatar,
                };
            }
        } catch (_dbErr) {}

        return null;
    }
}

export async function createPasswordResetToken(userId: string, email: string, fingerprint: string): Promise<string> {
    return new SignJWT({
        id: userId,
        sub: userId,
        email,
        fingerprint,
        purpose: 'password_reset',
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(getJwtSecret());
}

export async function verifyPasswordResetToken(token: string): Promise<{ id: string; email: string; fingerprint: string } | null> {
    try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        if (payload.purpose !== 'password_reset') return null;
        return {
            id: (payload.id || payload.sub) as string,
            email: (payload.email || '') as string,
            fingerprint: (payload.fingerprint || '') as string,
        };
    } catch {
        return null;
    }
}

export function extractToken(req: VercelRequest): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7).trim();
    }

    // Also check cookies
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)mono_session=([^;]+)/);
        if (match) return decodeURIComponent(match[1]);
        const betterMatch = cookieHeader.match(/(?:^|;\s*)better-auth\.session_token=([^;]+)/);
        if (betterMatch) return decodeURIComponent(betterMatch[1]);
    }

    return null;
}

export async function getAuthenticatedUser(req: VercelRequest): Promise<AuthUser | null> {
    const token = extractToken(req);
    if (!token) return null;
    return verifyToken(token);
}

export const ALLOWED_ORIGINS = [
    'https://echoes.mteck.tech',
    'https://echos.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];

export function getSafeOrigin(req: VercelRequest): string {
    const defaultOrigin = 'https://echoes.mteck.tech';
    const rawOrigin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
    if (rawOrigin && ALLOWED_ORIGINS.includes(rawOrigin)) {
        return rawOrigin;
    }
    const forwardedHost = (req.headers?.['x-forwarded-host'] || req.headers?.host || '') as string;
    const host = forwardedHost.split(',')[0].trim();
    if (host) {
        const rawProto = req.headers?.['x-forwarded-proto'];
        const proto =
            typeof rawProto === 'string' && rawProto.split(',')[0].trim().toLowerCase() === 'http'
                ? 'http'
                : host.startsWith('localhost') || host.startsWith('127.0.0.1')
                  ? 'http'
                  : 'https';
        const candidate = `${proto}://${host}`;
        if (ALLOWED_ORIGINS.includes(candidate)) {
            return candidate;
        }
    }
    return defaultOrigin;
}

export function sanitizeCallbackUrl(rawUrl: string, defaultOrigin: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') return `${defaultOrigin}/index.html`;
    try {
        if (rawUrl.startsWith('/') && !rawUrl.startsWith('//') && !rawUrl.startsWith('/\\')) {
            return `${defaultOrigin}${rawUrl}`;
        }
        const parsed = new URL(rawUrl);
        if (ALLOWED_ORIGINS.includes(parsed.origin)) {
            return rawUrl;
        }
    } catch {}
    return `${defaultOrigin}/index.html`;
}

export const OAUTH_STATE_COOKIE_NAME = 'echos_oauth_state';

export interface OAuthStatePayload {
    flowId: string;
    nonce: string;
    provider: string;
    callbackURL?: string;
    redirectUri?: string;
    purpose: 'oauth_state';
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
    return constantTimeEqual(a, b);
}

export function generateOAuthStateNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSignedOAuthState(
    payload: Omit<OAuthStatePayload, 'purpose'>
): Promise<string> {
    return new SignJWT({
        ...payload,
        purpose: 'oauth_state',
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(getJwtSecret());
}

export async function verifySignedOAuthState(token: string): Promise<OAuthStatePayload | null> {
    if (!token || typeof token !== 'string') return null;
    try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        if (payload.purpose !== 'oauth_state') return null;
        if (typeof payload.flowId !== 'string' || typeof payload.nonce !== 'string') return null;
        return {
            flowId: payload.flowId,
            nonce: payload.nonce,
            provider: typeof payload.provider === 'string' ? payload.provider : 'google',
            callbackURL: typeof payload.callbackURL === 'string' ? payload.callbackURL : undefined,
            redirectUri: typeof payload.redirectUri === 'string' ? payload.redirectUri : undefined,
            purpose: 'oauth_state',
        };
    } catch {
        return null;
    }
}

export function appendSetCookie(res: VercelResponse, cookieValue: string) {
    const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    if (!existing) {
        res.setHeader('Set-Cookie', cookieValue);
    } else if (Array.isArray(existing)) {
        res.setHeader('Set-Cookie', [...existing.map(String), cookieValue]);
    } else {
        res.setHeader('Set-Cookie', [String(existing), cookieValue]);
    }
}

function isSecureRequest(req?: VercelRequest): boolean {
    const proto = req?.headers?.['x-forwarded-proto'];
    if (typeof proto === 'string') {
        const firstProto = proto.split(',')[0].trim().toLowerCase();
        if (firstProto === 'https') return true;
        if (firstProto === 'http') return false;
    }
    const origin = req?.headers?.origin;
    if (typeof origin === 'string') {
        if (origin.startsWith('https://')) return true;
        if (origin.startsWith('http://')) return false;
    }
    const host = (req?.headers?.['x-forwarded-host'] || req?.headers?.host || '') as string;
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
        return false;
    }
    return getEnv('NODE_ENV') === 'production';
}

export function setOAuthStateCookie(res: VercelResponse, signedToken: string, req?: VercelRequest) {
    const secureFlag = isSecureRequest(req) ? '; Secure' : '';
    const cookieStr = `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(signedToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secureFlag}`;
    appendSetCookie(res, cookieStr);
}

export function clearOAuthStateCookie(res: VercelResponse, req?: VercelRequest) {
    const secureFlag = isSecureRequest(req) ? '; Secure' : '';
    const cookieStr = `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
    appendSetCookie(res, cookieStr);
}

export function extractOAuthStateCookie(req: VercelRequest): string | null {
    const cookieHeader = req.headers?.cookie;
    if (cookieHeader && typeof cookieHeader === 'string') {
        const match = cookieHeader.match(/(?:^|;\s*)echos_oauth_state=([^;]+)/);
        if (match) return decodeURIComponent(match[1]);
    }
    const parsedCookies = (req as VercelRequest & { cookies?: Record<string, string | undefined> }).cookies;
    const cookieVal = parsedCookies?.[OAUTH_STATE_COOKIE_NAME];
    return typeof cookieVal === 'string' ? cookieVal : null;
}

export function setSessionCookie(res: VercelResponse, token: string) {
    const isProd = getEnv('NODE_ENV') === 'production';
    const cookieStr = `mono_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;
    appendSetCookie(res, cookieStr);
}

export function clearSessionCookie(res: VercelResponse) {
    const isProd = getEnv('NODE_ENV') === 'production';
    const secureFlag = isProd ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
        `mono_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
        `better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    ]);
}
