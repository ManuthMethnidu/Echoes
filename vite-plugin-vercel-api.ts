import type { Plugin, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';
import path from 'path';

export default function vercelApiPlugin(): Plugin {
    let env: Record<string, string> = {};

    return {
        name: 'vite-plugin-vercel-api',
        config(_, { mode }) {
            env = loadEnv(mode, process.cwd(), '');
            for (const [k, v] of Object.entries(env)) {
                if (process.env[k] === undefined) {
                    process.env[k] = v;
                }
            }
        },
        configureServer(server: ViteDevServer) {
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || '';
                const [pathname, search] = url.split('?');

                if (!pathname.startsWith('/api/')) {
                    return next();
                }

                try {
                    const subPath = pathname.slice(5); // remove '/api/'
                    let handlerPath = '';
                    const routeParams: Record<string, string> = {};

                    if (subPath === 'health') {
                        handlerPath = './api/health.ts';
                    } else if (subPath === 'sync') {
                        handlerPath = './api/sync.ts';
                    } else if (subPath === 'me') {
                        handlerPath = './api/me/index.ts';
                    } else if (subPath === 'me/profile') {
                        handlerPath = './api/me/profile.ts';
                    } else if (subPath === 'auth/sign-in/email') {
                        handlerPath = './api/auth/sign-in/email.ts';
                    } else if (subPath === 'auth/sign-up/email') {
                        handlerPath = './api/auth/sign-up/email.ts';
                    } else if (subPath === 'auth/get-session') {
                        handlerPath = './api/auth/get-session.ts';
                    } else if (subPath === 'auth/sign-out') {
                        handlerPath = './api/auth/sign-out.ts';
                    } else if (subPath === 'auth/sign-in/social') {
                        handlerPath = './api/auth/sign-in/social.ts';
                    } else if (subPath === 'auth/callback') {
                        handlerPath = './api/auth/callback.ts';
                    } else if (subPath === 'pair/init') {
                        handlerPath = './api/pair/init.ts';
                    } else if (subPath === 'pair/status') {
                        handlerPath = './api/pair/status.ts';
                    } else if (subPath === 'pair/approve') {
                        handlerPath = './api/pair/approve.ts';
                    } else if (subPath === 'pair/verify') {
                        handlerPath = './api/pair/verify.ts';
                    } else if (subPath === 'themes') {
                        handlerPath = './api/themes/index.ts';
                    } else if (subPath === 'yt/search') {
                        handlerPath = './api/yt/search.ts';
                    } else if (subPath === 'yt/stream') {
                        handlerPath = './api/yt/stream.ts';
                    } else if (subPath === 'yt/download') {
                        handlerPath = './api/yt/download.ts';
                    } else if (subPath === 'yt/proxy-stream') {
                        handlerPath = './api/yt/proxy-stream.ts';
                    } else if (subPath === 'yt/radio') {
                        handlerPath = './api/yt/radio.ts';
                    } else if (subPath === 'yt/playlist') {
                        handlerPath = './api/yt/playlist.ts';
                    } else if (subPath === 'import/spotify') {
                        handlerPath = './api/import/spotify.ts';
                    } else if (subPath === 'yt/user-playlists') {
                        handlerPath = './api/yt/user-playlists.ts';
                    } else if (subPath === 'yt/user-playlist-tracks') {
                        handlerPath = './api/yt/user-playlist-tracks.ts';
                    } else if (subPath.startsWith('users/')) {
                        handlerPath = './api/users/[username].ts';
                        routeParams.username = decodeURIComponent(subPath.slice(6));
                    } else if (subPath.startsWith('public/playlists/')) {
                        handlerPath = './api/public/playlists/[id].ts';
                        routeParams.id = decodeURIComponent(subPath.slice(17));
                    }

                    if (!handlerPath) {
                        res.statusCode = 404;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `API route not found: ${pathname}` }));
                        return;
                    }

                    const queryObj: Record<string, any> = { ...routeParams };
                    if (search) {
                        const searchParams = new URLSearchParams(search);
                        for (const [k, v] of searchParams.entries()) {
                            queryObj[k] = v;
                        }
                    }

                    let body: any = {};
                    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '')) {
                        const chunks: Uint8Array[] = [];
                        for await (const chunk of req) {
                            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                        }
                        const raw = Buffer.concat(chunks).toString('utf-8');
                        if (raw.trim()) {
                            try {
                                body = JSON.parse(raw);
                            } catch {
                                body = raw;
                            }
                        }
                    }

                    const vercelReq = Object.assign(req, {
                        query: queryObj,
                        body,
                    });

                    const vercelRes = Object.assign(res, {
                        status(code: number) {
                            res.statusCode = code;
                            return vercelRes;
                        },
                        json(data: any) {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify(data));
                            return vercelRes;
                        },
                        redirect(statusOrUrl: string | number, url?: string) {
                            const target = typeof statusOrUrl === 'string' ? statusOrUrl : url || '/';
                            const code = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
                            res.writeHead(code, { Location: target });
                            res.end();
                            return vercelRes;
                        },
                    });

                    const fullPath = path.resolve(process.cwd(), handlerPath);
                    const module = await server.ssrLoadModule(fullPath);
                    const handler = module.default;

                    if (typeof handler === 'function') {
                        await handler(vercelReq, vercelRes);
                    } else {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'Handler is not a function' }));
                    }
                } catch (err: any) {
                    console.error(`[Local API Error] ${pathname}:`, err);
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
                    }
                }
            });
        },
    };
}
