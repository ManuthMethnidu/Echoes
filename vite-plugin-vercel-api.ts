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

                if (!pathname.startsWith('/api/') && pathname !== '/api') {
                    return next();
                }

                try {
                    const queryObj: Record<string, any> = {};
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

                    const fullPath = path.resolve(process.cwd(), './api/index.ts');
                    const module = await server.ssrLoadModule(fullPath);
                    const handler = module.default;

                    if (typeof handler === 'function') {
                        await handler(vercelReq, vercelRes);
                    } else {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'Router handler is not a function' }));
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
