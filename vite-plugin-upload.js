/**
 * Upload Plugin - Disabled
 * External arbitrary file uploads have been deprecated and eliminated.
 * Echoes exclusively accepts direct HTTPS image URLs.
 */
export default function uploadPlugin() {
    return {
        name: 'upload-plugin',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url === '/upload' && req.method === 'POST') {
                    res.statusCode = 410;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: 'Arbitrary file upload endpoint has been retired for security.' }));
                    return;
                }
                next();
            });
        },
    };
}
