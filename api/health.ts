import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from './_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const startTime = Date.now();
    try {
        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`SELECT 1 as connected, NOW() as server_time`;
        const latencyMs = Date.now() - startTime;

        return res.status(200).json({
            status: 'healthy',
            database: 'Neon Serverless Postgres',
            connected: rows.length > 0 && rows[0].connected === 1,
            serverTime: rows[0]?.server_time,
            latencyMs,
            timestamp: new Date().toISOString(),
        });
    } catch (err: any) {
        return res.status(500).json({
            status: 'degraded',
            error: err.message,
            latencyMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
        });
    }
}
