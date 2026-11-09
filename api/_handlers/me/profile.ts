import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getAuthenticatedUser } from '../../_lib/auth.js';
import { sanitizeString, sanitizeAvatarUrl, sanitizeUrl, containsProfanity, sanitizeUsername, isBlockedOrSusUrl } from '../../_lib/sanitize.js';

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

        // Fetch current profile to check cooldowns and detect actual changes
        const profileRows = await sql`
            SELECT id, user_id, username, display_name, username_changed_at, display_name_changed_at
            FROM profiles
            WHERE user_id = ${user.id}
            LIMIT 1
        `;
        const currentProfile = profileRows[0] || {};

        const body = req.body || {};
        const {
            username,
            display_name,
            avatar_url,
            banner,
            banner_url,
            status,
            about,
            website,
            privacy,
            lastfm_username,
            librefm_username,
            favorite_albums,
        } = body;

        // Support both banner and banner_url (sent by sync-manager)
        const rawBanner = banner !== undefined ? banner : banner_url;

        // 1. Validate profanity/bad words
        if (username && containsProfanity(username)) {
            return res.status(400).json({ error: 'Username contains prohibited words' });
        }
        if (display_name && containsProfanity(display_name)) {
            return res.status(400).json({ error: 'Display name contains prohibited language' });
        }
        if (about && containsProfanity(about)) {
            return res.status(400).json({ error: 'About me contains prohibited language' });
        }
        if (status && containsProfanity(status)) {
            return res.status(400).json({ error: 'Status contains prohibited language' });
        }
        if (website && containsProfanity(website)) {
            return res.status(400).json({ error: 'Website contains prohibited language' });
        }

        // 2. Validate sus/adult websites
        if (website && isBlockedOrSusUrl(website)) {
            return res.status(400).json({ error: 'Website link is blocked or contains suspicious content' });
        }
        if (rawBanner && isBlockedOrSusUrl(rawBanner)) {
            return res.status(400).json({ error: 'Banner link is blocked or contains suspicious content' });
        }
        if (avatar_url && isBlockedOrSusUrl(avatar_url)) {
            return res.status(400).json({ error: 'Avatar link is blocked or contains suspicious content' });
        }

        // 3. Username validation & 30-day rate limit
        let cleanUsername: string | undefined = undefined;
        let updateUsernameChanged = false;
        if (username !== undefined) {
            cleanUsername = sanitizeUsername(username) || undefined;
            if (!cleanUsername) {
                return res.status(400).json({ error: 'Username must be 1-40 characters (alphanumeric, underscore, hyphen, dot)' });
            }

            if (currentProfile.username && cleanUsername.toLowerCase() !== currentProfile.username.toLowerCase()) {
                const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
                if (currentProfile.username_changed_at) {
                    const elapsed = Date.now() - new Date(currentProfile.username_changed_at).getTime();
                    if (elapsed < thirtyDaysMs) {
                        const daysLeft = Math.ceil((thirtyDaysMs - elapsed) / (24 * 60 * 60 * 1000));
                        return res.status(400).json({
                            error: `You can only change your username once every 30 days. Please wait ${daysLeft} more day(s).`
                        });
                    }
                }

                // Check username uniqueness
                const existing = await sql`
                    SELECT user_id FROM profiles
                    WHERE LOWER(username) = LOWER(${cleanUsername}) AND user_id != ${user.id}
                    LIMIT 1
                `;
                if (existing.length > 0) {
                    return res.status(400).json({ error: 'Username is already taken' });
                }

                updateUsernameChanged = true;
            }
        }

        // 4. Display name validation (limit: 25 chars) & 7-day rate limit
        let cleanDisplayName: string | undefined = undefined;
        let updateDisplayNameChanged = false;
        if (display_name !== undefined) {
            cleanDisplayName = sanitizeString(display_name, 25);
            if (currentProfile.display_name && cleanDisplayName !== currentProfile.display_name) {
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (currentProfile.display_name_changed_at) {
                    const elapsed = Date.now() - new Date(currentProfile.display_name_changed_at).getTime();
                    if (elapsed < sevenDaysMs) {
                        const daysLeft = Math.ceil((sevenDaysMs - elapsed) / (24 * 60 * 60 * 1000));
                        return res.status(400).json({
                            error: `You can only change your display name once every 7 days. Please wait ${daysLeft} more day(s).`
                        });
                    }
                }
                updateDisplayNameChanged = true;
            }
        }

        // 5. Enforce URL-only avatar validation
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

        // 6. Validate banner URL
        let cleanBannerUrl: string | null | undefined = undefined;
        if (rawBanner !== undefined) {
            if (rawBanner === null || rawBanner === '') {
                cleanBannerUrl = null;
            } else {
                const validated = sanitizeUrl(rawBanner);
                if (!validated) {
                    return res.status(400).json({ error: 'Banner must be a valid HTTP or HTTPS image URL' });
                }
                cleanBannerUrl = validated;
            }
        }

        // 7. Validate website URL
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

        const cleanAbout = about !== undefined ? sanitizeString(about, 1000) : undefined;
        const cleanStatus = status !== undefined ? sanitizeString(status, 300) : undefined;
        const cleanLastfm = lastfm_username !== undefined ? sanitizeString(lastfm_username, 50) : undefined;
        const cleanLibrefm = librefm_username !== undefined ? sanitizeString(librefm_username, 50) : undefined;

        const updatedRows = await sql`
            UPDATE profiles
            SET
                username = CASE WHEN ${cleanUsername !== undefined} THEN ${cleanUsername} ELSE username END,
                username_changed_at = CASE WHEN ${updateUsernameChanged} THEN NOW() ELSE username_changed_at END,
                display_name = CASE WHEN ${display_name !== undefined} THEN ${cleanDisplayName ?? null} ELSE display_name END,
                display_name_changed_at = CASE WHEN ${updateDisplayNameChanged} THEN NOW() ELSE display_name_changed_at END,
                avatar_url = CASE WHEN ${cleanAvatarUrl !== undefined} THEN ${cleanAvatarUrl} ELSE avatar_url END,
                banner = CASE WHEN ${cleanBannerUrl !== undefined} THEN ${cleanBannerUrl} ELSE banner END,
                status = CASE WHEN ${status !== undefined} THEN ${cleanStatus ?? null} ELSE status END,
                about = CASE WHEN ${about !== undefined} THEN ${cleanAbout ?? null} ELSE about END,
                website = CASE WHEN ${cleanWebsite !== undefined} THEN ${cleanWebsite} ELSE website END,
                privacy = CASE WHEN ${privacy ? JSON.stringify(privacy) : null}::text IS NOT NULL THEN ${privacy ? JSON.stringify(privacy) : null}::jsonb ELSE privacy END,
                lastfm_username = CASE WHEN ${lastfm_username !== undefined} THEN ${cleanLastfm ?? null} ELSE lastfm_username END,
                librefm_username = CASE WHEN ${librefm_username !== undefined} THEN ${cleanLibrefm ?? null} ELSE librefm_username END,
                favorite_albums = CASE WHEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::text IS NOT NULL THEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::jsonb ELSE favorite_albums END,
                updated_at = NOW()
            WHERE user_id = ${user.id}
            RETURNING *
        `;

        // If avatar_url was updated, also update in users table for sync consistency
        if (cleanAvatarUrl !== undefined) {
            await sql`
                UPDATE users
                SET avatar_url = ${cleanAvatarUrl}
                WHERE id = ${user.id}
            `;
        }

        const updatedProfile = updatedRows[0] || {};

        return res.status(200).json({
            ok: true,
            username: updatedProfile.username,
            display_name: updatedProfile.display_name,
            avatar_url: updatedProfile.avatar_url,
            banner: updatedProfile.banner,
            banner_url: updatedProfile.banner,
            status: updatedProfile.status,
            about: updatedProfile.about,
            website: updatedProfile.website,
            privacy: updatedProfile.privacy,
            favorite_albums: updatedProfile.favorite_albums,
            username_changed_at: updatedProfile.username_changed_at,
            display_name_changed_at: updatedProfile.display_name_changed_at,
        });
    } catch (err: any) {
        console.error('[API /me/profile error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
