/**
 * Server-side Input Sanitization & Validation Helpers
 * Protects against XSS, SQLi/parameter abuse, SSRF, DoS/payload bloat, Header Injection, etc.
 */

// Strip null bytes and non-printable control characters (except standard whitespace \t, \n, \r)
export function sanitizeString(val: unknown, maxLength = 255): string {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    // Remove control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
    const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return cleaned.slice(0, maxLength);
}

// Strict URL validator for HTTP/HTTPS only
export function sanitizeUrl(val: unknown, maxLength = 1024): string | null {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length > maxLength) return null;

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

// Sanitize CSS for community themes (strip dangerous CSS constructs like @import, expression, behavior, script)
export function sanitizeCss(css: unknown, maxLength = 50000): string | null {
    if (!css || typeof css !== 'string') return null;
    if (css.length > maxLength) return null;

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
        /url\s*\(\s*['"]?\s*data:/i,
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(css)) {
            return null;
        }
    }

    return css;
}

// SSRF Protection: Checks whether a URL points to loopback, private IP ranges, or cloud metadata
export function isPrivateOrBlockedHost(urlStr: string): boolean {
    try {
        const parsed = new URL(urlStr);
        const hostname = parsed.hostname.toLowerCase();

        // Localhost / Loopback
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
            return true;
        }

        // AWS / Cloud Metadata
        if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
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

        // IPv6 Link-local / Unique local (fe80::/10, fc00::/7)
        if (/^(fe8|fe9|fea|feb|fc|fd)/i.test(hostname)) return true;

        return false;
    } catch {
        return true;
    }
}
