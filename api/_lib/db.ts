import { neon } from '@neondatabase/serverless';

let schemaInitialized = false;

export function getDb() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL or POSTGRES_URL environment variable is missing.');
    }
    return neon(connectionString);
}

export async function ensureSchema(sql: ReturnType<typeof neon>) {
    if (schemaInitialized) return;

    try {
        await sql`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                name TEXT,
                avatar_url TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                name TEXT,
                username TEXT UNIQUE,
                display_name TEXT,
                avatar_url TEXT,
                banner TEXT,
                status TEXT,
                about TEXT,
                website TEXT,
                privacy JSONB DEFAULT '{"playlists":"public","lastfm":"public"}'::jsonb,
                lastfm_username TEXT,
                librefm_username TEXT,
                favorite_albums JSONB DEFAULT '[]'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        await sql`
            ALTER TABLE profiles 
            ADD COLUMN IF NOT EXISTS id TEXT,
            ADD COLUMN IF NOT EXISTS user_id TEXT,
            ADD COLUMN IF NOT EXISTS name TEXT,
            ADD COLUMN IF NOT EXISTS username TEXT,
            ADD COLUMN IF NOT EXISTS display_name TEXT,
            ADD COLUMN IF NOT EXISTS banner TEXT,
            ADD COLUMN IF NOT EXISTS status TEXT,
            ADD COLUMN IF NOT EXISTS about TEXT,
            ADD COLUMN IF NOT EXISTS website TEXT,
            ADD COLUMN IF NOT EXISTS privacy JSONB DEFAULT '{"playlists":"public","lastfm":"public"}'::jsonb,
            ADD COLUMN IF NOT EXISTS lastfm_username TEXT,
            ADD COLUMN IF NOT EXISTS librefm_username TEXT,
            ADD COLUMN IF NOT EXISTS favorite_albums JSONB DEFAULT '[]'::jsonb;
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS user_sync_data (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                library JSONB DEFAULT '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb,
                history JSONB DEFAULT '[]'::jsonb,
                user_playlists JSONB DEFAULT '{}'::jsonb,
                user_folders JSONB DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS device_pairings (
                id TEXT PRIMARY KEY,
                code VARCHAR(10) UNIQUE NOT NULL,
                pairing_token TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                user_id TEXT,
                session_token TEXT,
                device_info TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        await sql`
            ALTER TABLE device_pairings ADD COLUMN IF NOT EXISTS device_info TEXT;
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS themes (
                id TEXT PRIMARY KEY,
                author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                author_name TEXT,
                name TEXT NOT NULL,
                description TEXT,
                css TEXT NOT NULL,
                installs INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS auth_rate_limits (
                key TEXT PRIMARY KEY,
                points INT NOT NULL DEFAULT 1,
                expire_at TIMESTAMPTZ NOT NULL
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS oauth_flows (
                flow_id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes')
            );
        `;

        await sql`
            CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expire ON auth_rate_limits(expire_at);
        `;

        // Create index on pairing code and expiry
        await sql`
            CREATE INDEX IF NOT EXISTS idx_device_pairings_code ON device_pairings(code);
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS custom_artworks (
                id TEXT PRIMARY KEY,
                mime_type TEXT NOT NULL,
                base64 TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;

        schemaInitialized = true;
    } catch (err) {
        console.error('[DB] Schema initialization error:', err);
        // Do not crash, allow retry on next query
    }
}
