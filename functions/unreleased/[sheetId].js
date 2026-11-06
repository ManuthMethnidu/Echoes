// functions/unreleased/[sheetId].js

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const ARTISTS_CSV_URL = 'https://artists.artistgrid.cx/artists.csv';
const ASSETS_BASE_URL = 'https://assets.artistgrid.cx';

// The artists CSV provides the tracker id directly: either a bare Google Sheets
// id or a tracker domain (yetracker.net, franktracker.net, deftonestracker, ...).
// Whatever it is, it's used as-is on the tracker API.
function getSheetId(url) {
    if (!url) return null;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return url.trim() || null;
}

function normalizeArtistName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Parse RFC4180-style CSV (quoted fields, escaped "" quotes, commas/newlines inside quotes)
function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function parseArtistsCSV(text) {
    const rows = parseCSVRows(text).filter((r) => r.length > 1 || r[0]);
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = row[i] ?? '';
        });
        return obj;
    });
}

async function loadArtistsData() {
    try {
        const response = await fetch(ARTISTS_CSV_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        return parseArtistsCSV(text);
    } catch (e) {
        console.error('Failed to load Artists List:', e);
        return [];
    }
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const sheetId = params.sheetId;

    if (isBot && sheetId) {
        try {
            const artists = await loadArtistsData();
            const artist = artists.find((a) => getSheetId(a.url) === sheetId);

            if (artist && artist.name) {
                const normalizedName = normalizeArtistName(artist.name);
                const safeNormalizedName = escapeHtml(normalizedName);
                // Images live at assets.artistgrid.cx/{format}/{normalizedname}.{format}
                const imageUrl = escapeHtml(`${ASSETS_BASE_URL}/jpg/${normalizedName}.jpg`);
                const pageUrl = escapeHtml(new URL(request.url).href);
                const rawName = artist.name;
                const artistName = escapeHtml(rawName);
                const title = escapeHtml(`${rawName} | Unreleased`);
                const description = escapeHtml(`Stream unreleased music by ${rawName} on Echoes`);

                const metaHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${title}</title>
                        <meta name="description" content="${description}">
                        <meta name="theme-color" content="#000000">

                        <meta property="og:site_name" content="Echoes">
                        <meta property="og:title" content="${title}">
                        <meta property="og:description" content="${description}">
                        <meta property="og:image" content="${imageUrl}">
                        <meta property="og:type" content="profile">
                        <meta property="og:url" content="${pageUrl}">

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${artistName}</h1>
                        <p>${description}</p>
                        <picture>
                            <source srcset="${ASSETS_BASE_URL}/jxl/${safeNormalizedName}.jxl" type="image/jxl">
                            <source srcset="${ASSETS_BASE_URL}/webp/${safeNormalizedName}.webp" type="image/webp">
                            <img src="${imageUrl}" alt="${artistName}">
                        </picture>
                    </body>
                    </html>
                `;

                return new Response(metaHtml, {
                    headers: { 'content-type': 'text/html;charset=UTF-8' },
                });
            }
        } catch (error) {
            console.error(`Error generating meta tags for unreleased artist ${sheetId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
