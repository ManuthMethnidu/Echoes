export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
        return { success: false, error: 'RESEND_API_KEY is not configured' };
    }

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
        console.error('[SendEmail Exception]', err);
        return { success: false, error: err.message || 'Failed to dispatch email' };
    }
}
