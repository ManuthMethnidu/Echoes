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
            // Check if this email exists as a Google OAuth account in neon_auth
            let isGoogleOnly = false;
            try {
                const neonUser = await sql`
                    SELECT u.id 
                    FROM neon_auth.user u
                    JOIN neon_auth.account a ON a."userId" = u.id
                    WHERE LOWER(u.email) = ${normalizedEmail} AND a."providerId" = 'google'
                    LIMIT 1
                `;
                if (neonUser.length > 0) {
                    isGoogleOnly = true;
                }
            } catch {}

            if (isGoogleOnly) {
                return res.status(400).json({
                    error: {
                        message: 'This account was created with Google Sign-In and does not have a separate password. Please sign in directly using "Sign in with Google".',
                        isGoogleAccount: true,
                    },
                });
            }

            // Constant-time style response to prevent email enumeration
            return res.status(200).json({
                status: true,
                message: 'If an account exists with this email, password reset instructions have been sent.',
            });
        }

        const userRow = users[0];

        // Google OAuth Check: Accounts created via Google Sign-In do NOT have an Echoes password
        if (!userRow.password_hash) {
            return res.status(400).json({
                error: {
                    message: 'This account was created with Google Sign-In and does not have a separate password. Please sign in directly using "Sign in with Google".',
                    isGoogleAccount: true,
                },
            });
        }

        const fingerprint = (userRow.password_hash || '').slice(0, 16);
        const token = await createPasswordResetToken(userRow.id, userRow.email, fingerprint);

        // Strict Defense against Host Header Injection:
        // NEVER read req.headers.host, x-forwarded-host, origin, or client parameters to build links.
        // Fixed trusted application URL prevents attackers from poisoning reset links via Burp Suite.
        const TRUSTED_APP_DOMAIN = (process.env.APP_URL || 'https://echoes.mteck.tech').replace(/\/+$/, '');
        const resetUrl = `${TRUSTED_APP_DOMAIN}/reset-password?token=${encodeURIComponent(token)}`;

        const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Echoes Password</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #090a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f4f4f5;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090a0f; min-height: 100vh; padding: 40px 16px;">
    <tr>
      <td align="center" valign="top">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #12131a; border-radius: 16px; border: 1px solid #232533; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <!-- Top Accent Gradient -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #ec4899 100%); font-size: 1px; line-height: 1px;">&nbsp;</td>
          </tr>
          <!-- Body Container -->
          <tr>
            <td style="padding: 36px 36px 32px 36px;">
              <!-- Header / Brand -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td>
                    <div style="display: inline-flex; align-items: center; gap: 10px;">
                      <span style="display: inline-block; width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 8px; text-align: center; line-height: 32px; font-size: 18px; color: #ffffff; font-weight: bold;">&#9835;</span>
                      <span style="font-size: 20px; font-weight: 700; letter-spacing: 2px; color: #ffffff; text-transform: uppercase;">Echoes</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Title -->
              <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Password Reset Request</h1>
              
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
                Hi <strong style="color: #f4f4f5;">${userRow.name || 'there'}</strong>,
              </p>
              
              <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
                We received a request to reset the password for your Echoes account. To set a new password, click the button below:
              </p>

              <!-- CTA Button -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto 32px auto; width: 100%;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; width: 100%; box-sizing: border-box; text-align: center; background: #ffffff; color: #0a0a0c; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 14px rgba(255, 255, 255, 0.12); transition: all 0.2s ease;">
                      Reset Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry Callout -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #181924; border-radius: 8px; border: 1px solid #282a3a; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 14px 16px; font-size: 13px; color: #9496a8; line-height: 1.5;">
                    <strong style="color: #cbd5e1;">Notice:</strong> This single-use reset link expires in <strong>60 minutes</strong>. If you did not make this request, you can safely ignore this email &mdash; your account and password remain completely secure.
                  </td>
                </tr>
              </table>

              <!-- Alternative Link -->
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #71717a;">
                Button not working? Copy and paste this URL into your browser:
              </p>
              <div style="background-color: #0d0e14; border: 1px solid #1f212d; border-radius: 8px; padding: 12px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; line-height: 1.5; color: #818cf8;">
                ${resetUrl}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0d0e14; border-top: 1px solid #1f212d; padding: 20px 36px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #52525b; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} Echoes Music &bull; Ad-free, high fidelity streaming<br>
                <a href="${TRUSTED_APP_DOMAIN}" style="color: #71717a; text-decoration: underline;">echoes.mteck.tech</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `;

        let emailSent = false;
        const emailResult = await sendEmail({
            to: userRow.email,
            subject: 'Reset your Echoes password',
            html: emailHtml,
            text: `Hi ${userRow.name || 'there'},\n\nWe received a request to reset your password. Use the link below to choose a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour. If you did not request this, you can ignore this email.`,
        });
        emailSent = Boolean(emailResult?.success);

        // If no custom email API key configured in Vercel, use Neon's Better Auth shared email service!
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

        if (!emailSent) {
            console.error('[Password Reset Delivery Failed] Neither Resend nor Neon Auth could deliver the email.');
            return res.status(503).json({
                error: {
                    message:
                        'Unable to dispatch password reset email. Please ensure RESEND_API_KEY is configured in your Vercel project environment variables.',
                },
            });
        }

        return res.status(200).json({
            status: true,
            message: 'Password reset instructions have been sent to your email address.',
        });
    } catch (err: any) {
        console.error('[Request Password Reset Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
