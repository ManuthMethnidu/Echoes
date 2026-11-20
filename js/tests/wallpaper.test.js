import { describe, it, expect } from 'vitest';
import {
    parseYouTubeVideoId,
    getYouTubeEmbedUrl,
    detectMediaType,
} from '../wallpaper.js';

describe('wallpaper module', () => {
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

        it('returns null for non-YouTube URLs', () => {
            expect(parseYouTubeVideoId('https://example.com/video.mp4')).toBeNull();
            expect(parseYouTubeVideoId('')).toBeNull();
            expect(parseYouTubeVideoId(null)).toBeNull();
        });
    });

    describe('getYouTubeEmbedUrl', () => {
        it('constructs muted, looping, ad-free embed URL', () => {
            const url = getYouTubeEmbedUrl('5qap5aO4i9A');
            expect(url).toContain('https://www.youtube-nocookie.com/embed/5qap5aO4i9A');
            expect(url).toContain('autoplay=1');
            expect(url).toContain('mute=1'); // Muted so it does not conflict with music playback
            expect(url).toContain('loop=1');
            expect(url).toContain('controls=0');
            expect(url).toContain('playlist=5qap5aO4i9A');
        });
    });

    describe('detectMediaType', () => {
        it('detects iframe for YouTube URLs', () => {
            expect(detectMediaType('https://www.youtube.com/watch?v=5qap5aO4i9A')).toBe('iframe');
            expect(detectMediaType('https://youtu.be/5qap5aO4i9A')).toBe('iframe');
            expect(detectMediaType('https://example.com/embed/player')).toBe('iframe');
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
