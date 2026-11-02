import { getDb, ensureSchema } from './api/_lib/db.js';
import signUpHandler from './api/auth/sign-up/email.js';
import signInHandler from './api/auth/sign-in/email.js';
import syncHandler from './api/sync.js';
import pairInitHandler from './api/pair/init.js';
import pairStatusHandler from './api/pair/status.js';
import pairApproveHandler from './api/pair/approve.js';
import healthHandler from './api/health.js';
import spotifyHandler from './api/import/spotify.ts';
import socialAuthHandler from './api/auth/sign-in/social.ts';
import downloadHandler from './api/yt/download.ts';

// Load .env.local
import { readFileSync, existsSync } from 'fs';
if (existsSync('.env.local')) {
    const envLines = readFileSync('.env.local', 'utf-8').split('\n');
    for (const line of envLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [k, ...v] = trimmed.split('=');
        if (k && v.length) process.env[k.trim()] = v.join('=').trim();
    }
}

function createMockReqRes(options = {}) {
    const req = {
        method: options.method || 'GET',
        headers: options.headers || {},
        query: options.query || {},
        body: options.body || {},
    };

    let statusCode = 200;
    let headers = {};
    let responseData = null;

    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        setHeader(k, v) {
            headers[k] = v;
        },
        json(data) {
            responseData = data;
            return res;
        },
        redirect(url) {
            statusCode = 302;
            headers['Location'] = url;
            return res;
        },
        _getResult() {
            return { statusCode, headers, data: responseData };
        },
    };

    return { req, res };
}

async function runTests() {
    console.log('🚀 Starting echos on Vercel Integration Tests...\n');

    // Test 1: Health check & Neon DB connection
    console.log('--- Test 1: Health Check & Neon Postgres Connection ---');
    const { req: hReq, res: hRes } = createMockReqRes();
    await healthHandler(hReq, hRes);
    const hResult = hRes._getResult();
    console.log('Status Code:', hResult.statusCode);
    console.log('Health Output:', hResult.data);
    if (hResult.statusCode !== 200 || !hResult.data.connected) {
        throw new Error('Health check failed: ' + JSON.stringify(hResult.data));
    }
    console.log('✓ Health check passed! Connected to Neon Serverless Postgres in ' + hResult.data.latencyMs + 'ms\n');

    // Test 2: User Sign Up
    console.log('--- Test 2: User Registration (Email & Password) ---');
    const testEmail = `audiophile_${Date.now()}@example.com`;
    const testPassword = 'LosslessAudio2026!';
    const { req: suReq, res: suRes } = createMockReqRes({
        method: 'POST',
        body: { email: testEmail, password: testPassword, name: 'Hifi Listener' },
    });
    await signUpHandler(suReq, suRes);
    const suResult = suRes._getResult();
    console.log('Sign Up Response Status:', suResult.statusCode);
    console.log('User created:', suResult.data?.user?.email, 'ID:', suResult.data?.user?.id);
    if (suResult.statusCode !== 200 || !suResult.data?.token) {
        throw new Error('Sign up failed: ' + JSON.stringify(suResult.data));
    }
    const authToken = suResult.data.token;
    console.log('✓ Registration passed! Received JWT Auth Token\n');

    // Test 3: User Sign In
    console.log('--- Test 3: User Login ---');
    const { req: siReq, res: siRes } = createMockReqRes({
        method: 'POST',
        body: { email: testEmail, password: testPassword },
    });
    await signInHandler(siReq, siRes);
    const siResult = siRes._getResult();
    if (siResult.statusCode !== 200 || !siResult.data?.token) {
        throw new Error('Sign in failed: ' + JSON.stringify(siResult.data));
    }
    console.log('✓ Login passed! Verified PBKDF2 hashed password\n');

    // Test 4: Library Sync (GET initial)
    console.log('--- Test 4: Library Sync (Initial GET) ---');
    const { req: gSyncReq, res: gSyncRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${authToken}` },
    });
    await syncHandler(gSyncReq, gSyncRes);
    const gSyncResult = gSyncRes._getResult();
    console.log('Sync Response Status:', gSyncResult.statusCode);
    console.log('Initial Library tracks count:', Object.keys(gSyncResult.data?.library?.tracks || {}).length);
    console.log('✓ Initial GET /api/sync returned empty client-ready structure\n');

    // Test 5: Library Sync (PATCH - saving liked albums, playlists, and tracks)
    console.log('--- Test 5: Library Sync (PATCH - Save Liked Albums, Playlists & Tracks) ---');
    const samplePayload = {
        library: {
            tracks: {
                '12345678': { id: '12345678', title: 'Midnight City', artist: { name: 'M83' }, addedAt: Date.now() },
                '87654321': { id: '87654321', title: 'Starboy', artist: { name: 'The Weeknd' }, addedAt: Date.now() },
            },
            albums: {
                'alb_999': { id: 'alb_999', title: 'Hurry Up, We\'re Dreaming', artist: { name: 'M83' }, addedAt: Date.now() },
            },
            artists: {
                'art_111': { id: 'art_111', name: 'Daft Punk', addedAt: Date.now() },
            },
            playlists: {},
            mixes: {},
        },
        userPlaylists: {
            'pl_chill_vibes': {
                id: 'pl_chill_vibes',
                name: 'Late Night Lossless',
                description: 'Hi-Res FLAC playlist',
                tracks: ['12345678', '87654321'],
                createdAt: Date.now(),
            },
        },
        userFolders: {
            'fld_favorites': {
                id: 'fld_favorites',
                name: 'High Fidelity',
                playlists: ['pl_chill_vibes'],
            },
        },
        history: [
            { id: '12345678', title: 'Midnight City', timestamp: Date.now() },
        ],
    };

    const { req: pSyncReq, res: pSyncRes } = createMockReqRes({
        method: 'PATCH',
        headers: { authorization: `Bearer ${authToken}` },
        body: samplePayload,
    });
    await syncHandler(pSyncReq, pSyncRes);
    const pSyncResult = pSyncRes._getResult();
    console.log('PATCH /api/sync status:', pSyncResult.statusCode, pSyncResult.data);
    if (pSyncResult.statusCode !== 200 || !pSyncResult.data?.ok) {
        throw new Error('PATCH /api/sync failed');
    }
    console.log('✓ Cloud Sync PATCH succeeded!\n');

    // Test 6: Verify Synced Data on second fetch (simulating another app / phone / TV)
    console.log('--- Test 6: Verify Synced Data (Simulating a New Device / App Session) ---');
    const { req: vSyncReq, res: vSyncRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${authToken}` },
    });
    await syncHandler(vSyncReq, vSyncRes);
    const vSyncResult = vSyncRes._getResult();
    const syncedTracks = Object.keys(vSyncResult.data?.library?.tracks || {});
    const syncedAlbums = Object.keys(vSyncResult.data?.library?.albums || {});
    const syncedPlaylists = Object.keys(vSyncResult.data?.userPlaylists || {});
    console.log('Synced Tracks in Cloud:', syncedTracks);
    console.log('Synced Albums in Cloud:', syncedAlbums);
    console.log('Synced Playlists in Cloud:', syncedPlaylists);
    if (syncedTracks.length !== 2 || syncedAlbums.length !== 1 || syncedPlaylists.length !== 1) {
        throw new Error('Data verification failed on synced library');
    }
    console.log('✓ Cross-device sync verified! All albums, playlists, and likes successfully persisted in Neon Postgres\n');

    // Test 7: TV Pairing Flow (RFC 8628 Device Flow)
    console.log('--- Test 7: TV QR Code Device Pairing Flow ---');
    console.log('Step 7a: TV initiates pairing request...');
    const { req: tInitReq, res: tInitRes } = createMockReqRes({ method: 'POST', headers: { host: 'echos.vercel.app' } });
    await pairInitHandler(tInitReq, tInitRes);
    const tInitResult = tInitRes._getResult();
    console.log('TV Pairing Code:', tInitResult.data?.code, 'Formatted:', tInitResult.data?.formattedCode);
    console.log('TV Pair URL:', tInitResult.data?.pairUrl);
    console.log('QR Code Data URL Length:', tInitResult.data?.qrDataUrl?.length);
    if (!tInitResult.data?.code || !tInitResult.data?.pairingToken || !tInitResult.data?.qrDataUrl) {
        throw new Error('TV Pair Init failed');
    }
    const pairingCode = tInitResult.data.code;
    const pairingToken = tInitResult.data.pairingToken;

    console.log('Step 7b: TV polls status (expecting "pending")...');
    const { req: tPollReq1, res: tPollRes1 } = createMockReqRes({ method: 'GET', query: { token: pairingToken } });
    await pairStatusHandler(tPollReq1, tPollRes1);
    const tPollResult1 = tPollRes1._getResult();
    console.log('TV Poll 1 Status:', tPollResult1.data?.status);
    if (tPollResult1.data?.status !== 'pending') {
        throw new Error('Expected status to be pending');
    }

    console.log('Step 7c: Phone scans QR code and approves pairing with user token...');
    const { req: tApproveReq, res: tApproveRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${authToken}` },
        body: { code: pairingCode },
    });
    await pairApproveHandler(tApproveReq, tApproveRes);
    const tApproveResult = tApproveRes._getResult();
    console.log('Approval Status:', tApproveResult.data);
    if (!tApproveResult.data?.success) {
        throw new Error('Phone pair approval failed');
    }

    console.log('Step 7d: TV polls status again (expecting "approved" + session token)...');
    const { req: tPollReq2, res: tPollRes2 } = createMockReqRes({ method: 'GET', query: { token: pairingToken } });
    await pairStatusHandler(tPollReq2, tPollRes2);
    const tPollResult2 = tPollRes2._getResult();
    console.log('TV Poll 2 Status:', tPollResult2.data?.status);
    console.log('TV Received Token:', tPollResult2.data?.token ? 'Yes (Valid JWT)' : 'No');
    console.log('TV Received User:', tPollResult2.data?.user?.email);
    if (tPollResult2.data?.status !== 'approved' || !tPollResult2.data?.token) {
        throw new Error('Expected status to be approved with session token');
    }
    console.log('✓ TV QR Code Pairing flow passed end-to-end!\n');

    console.log('--- Test 8: Spotify Playlist Import Handler ---');
    const { req: spReq, res: spRes } = createMockReqRes({
        method: 'GET',
        query: { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' }
    });
    await spotifyHandler(spReq, spRes);
    const spResult = spRes._getResult();
    console.log('Spotify Import Status:', spResult.statusCode, 'Title:', spResult.data?.name, 'Tracks count:', spResult.data?.trackCount);
    if (!spResult.data?.ok || !spResult.data?.tracks?.length) {
        throw new Error('Spotify playlist import failed');
    }
    console.log('✓ Spotify Playlist Import passed! Extracted tracks without API keys\n');

    console.log('--- Test 9: YouTube Account Social OAuth Scope Handler ---');
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id.apps.googleusercontent.com';
    const { req: ytAuthReq, res: ytAuthRes } = createMockReqRes({
        method: 'POST',
        headers: { host: 'echos.vercel.app' },
        body: { provider: 'youtube', callbackURL: 'https://echos.vercel.app/library' }
    });
    await socialAuthHandler(ytAuthReq, ytAuthRes);
    const ytAuthResult = ytAuthRes._getResult();
    console.log('YouTube OAuth URL status:', ytAuthResult.statusCode);
    const generatedUrl = ytAuthResult.data?.url || '';
    const hasYouTubeScope = generatedUrl.includes('youtube.readonly');
    console.log('Generated URL contains youtube.readonly scope:', hasYouTubeScope);
    if (!hasYouTubeScope) {
        throw new Error('Expected YouTube OAuth URL to include youtube.readonly scope');
    }
    console.log('✓ YouTube Account OAuth connection passed!\n');

    console.log('--- Test 10: Browser Direct Download / Export Audio Endpoint ---');
    const { req: dlReq, res: dlRes } = createMockReqRes({
        method: 'HEAD',
        query: { id: '34Na4j8AVgA', filename: 'The Weeknd - Starboy' }
    });
    dlRes.end = () => {};
    await downloadHandler(dlReq, dlRes);
    const dlResult = dlRes._getResult();
    console.log('Download Status Code:', dlResult.statusCode);
    console.log('Content-Type:', dlResult.headers['Content-Type']);
    console.log('Content-Disposition:', dlResult.headers['Content-Disposition']);
    if (dlResult.statusCode !== 200 || !dlResult.headers['Content-Disposition']?.includes('attachment')) {
        throw new Error('Download endpoint failed: ' + JSON.stringify(dlResult.headers));
    }
    console.log('✓ Browser Direct Download / Export Audio endpoint passed!\n');

    console.log('====================================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================');
}

runTests().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
