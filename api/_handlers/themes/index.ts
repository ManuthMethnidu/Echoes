import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getAuthenticatedUser } from '../../_lib/auth.js';
import { sanitizeString, sanitizeCss } from '../../_lib/sanitize.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const sql = getDb();
    await ensureSchema(sql);

    if (req.method === 'GET') {
        try {
            const rows = await sql`
                SELECT id, name, description, css, author_name, installs, created_at
                FROM themes
                ORDER BY installs DESC, created_at DESC
                LIMIT 100
            `;
            return res.status(200).json({ items: rows });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { name, description, css } = req.body || {};
            const cleanName = sanitizeString(name, 50);
            const cleanDescription = sanitizeString(description, 200);
            const cleanCss = sanitizeCss(css, 50000);

            if (!cleanName || !cleanCss) {
                return res.status(400).json({
                    error: 'Theme name and safe CSS are required. External URLs, @import, expressions, and scripts are forbidden.',
                });
            }

            const themeId = 'thm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            await sql`
                INSERT INTO themes (id, author_id, author_name, name, description, css)
                VALUES (${themeId}, ${user.id}, ${sanitizeString(user.name || user.email, 60)}, ${cleanName}, ${cleanDescription}, ${cleanCss})
            `;

            return res.status(200).json({ id: themeId, ok: true });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
