# Security Policy

Echoes is committed to providing a clean, private, and secure audio streaming experience. We take software security seriously and welcome vulnerability reports from researchers and the open-source community.

---

## Reporting a Security Vulnerability

If you discover a security vulnerability, exploit vector, or potential security breach in Echoes, we kindly ask you to report it to us responsibly before making it public.

Please do NOT create a public GitHub Issue for security vulnerabilities, as public disclosure puts active users at risk before a patch can be deployed.

### How to Report

Send an email directly to project maintainer **Manuth Methnidu**:

- Email: contact.Echoes@proton.me
- Subject: [SECURITY VULNERABILITY] Brief summary of the issue

### What to Include in Your Report

To help us triage and resolve the issue quickly, please provide as much of the following information as possible:

1. Description of the vulnerability (e.g., Cross-Site Scripting, Server-Side Request Forgery, Broken Object-Level Authorization, Authentication Bypass).
2. Affected endpoint, URL, or source code file and line numbers.
3. Step-by-step reproduction instructions or a minimal Proof-of-Concept (PoC) payload.
4. The potential impact of the vulnerability (what data or system resources could be compromised).
5. Any suggested remediation steps or patches, if known.

### Our Response Commitment

- Acknowledgment: We will acknowledge receipt of your report within 48 hours.
- Assessment: We will investigate and confirm the severity and impact of the reported vulnerability.
- Resolution: We will prepare and deploy a patch to production as quickly as possible.
- Attribution: If desired, we will happily credit you in the release notes and repository once the fix is deployed.

---

## Supported Versions

Only the latest commit on the `main` branch deployed to https://echoes.mteck.tech is actively maintained with security updates.

| Version / Deployment | Supported |
| :--- | :--- |
| Latest `main` (https://echoes.mteck.tech) | Yes |
| Past releases or forks | No |

---

## Implemented Security Measures & Defensive Architecture

Echoes incorporates defensive engineering practices across its frontend, serverless backend, and cloud database:

### 1. SQL Injection Prevention
- All database queries across Neon Serverless PostgreSQL utilize tagged template literals (`sql` parameterization).
- User inputs (email addresses, usernames, search terms, JSON payloads) are never concatenated into raw SQL strings, ensuring the database engine treats all inputs as literal values.

### 2. Server-Side Request Forgery (SSRF) Protection
- The audio stream proxy endpoint (`/api/yt/proxy-stream`) enforces a strict domain allowlist restricted to authorized streaming content delivery networks.
- Private network ranges (RFC 1918), loopback addresses (`127.0.0.0/8`), link-local/cloud metadata addresses (`169.254.0.0/16`), and IPv6 localhost (`::1`) are strictly rejected.

### 3. Input Sanitization & Cross-Site Scripting (XSS) Defense
- A centralized validation module (`api/_lib/sanitize.ts`) sanitizes and validates incoming strings, usernames, emails, URLs, identifiers, and custom stylesheets.
- Unsafe protocols such as `javascript:`, `data:`, and `vbscript:` are stripped from all URL fields.
- User-supplied metadata rendered on the client utilizes sanitized DOM parsing and text node insertion rather than raw, unescaped string concatenation.

### 4. Elimination of Arbitrary File Uploads
- External third-party file upload endpoints and arbitrary file upload forms have been removed.
- User profile avatars, banners, and playlist cover art exclusively accept validated direct HTTPS image URLs.

### 5. Authentication & Pairing Security
- TV device pairing codes are generated using cryptographically strong random values (`crypto.getRandomValues()`).
- Pairing verification, status polling, and authentication endpoints are protected by rate limiters to prevent brute-force attempts.
- Password reset tokens are never exposed in API responses under any circumstances, including email delivery failure.
- OAuth redirect flows validate callback URLs and state parameters against an origin allowlist to prevent open redirect and token interception.
- Cross-window communication (`window.postMessage`) enforces exact origin targeting and strict origin verification on event receivers.
- Constant-time string comparison (`constantTimeEqual`) is used for credential verification to eliminate timing side-channels, and PBKDF2 iterations are balanced during sign-in to prevent email enumeration.
- Ephemeral cryptographic keys are generated in development environments if secrets are omitted, preventing fallback to static known secrets.

### 6. HTTP Security Headers
- The edge network enforces security headers via `vercel.json` and `nginx.conf`:
  - `X-Frame-Options: SAMEORIGIN` (prevents clickjacking attacks)
  - `X-Content-Type-Options: nosniff` (prevents MIME-type sniffing exploits)
  - `Referrer-Policy: strict-origin-when-cross-origin` (protects sensitive referral paths)
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (enforces HTTPS)
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` (restricts unauthorized browser APIs)
