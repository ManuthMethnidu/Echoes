import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db.js';

const JWT_SECRET_STRING = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'echos-vercel-jwt-fallback-secret-key-32b';
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);
const JWT_EXPIRES_IN = '30d';

const NEON_JWKS_URL =
    process.env.NEON_AUTH_JWKS_URL ||
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
    return hashHex === originalHashHex;
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
        .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
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
        .sign(JWT_SECRET);
}

export async function verifyPasswordResetToken(token: string): Promise<{ id: string; email: string; fingerprint: string } | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
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

export function setSessionCookie(res: VercelResponse, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieStr = `mono_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookieStr);
}

export function clearSessionCookie(res: VercelResponse) {
    res.setHeader('Set-Cookie', 'mono_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
