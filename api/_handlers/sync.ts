import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../_lib/db.js';
import { getAuthenticatedUser } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: Please log in to sync your library' });
        }

        const sql = getDb();
        await ensureSchema(sql);

        if (req.method === 'GET') {
            // Load user sync data and profile
            const [syncRows, profileRows] = await Promise.all([
                sql`SELECT library, history, user_playlists, user_folders FROM user_sync_data WHERE user_id = ${user.id} LIMIT 1`,
                sql`SELECT * FROM profiles WHERE user_id = ${user.id} LIMIT 1`,
            ]);

            let syncData = syncRows[0];
            if (!syncData) {
                // Initialize empty row if none exists
                await sql`
                    INSERT INTO user_sync_data (user_id, library, history, user_playlists, user_folders)
                    VALUES (
                        ${user.id},
                        '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb,
                        '[]'::jsonb,
                        '{}'::jsonb,
                        '{}'::jsonb
                    )
                    ON CONFLICT (user_id) DO NOTHING
                `;
                syncData = {
                    library: { tracks: {}, albums: {}, artists: {}, playlists: {}, mixes: {} },
                    history: [],
                    user_playlists: {},
                    user_folders: {},
                };
            }

            const profile = profileRows[0] || {};

            return res.status(200).json({
                appUserId: user.id,
                profile: {
                    username: profile.username || user.email.split('@')[0],
                    display_name: profile.display_name || user.name || user.email.split('@')[0],
                    avatar_url: profile.avatar_url || null,
                    banner: profile.banner || null,
                    status: profile.status || null,
                    about: profile.about || null,
                    website: profile.website || null,
                    privacy: profile.privacy || { playlists: 'public', lastfm: 'public' },
                    lastfm_username: profile.lastfm_username || null,
                    librefm_username: profile.librefm_username || null,
                    favorite_albums: profile.favorite_albums || [],
                },
                library: syncData.library || { tracks: {}, albums: {}, artists: {}, playlists: {}, mixes: {} },
                history: syncData.history || [],
                userPlaylists: syncData.user_playlists || {},
                userFolders: syncData.user_folders || {},
            });
        }

        if (req.method === 'PATCH' || req.method === 'POST') {
            const body = req.body || {};
            // Enforce 2MB payload ceiling to prevent DoS / storage exhaustion
            const payloadStr = JSON.stringify(body);
            if (payloadStr.length > 2 * 1024 * 1024) {
                return res.status(413).json({ error: 'Sync payload exceeds maximum allowed size (2MB)' });
            }

            const { library, history, userPlaylists, userFolders, favoriteAlbums } = body;

            // Make sure the row exists first
            await sql`
                INSERT INTO user_sync_data (user_id, library, history, user_playlists, user_folders)
                VALUES (
                    ${user.id},
                    '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb,
                    '[]'::jsonb,
                    '{}'::jsonb,
                    '{}'::jsonb
                )
                ON CONFLICT (user_id) DO NOTHING
            `;

            // Update user_sync_data
            if (library !== undefined) {
                await sql`
                    UPDATE user_sync_data
                    SET library = ${JSON.stringify(library)}::jsonb, updated_at = NOW()
                    WHERE user_id = ${user.id}
                `;
            }

            if (userPlaylists !== undefined) {
                await sql`
                    UPDATE user_sync_data
                    SET user_playlists = ${JSON.stringify(userPlaylists)}::jsonb, updated_at = NOW()
                    WHERE user_id = ${user.id}
                `;
            }

            if (userFolders !== undefined) {
                await sql`
                    UPDATE user_sync_data
                    SET user_folders = ${JSON.stringify(userFolders)}::jsonb, updated_at = NOW()
                    WHERE user_id = ${user.id}
                `;
            }

            if (history !== undefined) {
                await sql`
                    UPDATE user_sync_data
                    SET history = ${JSON.stringify(history)}::jsonb, updated_at = NOW()
                    WHERE user_id = ${user.id}
                `;
            }

            if (favoriteAlbums !== undefined) {
                await sql`
                    UPDATE profiles
                    SET favorite_albums = ${JSON.stringify(favoriteAlbums)}::jsonb, updated_at = NOW()
                    WHERE user_id = ${user.id}
                `;
            }

            return res.status(200).json({ ok: true, syncedAt: Date.now() });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (err: any) {
        console.error('[Sync API error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error during sync' });
    }
}
