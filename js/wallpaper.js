/**
 * Custom Background & Live Wallpaper Manager for Echoes
 * Supports zero-hosting-cost local file uploads (stored in IndexedDB),
 * direct image/video URLs (.jpg, .png, .gif, .mp4, .webm), and lightweight
 * canvas-based live wallpaper presets.
 */

const DB_NAME = 'echoes_wallpaper_db';
const DB_VERSION = 1;
const STORE_NAME = 'wallpapers';
const CONFIG_KEY = 'echoes_wallpaper_config';

const DEFAULT_CONFIG = {
    type: 'none', // 'none' | 'preset' | 'url' | 'local'
    mediaType: 'image', // 'image' | 'video'
    url: '',
    preset: 'none', // 'aurora' | 'starfield' | 'rain' | 'neon-waves'
    opacity: 0.5,
    blur: 0,
    scope: 'both', // 'both' | 'app' | 'fullscreen'
};

let activeBlobUrl = null;
let animationFrameId = null;
let currentPresetRenderer = null;

// IndexedDB Helper for zero-resource local file persistence
function openWallpaperDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function storeLocalBlob(blob, mimeType) {
    try {
        const db = await openWallpaperDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ blob, mimeType, timestamp: Date.now() }, 'active_wallpaper');
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[Wallpaper] Failed to store blob in IndexedDB:', e);
        return false;
    }
}

async function getStoredLocalBlob() {
    try {
        const db = await openWallpaperDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get('active_wallpaper');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function deleteStoredLocalBlob() {
    try {
        const db = await openWallpaperDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete('active_wallpaper');
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

export function getWallpaperConfig() {
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (!raw) return { ...DEFAULT_CONFIG };
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function setWallpaperConfig(config) {
    try {
        const merged = { ...getWallpaperConfig(), ...config };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
        return merged;
    } catch (e) {
        console.warn('[Wallpaper] Failed to save config:', e);
        return { ...DEFAULT_CONFIG, ...config };
    }
}

// Built-in Lightweight Zero-Resource Canvas Live Wallpaper Presets
function createPresetRenderer(preset, canvas) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    if (preset === 'aurora') {
        let t = 0;
        return {
            render() {
                t += 0.006;
                ctx.clearRect(0, 0, width, height);

                const g1 = ctx.createRadialGradient(
                    width * 0.3 + Math.sin(t) * 120,
                    height * 0.4 + Math.cos(t * 0.8) * 90,
                    10,
                    width * 0.3,
                    height * 0.4,
                    width * 0.65
                );
                g1.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
                g1.addColorStop(0.5, 'rgba(168, 85, 247, 0.25)');
                g1.addColorStop(1, 'rgba(0, 0, 0, 0)');

                const g2 = ctx.createRadialGradient(
                    width * 0.75 + Math.cos(t * 1.1) * 130,
                    height * 0.65 + Math.sin(t * 0.9) * 100,
                    20,
                    width * 0.75,
                    height * 0.65,
                    width * 0.6
                );
                g2.addColorStop(0, 'rgba(30, 215, 96, 0.38)');
                g2.addColorStop(0.5, 'rgba(14, 165, 233, 0.2)');
                g2.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle = g1;
                ctx.fillRect(0, 0, width, height);
                ctx.fillStyle = g2;
                ctx.fillRect(0, 0, width, height);
            },
            cleanup() {
                window.removeEventListener('resize', onResize);
            },
        };
    }

    if (preset === 'starfield') {
        const count = 160;
        const stars = Array.from({ length: count }, () => ({
            x: (Math.random() - 0.5) * width * 2,
            y: (Math.random() - 0.5) * height * 2,
            z: Math.random() * width,
            size: Math.random() * 1.8 + 0.6,
        }));

        return {
            render() {
                ctx.fillStyle = 'rgba(11, 13, 17, 0.35)';
                ctx.fillRect(0, 0, width, height);

                const cx = width / 2;
                const cy = height / 2;

                for (let i = 0; i < count; i++) {
                    const star = stars[i];
                    star.z -= 1.8;
                    if (star.z <= 0) {
                        star.z = width;
                        star.x = (Math.random() - 0.5) * width * 2;
                        star.y = (Math.random() - 0.5) * height * 2;
                    }

                    const k = 250 / star.z;
                    const px = star.x * k + cx;
                    const py = star.y * k + cy;

                    if (px >= 0 && px < width && py >= 0 && py < height) {
                        const alpha = Math.min(1, (1 - star.z / width) * 1.4);
                        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                        ctx.beginPath();
                        ctx.arc(px, py, star.size * Math.min(k * 1.2, 2.5), 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            },
            cleanup() {
                window.removeEventListener('resize', onResize);
            },
        };
    }

    if (preset === 'rain') {
        const dropCount = 90;
        const drops = Array.from({ length: dropCount }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            len: Math.random() * 24 + 14,
            speed: Math.random() * 7 + 8,
            opacity: Math.random() * 0.4 + 0.2,
        }));

        return {
            render() {
                ctx.clearRect(0, 0, width, height);
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';

                for (let i = 0; i < dropCount; i++) {
                    const d = drops[i];
                    ctx.beginPath();
                    ctx.moveTo(d.x, d.y);
                    ctx.lineTo(d.x - 1, d.y + d.len);
                    ctx.stroke();

                    d.y += d.speed;
                    if (d.y > height) {
                        d.y = -d.len;
                        d.x = Math.random() * width;
                    }
                }
            },
            cleanup() {
                window.removeEventListener('resize', onResize);
            },
        };
    }

    if (preset === 'neon-waves') {
        let step = 0;
        return {
            render() {
                step += 0.02;
                ctx.clearRect(0, 0, width, height);

                const lines = 4;
                for (let j = 0; j < lines; j++) {
                    ctx.beginPath();
                    ctx.lineWidth = 2;
                    const hue = (j * 45 + step * 20) % 360;
                    ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.35)`;

                    for (let x = 0; x < width; x += 15) {
                        const y =
                            height * 0.6 +
                            Math.sin(x * 0.004 + step + j * 0.8) * 50 +
                            Math.cos(x * 0.002 - step * 0.5) * 30;
                        if (x === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
            },
            cleanup() {
                window.removeEventListener('resize', onResize);
            },
        };
    }

    return null;
}

export async function applyCustomWallpaper() {
    const config = getWallpaperConfig();
    const layer = document.getElementById('custom-wallpaper-layer');
    const fsLayer = document.getElementById('fullscreen-custom-wallpaper-layer');

    if (!layer) return;

    const imgEl = layer.querySelector('.wallpaper-img');
    const vidEl = layer.querySelector('.wallpaper-video');
    const canvasEl = layer.querySelector('.wallpaper-canvas');

    const fsImgEl = fsLayer?.querySelector('.wallpaper-img');
    const fsVidEl = fsLayer?.querySelector('.wallpaper-video');
    const fsCanvasEl = fsLayer?.querySelector('.wallpaper-canvas');

    // Clean up previous animation / video
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (currentPresetRenderer) {
        currentPresetRenderer.cleanup();
        currentPresetRenderer = null;
    }

    // Set styling variables
    document.documentElement.style.setProperty('--wallpaper-opacity', String(config.opacity));
    document.documentElement.style.setProperty('--wallpaper-blur', `${config.blur}px`);

    const showInApp = config.type !== 'none' && (config.scope === 'both' || config.scope === 'app');
    const showInFs = config.type !== 'none' && (config.scope === 'both' || config.scope === 'fullscreen');

    document.body.classList.toggle('has-custom-wallpaper', showInApp);
    document.body.classList.toggle('has-custom-wallpaper-fullscreen', showInFs);

    layer.style.display = showInApp ? 'block' : 'none';
    if (fsLayer) fsLayer.style.display = showInFs ? 'block' : 'none';

    if (config.type === 'none') {
        if (vidEl) vidEl.src = '';
        if (fsVidEl) fsVidEl.src = '';
        if (imgEl) imgEl.style.backgroundImage = 'none';
        if (fsImgEl) fsImgEl.style.backgroundImage = 'none';
        return;
    }

    let mediaUrl = config.url;

    if (config.type === 'local') {
        const stored = await getStoredLocalBlob();
        if (stored && stored.blob) {
            if (activeBlobUrl) {
                URL.revokeObjectURL(activeBlobUrl);
            }
            activeBlobUrl = URL.createObjectURL(stored.blob);
            mediaUrl = activeBlobUrl;
            config.mediaType = stored.mimeType?.startsWith('video/') ? 'video' : 'image';
        }
    }

    // Preset Live Canvas
    if (config.type === 'preset' && config.preset !== 'none') {
        if (vidEl) vidEl.style.display = 'none';
        if (imgEl) imgEl.style.display = 'none';
        if (canvasEl) canvasEl.style.display = 'block';

        if (fsVidEl) fsVidEl.style.display = 'none';
        if (fsImgEl) fsImgEl.style.display = 'none';
        if (fsCanvasEl) fsCanvasEl.style.display = 'block';

        currentPresetRenderer = createPresetRenderer(config.preset, canvasEl);
        if (currentPresetRenderer) {
            const loop = () => {
                if (document.visibilityState === 'visible' && currentPresetRenderer) {
                    currentPresetRenderer.render();
                }
                animationFrameId = requestAnimationFrame(loop);
            };
            loop();
        }
        return;
    }

    // Video Live Wallpaper
    if (config.mediaType === 'video' && mediaUrl) {
        if (canvasEl) canvasEl.style.display = 'none';
        if (imgEl) imgEl.style.display = 'none';
        if (vidEl) {
            vidEl.style.display = 'block';
            if (vidEl.src !== mediaUrl) {
                vidEl.src = mediaUrl;
                vidEl.load();
            }
            vidEl.play().catch(() => {});
        }
        if (fsVidEl && fsLayer) {
            fsVidEl.style.display = 'block';
            if (fsVidEl.src !== mediaUrl) {
                fsVidEl.src = mediaUrl;
                fsVidEl.load();
            }
            fsVidEl.play().catch(() => {});
        }
        return;
    }

    // Image Background Wallpaper
    if (mediaUrl) {
        if (canvasEl) canvasEl.style.display = 'none';
        if (vidEl) {
            vidEl.style.display = 'none';
            vidEl.src = '';
        }
        if (imgEl) {
            imgEl.style.display = 'block';
            imgEl.style.backgroundImage = `url('${mediaUrl}')`;
        }
        if (fsImgEl) {
            fsImgEl.style.display = 'block';
            fsImgEl.style.backgroundImage = `url('${mediaUrl}')`;
        }
    }
}

export async function setWallpaperFromUrl(url, mediaType = 'image') {
    const isVideo = mediaType === 'video' || /\.(mp4|webm|ogv|mov)(\?.*)?$/i.test(url);
    setWallpaperConfig({
        type: 'url',
        mediaType: isVideo ? 'video' : 'image',
        url,
        preset: 'none',
    });
    await applyCustomWallpaper();
}

export async function setWallpaperFromFile(file) {
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    await storeLocalBlob(file, file.type);
    setWallpaperConfig({
        type: 'local',
        mediaType: isVideo ? 'video' : 'image',
        url: '',
        preset: 'none',
    });
    await applyCustomWallpaper();
}

export async function setWallpaperPreset(preset) {
    setWallpaperConfig({
        type: 'preset',
        preset,
        url: '',
    });
    await applyCustomWallpaper();
}

export async function clearCustomWallpaper() {
    await deleteStoredLocalBlob();
    if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
    }
    setWallpaperConfig({
        type: 'none',
        url: '',
        preset: 'none',
    });
    await applyCustomWallpaper();
}

export function initWallpaper() {
    // Pause live video/canvas wallpaper when tab is hidden to save energy
    document.addEventListener('visibilitychange', () => {
        const vidEl = document.querySelector('#custom-wallpaper-layer .wallpaper-video');
        const fsVidEl = document.querySelector('#fullscreen-custom-wallpaper-layer .wallpaper-video');
        if (document.visibilityState === 'hidden') {
            vidEl?.pause();
            fsVidEl?.pause();
        } else {
            vidEl?.play().catch(() => {});
            fsVidEl?.play().catch(() => {});
        }
    });

    return applyCustomWallpaper();
}
