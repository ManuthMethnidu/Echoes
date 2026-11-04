import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getAuthenticatedUser } from '../../_lib/auth.js';
import { sanitizeString, sanitizeAvatarUrl, sanitizeUrl } from '../../_lib/sanitize.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const sql = getDb();
        await ensureSchema(sql);

        const body = req.body || {};
        const {
            display_name,
            avatar_url,
            banner,
            status,
            about,
            website,
            privacy,
            lastfm_username,
            librefm_username,
            favorite_albums,
        } = body;

        // Enforce URL-only avatar validation
        let cleanAvatarUrl: string | null | undefined = undefined;
        if (avatar_url !== undefined) {
            if (avatar_url === null || avatar_url === '') {
                cleanAvatarUrl = null;
            } else {
                const validated = sanitizeAvatarUrl(avatar_url);
                if (!validated) {
                    return res.status(400).json({ error: 'Avatar must be a valid HTTP or HTTPS image URL' });
                }
                cleanAvatarUrl = validated;
            }
        }

        // Validate banner URL
        let cleanBannerUrl: string | null | undefined = undefined;
        if (banner !== undefined) {
            if (banner === null || banner === '') {
                cleanBannerUrl = null;
            } else {
                const validated = sanitizeUrl(banner);
                if (!validated) {
                    return res.status(400).json({ error: 'Banner must be a valid HTTP or HTTPS image URL' });
                }
                cleanBannerUrl = validated;
            }
        }

        // Validate website URL
        let cleanWebsite: string | null | undefined = undefined;
        if (website !== undefined) {
            if (website === null || website === '') {
                cleanWebsite = null;
            } else {
                const validated = sanitizeUrl(website);
                if (!validated) {
                    return res.status(400).json({ error: 'Website must be a valid HTTP or HTTPS URL' });
                }
                cleanWebsite = validated;
            }
        }

        const cleanDisplayName = display_name !== undefined ? sanitizeString(display_name, 60) : undefined;
        const cleanAbout = about !== undefined ? sanitizeString(about, 1000) : undefined;
        const cleanStatus = status !== undefined ? sanitizeString(status, 300) : undefined;
        const cleanLastfm = lastfm_username !== undefined ? sanitizeString(lastfm_username, 50) : undefined;
        const cleanLibrefm = librefm_username !== undefined ? sanitizeString(librefm_username, 50) : undefined;

        await sql`
            UPDATE profiles
            SET
                display_name = COALESCE(${cleanDisplayName ?? null}, display_name),
                avatar_url = CASE WHEN ${cleanAvatarUrl !== undefined} THEN ${cleanAvatarUrl} ELSE avatar_url END,
                banner = CASE WHEN ${cleanBannerUrl !== undefined} THEN ${cleanBannerUrl} ELSE banner END,
                status = COALESCE(${cleanStatus ?? null}, status),
                about = COALESCE(${cleanAbout ?? null}, about),
                website = CASE WHEN ${cleanWebsite !== undefined} THEN ${cleanWebsite} ELSE website END,
                privacy = CASE WHEN ${privacy ? JSON.stringify(privacy) : null}::text IS NOT NULL THEN ${privacy ? JSON.stringify(privacy) : null}::jsonb ELSE privacy END,
                lastfm_username = COALESCE(${cleanLastfm ?? null}, lastfm_username),
                librefm_username = COALESCE(${cleanLibrefm ?? null}, librefm_username),
                favorite_albums = CASE WHEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::text IS NOT NULL THEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::jsonb ELSE favorite_albums END,
                updated_at = NOW()
            WHERE user_id = ${user.id}
        `;

        // If avatar_url was updated, also update in users table for sync consistency
        if (cleanAvatarUrl !== undefined) {
            await sql`
                UPDATE users
                SET avatar_url = ${cleanAvatarUrl}
                WHERE id = ${user.id}
            `;
        }

        return res.status(200).json({ ok: true });
    } catch (err: any) {
        console.error('[API /me/profile error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
