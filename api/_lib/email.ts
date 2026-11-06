export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
    const resendApiKey = process.env.RESEND_API_KEY;
    const brevoApiKey = process.env.BREVO_API_KEY;

    // 1. Send via Resend if RESEND_API_KEY is configured
    if (resendApiKey) {
        try {
            const from = process.env.EMAIL_FROM || 'Echoes <notifications@mteck.tech>';
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from,
                    to: [options.to],
                    subject: options.subject,
                    html: options.html,
                    text: options.text,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                console.error('[Resend Email Error]', data);
                return {
                    success: false,
                    error: data?.message || data?.error || `Email delivery failed (${res.status})`,
                };
            }

            return { success: true, id: data?.id };
        } catch (err: any) {
            console.error('[Resend Exception]', err);
            return { success: false, error: err.message || 'Failed to dispatch email' };
        }
    }

    // 2. Send via Brevo (Sendinblue) if BREVO_API_KEY is configured
    if (brevoApiKey) {
        try {
            const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'notifications@mteck.tech';
            const fromName = process.env.EMAIL_FROM_NAME || 'Echoes';
            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'api-key': brevoApiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sender: { name: fromName, email: fromEmail },
                    to: [{ email: options.to }],
                    subject: options.subject,
                    htmlContent: options.html,
                    textContent: options.text,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                console.error('[Brevo Email Error]', data);
                return {
                    success: false,
                    error: data?.message || `Brevo delivery failed (${res.status})`,
                };
            }

            return { success: true, id: data?.messageId };
        } catch (err: any) {
            console.error('[Brevo Exception]', err);
            return { success: false, error: err.message || 'Failed to dispatch email via Brevo' };
        }
    }

    return { success: false, error: 'No email provider configured (set RESEND_API_KEY or BREVO_API_KEY in Vercel)' };
}
