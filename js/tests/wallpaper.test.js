import { describe, it, expect } from 'vitest';
import {
    extractUrlFromInput,
    normalizeIframeUrl,
    parseYouTubeVideoId,
    getYouTubeEmbedUrl,
    detectMediaType,
} from '../wallpaper.js';

describe('wallpaper module', () => {
    describe('extractUrlFromInput', () => {
        it('extracts src from raw HTML iframe embed snippet', () => {
            const html = '<iframe width="560" height="315" src="https://www.shadertoy.com/embed/mtyGWy?gui=false" frameborder="0" allowfullscreen></iframe>';
            expect(extractUrlFromInput(html)).toBe('https://www.shadertoy.com/embed/mtyGWy?gui=false');
        });

        it('extracts src from standard YouTube embed iframe code with tracking params', () => {
            const ytEmbedHtml =
                '<iframe width="560" height="315" src="https://www.youtube.com/embed/_QK2y9BkKEo?si=49mmoxwfl0jR_sB5" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
            expect(extractUrlFromInput(ytEmbedHtml)).toBe('https://www.youtube.com/embed/_QK2y9BkKEo?si=49mmoxwfl0jR_sB5');
            expect(parseYouTubeVideoId(ytEmbedHtml)).toBe('_QK2y9BkKEo');
            expect(detectMediaType(ytEmbedHtml)).toBe('iframe');
            const normalized = normalizeIframeUrl(ytEmbedHtml, true);
            expect(normalized).toContain('https://www.youtube-nocookie.com/embed/_QK2y9BkKEo');
            expect(normalized).toContain('mute=1');
            expect(normalized).toContain('autoplay=1');
        });

        it('extracts URL from plain string or quoted URL', () => {
            expect(extractUrlFromInput('https://threejs.org/examples/webgl_shaders_ocean.html')).toBe(
                'https://threejs.org/examples/webgl_shaders_ocean.html'
            );
            expect(extractUrlFromInput('"https://example.com/live"')).toBe('https://example.com/live');
        });
    });

    describe('normalizeIframeUrl', () => {
        it('normalizes YouTube URLs to embed format with mute param', () => {
            const embed = normalizeIframeUrl('https://www.youtube.com/watch?v=5qap5aO4i9A', true);
            expect(embed).toContain('https://www.youtube-nocookie.com/embed/5qap5aO4i9A');
            expect(embed).toContain('mute=1');

            const unmuted = normalizeIframeUrl('https://www.youtube.com/watch?v=5qap5aO4i9A', false);
            expect(unmuted).toContain('mute=0');
        });

        it('normalizes Vimeo URLs to embed player format', () => {
            const vimeoEmbed = normalizeIframeUrl('https://vimeo.com/76979871', true);
            expect(vimeoEmbed).toContain('https://player.vimeo.com/video/76979871');
            expect(vimeoEmbed).toContain('muted=1');
        });

        it('preserves generic web URLs and webgl embeds as-is', () => {
            const webgl = 'https://www.shadertoy.com/embed/mtyGWy?gui=false';
            expect(normalizeIframeUrl(webgl, true)).toBe(webgl);
        });
    });

    describe('parseYouTubeVideoId', () => {
        it('parses youtube.com/watch?v= URLs', () => {
            expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=5qap5aO4i9A')).toBe('5qap5aO4i9A');
            expect(parseYouTubeVideoId('https://youtube.com/watch?v=5qap5aO4i9A&t=120s')).toBe('5qap5aO4i9A');
        });

        it('parses youtu.be/ short links', () => {
            expect(parseYouTubeVideoId('https://youtu.be/5qap5aO4i9A')).toBe('5qap5aO4i9A');
            expect(parseYouTubeVideoId('https://youtu.be/5qap5aO4i9A?si=xyz123')).toBe('5qap5aO4i9A');
        });

        it('parses youtube.com/shorts/ and live links', () => {
            expect(parseYouTubeVideoId('https://www.youtube.com/shorts/5qap5aO4i9A')).toBe('5qap5aO4i9A');
            expect(parseYouTubeVideoId('https://www.youtube.com/live/5qap5aO4i9A')).toBe('5qap5aO4i9A');
        });

        it('parses iframe snippet containing YouTube URL', () => {
            const snippet = '<iframe src="https://www.youtube.com/watch?v=5qap5aO4i9A"></iframe>';
            expect(parseYouTubeVideoId(snippet)).toBe('5qap5aO4i9A');
        });

        it('returns null for non-YouTube URLs', () => {
            expect(parseYouTubeVideoId('https://example.com/video.mp4')).toBeNull();
            expect(parseYouTubeVideoId('')).toBeNull();
            expect(parseYouTubeVideoId(null)).toBeNull();
        });
    });

    describe('getYouTubeEmbedUrl', () => {
        it('constructs muted, looping, ad-free embed URL', () => {
            const url = getYouTubeEmbedUrl('5qap5aO4i9A', true);
            expect(url).toContain('https://www.youtube-nocookie.com/embed/5qap5aO4i9A');
            expect(url).toContain('autoplay=1');
            expect(url).toContain('mute=1'); // Muted so it does not conflict with music playback
            expect(url).toContain('loop=1');
            expect(url).toContain('controls=0');
            expect(url).toContain('playlist=5qap5aO4i9A');
        });

        it('supports unmuted embed URL when requested', () => {
            const url = getYouTubeEmbedUrl('5qap5aO4i9A', false);
            expect(url).toContain('mute=0');
        });
    });

    describe('detectMediaType', () => {
        it('detects iframe for YouTube URLs, Vimeo, iframe tags, and generic sites', () => {
            expect(detectMediaType('https://www.youtube.com/watch?v=5qap5aO4i9A')).toBe('iframe');
            expect(detectMediaType('https://youtu.be/5qap5aO4i9A')).toBe('iframe');
            expect(detectMediaType('https://vimeo.com/76979871')).toBe('iframe');
            expect(detectMediaType('<iframe src="https://example.com/canvas"></iframe>')).toBe('iframe');
            expect(detectMediaType('https://example.com/embed/player')).toBe('iframe');
            expect(detectMediaType('https://shadertoy.com/view/4dXGR4')).toBe('iframe');
        });

        it('detects video for direct video files', () => {
            expect(detectMediaType('https://example.com/ambient.mp4')).toBe('video');
            expect(detectMediaType('https://cdn.site.com/loops/stars.webm?token=123')).toBe('video');
        });

        it('detects image for image files or default URLs', () => {
            expect(detectMediaType('https://images.unsplash.com/photo-1234?auto=format')).toBe('image');
            expect(detectMediaType('https://example.com/wallpaper.png')).toBe('image');
        });
    });
});
