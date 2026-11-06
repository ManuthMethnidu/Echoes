import type { VercelRequest } from '@vercel/node';
import { getDb, ensureSchema } from './db.js';

export function getClientIp(req: VercelRequest): string {
    // Prioritize trusted proxy headers set by edge platforms (cannot be spoofed by client)
    const vercelIp = req.headers['x-vercel-forwarded-for'];
    if (typeof vercelIp === 'string' && vercelIp.trim()) {
        return vercelIp.split(',')[0].trim();
    }
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
        return cfIp.trim();
    }
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
        return realIp.trim();
    }

    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
        // Use the last entry (closest to our proxy) if multiple exist, or the single IP
        return parts[parts.length - 1] || '127.0.0.1';
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[forwarded.length - 1].trim();
    }

    return req.socket?.remoteAddress || '127.0.0.1';
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
}

// In-memory fallback cache for hot serverless lambdas
const memoryCache = new Map<string, { points: number; expireAt: number }>();

export async function consumeRateLimit(
    key: string,
    maxPoints: number,
    windowSeconds: number
): Promise<RateLimitResult> {
    const now = Date.now();

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            INSERT INTO auth_rate_limits (key, points, expire_at)
            VALUES (${key}, 1, NOW() + (${windowSeconds} || ' seconds')::INTERVAL)
            ON CONFLICT (key) DO UPDATE SET
                points = CASE
                    WHEN auth_rate_limits.expire_at < NOW() THEN 1
                    ELSE auth_rate_limits.points + 1
                END,
                expire_at = CASE
                    WHEN auth_rate_limits.expire_at < NOW() THEN NOW() + (${windowSeconds} || ' seconds')::INTERVAL
                    ELSE auth_rate_limits.expire_at
                END
            RETURNING points, expire_at;
        `;

        if (rows.length > 0) {
            const points = Number(rows[0].points);
            const expireAt = new Date(rows[0].expire_at).getTime();
            const retryAfterSeconds = Math.max(1, Math.ceil((expireAt - now) / 1000));
            const remaining = Math.max(0, maxPoints - points);

            return {
                allowed: points <= maxPoints,
                remaining,
                retryAfterSeconds,
            };
        }
    } catch (dbErr) {
        console.warn('[RateLimit DB Fallback]', dbErr);
    }

    // In-memory fallback
    const entry = memoryCache.get(key);
    if (!entry || entry.expireAt < now) {
        memoryCache.set(key, { points: 1, expireAt: now + windowSeconds * 1000 });
        return { allowed: true, remaining: maxPoints - 1, retryAfterSeconds: windowSeconds };
    }

    entry.points += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.expireAt - now) / 1000));
    const remaining = Math.max(0, maxPoints - entry.points);

    return {
        allowed: entry.points <= maxPoints,
        remaining,
        retryAfterSeconds,
    };
}

export async function clearRateLimit(key: string): Promise<void> {
    try {
        memoryCache.delete(key);
        const sql = getDb();
        await sql`DELETE FROM auth_rate_limits WHERE key = ${key}`;
    } catch (_e) {}
}
