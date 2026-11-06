import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { createPasswordResetToken } from '../../_lib/auth.js';
import { getClientIp, consumeRateLimit } from '../../_lib/rateLimit.js';
import { sendEmail } from '../../_lib/email.js';
import { sanitizeEmail } from '../../_lib/sanitize.js';

const ALLOWED_RESET_ORIGINS = [
    'https://echoes.mteck.tech',
    'https://echos.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { email, redirectTo } = req.body || {};
        const normalizedEmail = sanitizeEmail(email);
        if (!normalizedEmail) {
            return res.status(400).json({ error: { message: 'A valid email address is required' } });
        }

        const sql = getDb();
        await ensureSchema(sql);

        const clientIp = getClientIp(req);

        // Rate limit: 5 requests per 15 minutes per IP, 3 per account
        const ipLimit = await consumeRateLimit(`reset_ip:${clientIp}`, 5, 900);
        const accLimit = await consumeRateLimit(`reset_acc:${normalizedEmail}`, 3, 900);

        if (!ipLimit.allowed || !accLimit.allowed) {
            const retryAfter = Math.max(ipLimit.retryAfterSeconds, accLimit.retryAfterSeconds);
            const minutes = Math.max(1, Math.ceil(retryAfter / 60));
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({
                error: {
                    message: `Too many password reset attempts. Please wait ${minutes} minute${minutes > 1 ? 's' : ''} before trying again.`,
                    retryAfter,
                },
            });
        }

        const users = await sql`
            SELECT id, email, password_hash, name
            FROM users
            WHERE email = ${normalizedEmail}
            LIMIT 1
        `;

        if (users.length === 0) {
            // Constant-time style response to prevent email enumeration
            return res.status(200).json({
                status: true,
                message: 'If an account exists with this email, password reset instructions have been sent.',
            });
        }

        const userRow = users[0];
        const fingerprint = (userRow.password_hash || '').slice(0, 16);
        const token = await createPasswordResetToken(userRow.id, userRow.email, fingerprint);

        let baseUrl = 'https://echoes.mteck.tech';
        if (redirectTo && typeof redirectTo === 'string') {
            try {
                const u = new URL(redirectTo);
                if (ALLOWED_RESET_ORIGINS.includes(u.origin)) {
                    baseUrl = u.origin;
                }
            } catch {}
        } else if (req.headers.origin && typeof req.headers.origin === 'string') {
            if (ALLOWED_RESET_ORIGINS.includes(req.headers.origin)) {
                baseUrl = req.headers.origin;
            }
        }

        const resetUrl = `${baseUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0c0d0e; color: #ededed; margin: 0; padding: 24px; }
    .card { max-width: 480px; margin: 0 auto; background-color: #17181c; border: 1px solid #27282d; border-radius: 12px; padding: 32px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    .logo { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff; margin-bottom: 24px; display: inline-block; }
    h2 { font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.6; color: #a1a1aa; margin-bottom: 24px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #ffffff; color: #000000; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 28px; border-radius: 8px; }
    .link-box { word-break: break-all; font-size: 12px; color: #71717a; background: #0c0d0e; padding: 12px; border-radius: 6px; border: 1px solid #27282d; }
    .footer { font-size: 12px; color: #52525b; margin-top: 32px; border-top: 1px solid #27282d; padding-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Echoes</div>
    <h2>Reset Your Password</h2>
    <p>Hi ${userRow.name || 'there'},</p>
    <p>We received a request to reset your Echoes account password. Click the button below to choose a new password. This link will expire in 1 hour.</p>
    <div class="btn-container">
      <a href="${resetUrl}" class="btn">Reset Password</a>
    </div>
    <p>If the button doesn't work, copy and paste this link into your browser:</p>
    <div class="link-box">${resetUrl}</div>
    <p style="margin-top:24px;">If you didn't request a password reset, you can safely ignore this email.</p>
    <div class="footer">
      Echoes Music Player &bull; Open-source audio streaming
    </div>
  </div>
</body>
</html>
        `;

        let emailSent = false;
        if (process.env.RESEND_API_KEY) {
            const emailResult = await sendEmail({
                to: userRow.email,
                subject: 'Reset your Echoes password',
                html: emailHtml,
                text: `Hi ${userRow.name || 'there'},\n\nWe received a request to reset your password. Use the link below to choose a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour. If you did not request this, you can ignore this email.`,
            });
            emailSent = Boolean(emailResult?.success);
        }

        // If no custom Resend API key configured, use Neon's Better Auth shared email service!
        if (!emailSent) {
            try {
                const neonAuthUrl =
                    'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/email-otp/send-verification-otp';
                const neonRes = await fetch(neonAuthUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: userRow.email, type: 'forget-password' }),
                });
                if (neonRes.ok) {
                    emailSent = true;
                }
            } catch (neonErr) {
                console.warn('[Neon Auth Email OTP Fallback Failed]', neonErr);
            }
        }

        return res.status(200).json({
            status: true,
            message: 'If an account exists with this email, password reset instructions have been sent.',
        });
    } catch (err: any) {
        console.error('[Request Password Reset Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
