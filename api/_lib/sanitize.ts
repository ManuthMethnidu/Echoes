/**
 * Server-side Input Sanitization & Validation Helpers
 * Protects against XSS, SQLi/parameter abuse, SSRF, DoS/payload bloat, Header Injection, etc.
 */

// Check text for profanity, slurs, or vulgar abuse (with leetspeak normalization)
export function containsProfanity(val: unknown): boolean {
    if (!val || typeof val !== 'string') return false;
    const str = val.trim();
    if (!str) return false;

    // Direct check on raw input
    const directPattern = /\b(?:nigg[aer]|fagg?ot|cunt|kike|chink|spic|whore|slut|retard|bitch|fuck(?:er|ing)?|shit(?:head)?|pussy|dickhead|cock(?:sucker)?|porn(?:o|ography)?|hentai|xxx|nsfw|blowjob|handjob|dildo|vagina|penis)\b/i;
    if (directPattern.test(str)) return true;

    // Leetspeak normalized check (strips punctuation and space bypasses)
    const normalized = str
        .toLowerCase()
        .replace(/[@4]/g, 'a')
        .replace(/[1!|]/g, 'i')
        .replace(/[0]/g, 'o')
        .replace(/[$5]/g, 's')
        .replace(/[3]/g, 'e')
        .replace(/[7+]/g, 't')
        .replace(/[\s._\-*/\\]+/g, '');

    const BAD_STEMS = [
        'nigger', 'nigga', 'faggot', 'kike', 'chink', 'spic', 'cunt',
        'retard', 'whore', 'slut', 'bitch', 'fuck', 'shit', 'pussy', 'dickhead',
        'pornhub', 'xvideos', 'xnxx', 'hentai', 'blowjob', 'cock'
    ];

    return BAD_STEMS.some((bad) => normalized.includes(bad));
}

const SUS_DOMAIN_PATTERNS = [
    /pornhub\./i,
    /xvideos\./i,
    /xnxx\./i,
    /xhamster\./i,
    /redtube\./i,
    /youporn\./i,
    /onlyfans\./i,
    /chaturbate\./i,
    /stripchat\./i,
    /cam4\./i,
    /livejasmin\./i,
    /brazzers\./i,
    /beeg\./i,
    /spankbang\./i,
    /tubegalore\./i,
    /rule34\./i,
    /nhentai\./i,
    /e-hentai\./i,
    /tnaflix\./i,
    /drtuber\./i,
    /eporner\./i,
    /hqporner\./i,
    /thumbzilla\./i,
    /heavy-r\./i,
    /bestgore\./i,
    /motherless\./i,
    /(?:^|\.)(?:xxx|porn|adult|sexy|cam|cams|fetish|erotic|hookup)\b/i,
];

// Check if a URL belongs to banned adult or suspicious sites
export function isBlockedOrSusUrl(val: unknown): boolean {
    if (!val || typeof val !== 'string') return false;
    const str = val.trim().toLowerCase();
    if (!str) return false;

    const SUS_KEYWORDS = [
        'pornhub',
        'xvideos',
        'xnxx',
        'xhamster',
        'redtube',
        'youporn',
        'onlyfans',
        'chaturbate',
        'stripchat',
        'brazzers',
        'nhentai',
        'rule34',
        'spankbang',
        'livejasmin',
    ];
    if (SUS_KEYWORDS.some((kw) => str.includes(kw))) {
        return true;
    }

    try {
        const parsed = new URL(str.startsWith('http') ? str : `https://${str}`);
        const hostname = parsed.hostname.toLowerCase();
        return SUS_DOMAIN_PATTERNS.some((pat) => pat.test(hostname));
    } catch {
        return SUS_KEYWORDS.some((kw) => str.includes(kw));
    }
}

// Strip null bytes and non-printable control characters (except standard whitespace \t, \n, \r)
export function sanitizeString(val: unknown, maxLength = 255): string {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    // Remove control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
    const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return cleaned.slice(0, maxLength);
}

// Strict URL validator for HTTP/HTTPS only (and root-relative /api/artwork endpoints)
export function sanitizeUrl(val: unknown, maxLength = 8192): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length > maxLength) return null;

    if (isBlockedOrSusUrl(trimmed)) {
        return null;
    }

    // Allow root-relative paths like /api/artwork?id=...
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

// Avatar URL specifically: must be a valid http: or https: URL
export function sanitizeAvatarUrl(val: unknown): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed) return null;

    // Explicitly reject dangerous schemes
    if (/^(javascript|data|vbscript|file|about|blob):/i.test(trimmed)) {
        return null;
    }

    return sanitizeUrl(trimmed, 1024);
}

// Email format validation & normalization
export function sanitizeEmail(val: unknown): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim().toLowerCase();
    if (trimmed.length > 254) return null;
    // Standard RFC 5322 compatible regex
    const emailRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(trimmed)) return null;
    return trimmed;
}

// Username validation: alphanumeric, underscore, hyphen, dot, length 1..40
export function sanitizeUsername(val: unknown): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(trimmed)) return null;
    return trimmed;
}

// Password validation: enforces minimum length 6, max length 128 (protects against PBKDF2/bcrypt CPU exhaustion)
export function sanitizePassword(val: unknown): { valid: boolean; error?: string } {
    if (!val || typeof val !== 'string') {
        return { valid: false, error: 'Password is required' };
    }
    if (val.length < 6) {
        return { valid: false, error: 'Password must be at least 6 characters' };
    }
    if (val.length > 128) {
        return { valid: false, error: 'Password cannot exceed 128 characters' };
    }
    return { valid: true };
}

// Safe Identifier (UUIDs, IDs)
export function sanitizeId(val: unknown, maxLength = 64): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(trimmed)) return null;
    return trimmed.slice(0, maxLength);
}

// Sanitize filename to prevent HTTP Response Header Injection / Split attacks
export function sanitizeFilename(val: unknown, defaultName = 'audio'): string {
    if (!val || typeof val !== 'string') return defaultName;
    // Strip control characters, quotes, newlines, slashes
    const cleaned = val
        .replace(/[\r\n\0\x08]/g, '')
        .replace(/["'\\/<>|:*?]/g, '_')
        .trim();
    return cleaned.slice(0, 100) || defaultName;
}

// Sanitize CSS for community themes (strip dangerous CSS constructs like @import, expression, behavior, script, and external URLs)
export function sanitizeCss(css: unknown, maxLength = 50000): string | null {
    if (!css || typeof css !== 'string') return null;
    if (css.length > maxLength) return null;

    // Normalize: remove comments before checking patterns to prevent comment-based evasions
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');

    // Check for dangerous vectors
    const dangerousPatterns = [
        /@import/i,
        /expression\s*\(/i,
        /behavior\s*:/i,
        /-moz-binding\s*:/i,
        /javascript\s*:/i,
        /<\s*script/i,
        /<\s*\/\s*style/i,
        /attr\s*\(/i,
        // Block external URLs and data/blob/script schemes to prevent data exfiltration
        /url\s*\(\s*['"]?\s*(https?:|\/\/|data:|blob:|javascript:)/i,
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(uncommented)) {
            return null;
        }
    }

    return css;
}

// SSRF Protection: Checks whether a URL points to loopback, private IP ranges, or cloud metadata
export function isPrivateOrBlockedHost(urlStr: string): boolean {
    try {
        const parsed = new URL(urlStr);
        // Strip IPv6 bracket notation if present
        const hostname = parsed.hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

        // Localhost / Loopback / Wildcard
        if (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname === '::1' ||
            hostname === '::' ||
            hostname === '0.0.0.0' ||
            /^127\./.test(hostname) ||
            /^0\./.test(hostname)
        ) {
            return true;
        }

        // AWS / GCP / Azure Cloud Metadata & Instance Identifiers
        if (
            hostname === '169.254.169.254' ||
            hostname === 'metadata.google.internal' ||
            hostname === 'metadata.internal' ||
            hostname === 'instance-data'
        ) {
            return true;
        }

        // IPv4 Private ranges (RFC 1918 & Carrier-grade NAT)
        // 10.0.0.0/8
        if (/^10\./.test(hostname)) return true;
        // 172.16.0.0/12 (172.16 - 172.31)
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
        // 192.168.0.0/16
        if (/^192\.168\./.test(hostname)) return true;
        // 100.64.0.0/10 (CGNAT)
        if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(hostname)) return true;
        // 169.254.0.0/16 (Link-local)
        if (/^169\.254\./.test(hostname)) return true;
        // TEST-NET & Multicast / Reserved
        if (/^192\.0\.2\./.test(hostname)) return true;
        if (/^198\.51\.100\./.test(hostname)) return true;
        if (/^203\.0\.113\./.test(hostname)) return true;
        if (/^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\./.test(hostname)) return true;

        // Decimal / Hex numeric hostnames (e.g. 2130706433 or 0x7f000001)
        if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) return true;

        // IPv6 Link-local / Unique local (fe80::/10, fc00::/7)
        if (/^(fe8|fe9|fea|feb|fc|fd)/i.test(hostname)) return true;

        // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
        if (hostname.startsWith('::ffff:')) {
            const mappedIpv4 = hostname.slice(7);
            if (isPrivateOrBlockedHost(`http://${mappedIpv4}`)) {
                return true;
            }
        }

        return false;
    } catch {
        return true;
    }
}
