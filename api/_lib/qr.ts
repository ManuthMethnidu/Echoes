import QRCode from 'qrcode';

export async function generateQrDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: {
            dark: '#FFFFFF',
            light: '#000000',
        },
    });
}

export async function generateQrSvg(text: string): Promise<string> {
    return QRCode.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
            dark: '#FFFFFF',
            light: '#000000',
        },
    });
}
