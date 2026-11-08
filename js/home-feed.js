// js/home-feed.js - YouTube Music & Spotify style personalized dynamic Home feed
import { db } from './db.js';
import { listeningTracker } from './listening-tracker.js';
import { smartRecommendations } from './smart-recommendations.js';
import { podcastsAPI } from './podcasts-api.js';
import { escapeHtml } from './utils.js';
import { navigate } from './router.js';

export class HomeFeed {
    constructor() {
        this.activeMood = null;
        this.cache = new Map();
        this.isLoading = false;
    }

    /**
     * Render the entire modern YouTube Music style Home feed
     */
    async render(ui) {
        const container = document.getElementById('home-content');
        if (!container) return;

        container.style.display = 'block';

        // Initial shell with mood bar and section placeholders
        container.innerHTML = `
            <!-- Mood / Activity Pills -->
            <div class="ytm-mood-bar" id="ytm-mood-bar">
                ${this.renderMoodChipsHTML()}
            </div>

            <!-- Dynamic Feed Sections Container -->
            <div id="ytm-sections-container">
                <div class="ytm-section-skeleton">
                    <div class="ytm-skeleton-line" style="width: 220px; height: 28px; margin-bottom: 16px;"></div>
                    <div class="ytm-carousel">
                        ${Array(5).fill('<div class="ytm-card-skeleton"></div>').join('')}
                    </div>
                </div>
            </div>
        `;

        this.attachMoodChipListeners(ui);

        // Populate sections
        await this.loadSections(ui);
    }

    renderMoodChipsHTML() {
        const moods = [
            'Energize',
            'Workout',
            'Relax',
            'Feel good',
            'Commute',
            'Romance',
            'Party',
            'Sad',
            'Sleep',
            'Focus',
        ];

        return moods
            .map(
                (mood) => `
            <button class="ytm-mood-chip ${this.activeMood === mood ? 'active' : ''}" data-mood="${escapeHtml(mood)}">
                ${escapeHtml(mood)}
            </button>
        `
            )
            .join('');
    }

    attachMoodChipListeners(ui) {
        const bar = document.getElementById('ytm-mood-bar');
        if (!bar) return;

        bar.querySelectorAll('.ytm-mood-chip').forEach((chip) => {
            chip.addEventListener('click', async () => {
                const mood = chip.dataset.mood;
                if (this.activeMood === mood) {
                    this.activeMood = null;
                    chip.classList.remove('active');
                } else {
                    bar.querySelectorAll('.ytm-mood-chip').forEach((c) => c.classList.remove('active'));
                    this.activeMood = mood;
                    chip.classList.add('active');
                }
                await this.loadSections(ui, true);
            });
        });
    }

    async loadSections(ui, forceRefresh = false) {
        const container = document.getElementById('ytm-sections-container');
        if (!container) return;

        try {
            const [
                listenAgain,
                quickPicks,
                forgottenFavorites,
                podcastShows,
                libraryPlaylists,
                albumsForYou,
                communityPlaylists,
            ] = await Promise.allSettled([
                this.getListenAgainItems(),
                this.getQuickPicksTracks(this.activeMood),
                this.getForgottenFavorites(),
                this.getShowsForYou(),
                this.getFromYourLibrary(),
                this.getAlbumsForYou(ui),
                this.getFromTheCommunity(ui),
            ]);

            const listenAgainData = listenAgain.status === 'fulfilled' ? listenAgain.value : [];
            const quickPicksData = quickPicks.status === 'fulfilled' ? quickPicks.value : [];
            const forgottenData = forgottenFavorites.status === 'fulfilled' ? forgottenFavorites.value : [];
            const podcastsData = podcastShows.status === 'fulfilled' ? podcastShows.value : [];
            const libraryData = libraryPlaylists.status === 'fulfilled' ? libraryPlaylists.value : [];
            const albumsData = albumsForYou.status === 'fulfilled' ? albumsForYou.value : [];
            const communityData = communityPlaylists.status === 'fulfilled' ? communityPlaylists.value : [];

            let html = '';

            // Section 1: Listen again
            if (listenAgainData.length > 0) {
                html += this.renderSquareCarouselSection({
                    id: 'listen-again',
                    title: 'Listen again',
                    subtitle: 'Jump back into your recent favorites',
                    items: listenAgainData,
                    moreHref: '/recent',
                });
            }

            // Section 2: Quick picks (3x3 grid)
            if (quickPicksData.length > 0) {
                html += this.renderQuickPicksSection({
                    id: 'quick-picks',
                    title: this.activeMood ? `${this.activeMood} picks` : 'Quick picks',
                    tracks: quickPicksData,
                });
            }

            // Section 3: Forgotten favorites (16:9 widescreen)
            if (forgottenData.length > 0) {
                html += this.renderWidescreenSection({
                    id: 'forgotten-favorites',
                    title: 'Forgotten favorites',
                    subtitle: 'Old favorites waiting for another spin',
                    items: forgottenData,
                });
            }

            // Section 4: Shows for you (Podcasts)
            if (podcastsData.length > 0) {
                html += this.renderPodcastShowsSection({
                    id: 'shows-for-you',
                    title: 'Shows for you',
                    subtitle: 'Top trending podcasts and series',
                    items: podcastsData,
                    moreHref: '/podcasts',
                });
            }

            // Section 5: From your library
            if (libraryData.length > 0) {
                html += this.renderSquareCarouselSection({
                    id: 'from-library',
                    title: 'From your library',
                    subtitle: 'Your custom playlists and saved collections',
                    items: libraryData,
                    moreHref: '/library',
                });
            }

            // Section 6: Albums for you
            if (albumsData.length > 0) {
                html += this.renderAlbumsSection({
                    id: 'albums-for-you',
                    title: 'Albums for you',
                    subtitle: 'Recommended full-length records for your taste',
                    items: albumsData,
                });
            }

            // Section 7: From the community
            if (communityData.length > 0) {
                html += this.renderCommunitySection({
                    id: 'community-playlists',
                    title: 'From the community',
                    subtitle: 'Curated playlists created by listeners',
                    items: communityData,
                });
            }

            container.innerHTML = html || `
                <div style="text-align: center; padding: 4rem 2rem; color: var(--muted-foreground);">
                    <h3>Welcome to Echoes</h3>
                    <p style="margin-top: 8px;">Start listening to tracks and albums to populate your personalized feed.</p>
                </div>
            `;

            this.attachCarouselControls(container, ui, {
                quickPicksData,
                listenAgainData,
                forgottenData,
                libraryData,
                podcastsData,
                albumsData,
                communityData,
            });
        } catch (err) {
            console.error('Failed to load home sections:', err);
            container.innerHTML = '<p style="color: var(--muted-foreground); text-align: center; padding: 2rem;">Could not load feed recommendations.</p>';
        }
    }

    // --- DATA PROVIDERS ---

    async getListenAgainItems() {
        const [history, favorites, playlists] = await Promise.all([
            db.getHistory(),
            db.getFavorites('track'),
            db.getPlaylists(true),
        ]);

        const items = [];
        const seen = new Set();

        // 1. Playlists
        for (const p of playlists.slice(0, 3)) {
            if (!p || !p.id) continue;
            items.push({
                id: p.id,
                type: 'playlist',
                title: p.name || 'Custom Playlist',
                subtitle: `${(p.tracks || []).length} tracks`,
                cover: p.cover || p.customCover || (p.tracks && p.tracks[0]?.cover) || '/images/default-cover.png',
                data: p,
            });
            seen.add(p.id);
        }

        // 2. High repeat tracks / albums from history
        const trackCounts = new Map();
        for (const t of history) {
            if (!t || !t.id) continue;
            trackCounts.set(t.id, (trackCounts.get(t.id) || 0) + 1);
        }

        const sortedHistory = [...history]
            .sort((a, b) => (trackCounts.get(b.id) || 0) - (trackCounts.get(a.id) || 0))
            .filter((t) => {
                if (seen.has(t.id)) return false;
                seen.add(t.id);
                return true;
            });

        for (const t of sortedHistory.slice(0, 8)) {
            const count = trackCounts.get(t.id) || 1;
            const artistName = t.artist?.name || (t.artists && t.artists[0]?.name) || 'Unknown Artist';
            items.push({
                id: t.id,
                type: 'track',
                title: t.title,
                subtitle: `${artistName} • ${count} ${count === 1 ? 'play' : 'plays'}`,
                cover: t.cover || t.image || t.album?.cover || '/images/default-cover.png',
                data: t,
            });
        }

        return items;
    }

    async getQuickPicksTracks(mood = null) {
        try {
            let seeds = await smartRecommendations.getSmartSeeds(24);
            if (mood) {
                // If a mood is selected, filter seeds or fetch mood matching tracks
                seeds = seeds.filter((t) => {
                    const text = `${t.title} ${t.artist?.name || ''} ${t.album?.title || ''}`.toLowerCase();
                    return true;
                });
            }
            return seeds.slice(0, 18);
        } catch {
            const history = await db.getHistory();
            return history.slice(0, 18);
        }
    }

    async getForgottenFavorites() {
        const [history, favorites] = await Promise.all([
            db.getHistory(),
            db.getFavorites('track'),
        ]);

        const pool = [...favorites, ...history];
        const counts = new Map();
        for (const t of pool) {
            if (!t || !t.id) continue;
            counts.set(t.id, (counts.get(t.id) || 0) + 1);
        }

        const now = Date.now();
        const TWENTY_ONE_DAYS = 21 * 24 * 60 * 60 * 1000;

        const forgotten = [];
        const seen = new Set();

        for (const t of pool) {
            if (!t || !t.id || seen.has(t.id)) continue;
            seen.add(t.id);

            const playedAt = t.playedAt || t.timestamp || 0;
            const isOldEnough = playedAt > 0 ? (now - playedAt > TWENTY_ONE_DAYS) : true;
            const playCount = counts.get(t.id) || 1;

            if (playCount >= 2 && isOldEnough) {
                forgotten.push({
                    id: t.id,
                    title: t.title,
                    subtitle: `${t.artist?.name || (t.artists && t.artists[0]?.name) || 'Unknown'}`,
                    cover: t.cover || t.image || t.album?.cover || '/images/default-cover.png',
                    data: t,
                });
            }
        }

        // If user hasn't been active for 21 days yet, take the earliest played tracks
        if (forgotten.length < 4) {
            for (const t of history.slice(-8)) {
                if (!seen.has(t.id + '_fb')) {
                    seen.add(t.id + '_fb');
                    forgotten.push({
                        id: t.id,
                        title: t.title,
                        subtitle: t.artist?.name || 'Artist',
                        cover: t.cover || t.image || '/images/default-cover.png',
                        data: t,
                    });
                }
            }
        }

        return forgotten.slice(0, 10);
    }

    async getShowsForYou() {
        try {
            const result = await podcastsAPI.getTrendingPodcasts({ max: 10 });
            return (result.items || []).map((feed) => ({
                id: feed.id,
                title: feed.title,
                subtitle: feed.author || 'Podcast',
                cover: feed.image || feed.artwork || '/images/default-cover.png',
                data: feed,
            }));
        } catch (e) {
            console.warn('Could not load shows for you:', e);
            return [];
        }
    }

    async getFromYourLibrary() {
        const playlists = await db.getPlaylists(true);
        return playlists.map((p) => ({
            id: p.id,
            title: p.name,
            subtitle: `${(p.tracks || []).length} tracks`,
            cover: p.cover || p.customCover || (p.tracks && p.tracks[0]?.cover) || '/images/default-cover.png',
            data: p,
        }));
    }

    async getAlbumsForYou(ui) {
        try {
            const topArtists = listeningTracker.getTopArtists(5);
            if (topArtists.length === 0) return [];

            const albums = [];
            const seen = new Set();

            for (const artist of topArtists.slice(0, 3)) {
                try {
                    const res = await ui.api.getArtist(artist.id);
                    if (res && Array.isArray(res.albums)) {
                        for (const a of res.albums.slice(0, 3)) {
                            if (!seen.has(a.id)) {
                                seen.add(a.id);
                                albums.push({
                                    id: a.id,
                                    title: a.title,
                                    subtitle: `Album • ${artist.name}`,
                                    cover: a.cover || a.image || '/images/default-cover.png',
                                    data: a,
                                });
                            }
                        }
                    }
                } catch {}
            }
            return albums.slice(0, 10);
        } catch {
            return [];
        }
    }

    async getFromTheCommunity(ui) {
        try {
            // Fetch public / community playlists
            const playlists = await ui.api.searchPlaylists?.('top hits') || { items: [] };
            const items = playlists.items || [];
            return items.slice(0, 10).map((p) => ({
                id: p.id,
                title: p.title || p.name,
                subtitle: `${p.creator || p.author || 'Community'} • ${(p.trackCount || 25)} tracks`,
                cover: p.cover || p.image || '/images/default-cover.png',
                creator: p.creator || p.author || 'Curator',
                data: p,
            }));
        } catch {
            return [];
        }
    }

    // --- RENDERERS ---

    renderSquareCarouselSection({ id, title, subtitle, items, moreHref }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="ytm-section-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <div class="ytm-section-actions">
                        ${moreHref ? `<a href="${moreHref}" class="ytm-more-btn">More</a>` : ''}
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-carousel">
                    ${items
                        .map(
                            (item) => `
                        <div class="ytm-card" data-item-id="${escapeHtml(String(item.id))}" data-item-type="${escapeHtml(item.type || 'item')}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(item.cover)}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-play-badge">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                            </div>
                            <div class="ytm-card-title">${escapeHtml(item.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(item.subtitle)}</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderQuickPicksSection({ id, title, tracks }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <span class="ytm-section-pill-tag">START RADIO</span>
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                    </div>
                    <div class="ytm-section-actions">
                        <button class="ytm-play-all-btn" id="ytm-quick-picks-play-all">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Play all</span>
                        </button>
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-quick-picks-carousel">
                    ${tracks
                        .map(
                            (track) => `
                        <div class="ytm-quick-pick-item" data-track-id="${escapeHtml(track.id)}">
                            <div class="ytm-qp-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(track.cover || track.image || '/images/default-cover.png')}" alt="" class="ytm-qp-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-qp-play-hover">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                            </div>
                            <div class="ytm-qp-info">
                                <div class="ytm-qp-title">${escapeHtml(track.title)}</div>
                                <div class="ytm-qp-meta">${escapeHtml(track.artist?.name || (track.artists && track.artists[0]?.name) || 'Artist')}</div>
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderWidescreenSection({ id, title, subtitle, items }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="ytm-section-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <div class="ytm-section-actions">
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-carousel">
                    ${items
                        .map(
                            (item) => `
                        <div class="ytm-wide-card" data-item-id="${escapeHtml(String(item.id))}">
                            <div class="ytm-wide-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(item.cover)}" alt="" class="ytm-wide-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-wide-play-badge">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                            </div>
                            <div class="ytm-card-title">${escapeHtml(item.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(item.subtitle)}</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderPodcastShowsSection({ id, title, subtitle, items, moreHref }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="ytm-section-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <div class="ytm-section-actions">
                        ${moreHref ? `<a href="${moreHref}" class="ytm-more-btn">More</a>` : ''}
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-carousel">
                    ${items
                        .map(
                            (show) => `
                        <div class="ytm-card ytm-podcast-card" data-podcast-id="${escapeHtml(String(show.id))}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(show.cover)}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                            </div>
                            <div class="ytm-card-title">${escapeHtml(show.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(show.subtitle)}</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderAlbumsSection({ id, title, subtitle, items }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="ytm-section-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <div class="ytm-section-actions">
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-carousel">
                    ${items
                        .map(
                            (album) => `
                        <div class="ytm-card ytm-album-card" data-album-id="${escapeHtml(String(album.id))}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(album.cover)}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-play-badge">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                            </div>
                            <div class="ytm-card-title">${escapeHtml(album.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(album.subtitle)}</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderCommunitySection({ id, title, subtitle, items }) {
        return `
            <section class="ytm-section" id="ytm-section-${id}">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">${escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="ytm-section-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                    <div class="ytm-section-actions">
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-carousel">
                    ${items
                        .map(
                            (item) => `
                        <div class="ytm-card ytm-community-card" data-playlist-id="${escapeHtml(String(item.id))}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(item.cover)}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-creator-avatar" title="${escapeHtml(item.creator || 'Community')}">
                                    ${escapeHtml((item.creator || 'C')[0].toUpperCase())}
                                </div>
                            </div>
                            <div class="ytm-card-title">${escapeHtml(item.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(item.subtitle)}</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    attachCarouselControls(container, ui, datasets) {
        // Wire all Prev / Next chevron buttons
        container.querySelectorAll('.ytm-section').forEach((section) => {
            const carousel = section.querySelector('.ytm-carousel, .ytm-quick-picks-carousel');
            const prevBtn = section.querySelector('.ytm-prev');
            const nextBtn = section.querySelector('.ytm-next');

            if (carousel && prevBtn && nextBtn) {
                prevBtn.addEventListener('click', () => {
                    carousel.scrollBy({ left: -carousel.clientWidth * 0.75, behavior: 'smooth' });
                });
                nextBtn.addEventListener('click', () => {
                    carousel.scrollBy({ left: carousel.clientWidth * 0.75, behavior: 'smooth' });
                });
            }
        });

        // Wire "Play all" on Quick Picks
        const playAllBtn = document.getElementById('ytm-quick-picks-play-all');
        if (playAllBtn && datasets.quickPicksData?.length > 0) {
            playAllBtn.addEventListener('click', async () => {
                if (ui.player) {
                    await ui.player.setQueue(datasets.quickPicksData, 0);
                    await ui.player.playTrack(datasets.quickPicksData[0]);
                }
            });
        }

        // Wire individual Quick Pick tracks
        container.querySelectorAll('.ytm-quick-pick-item').forEach((item) => {
            item.addEventListener('click', async () => {
                const trackId = item.dataset.trackId;
                const track = datasets.quickPicksData?.find((t) => t.id === trackId);
                if (track && ui.player) {
                    await ui.player.playTrack(track);
                }
            });
        });

        // Wire Listen Again cards
        container.querySelectorAll('#ytm-section-listen-again .ytm-card').forEach((card) => {
            card.addEventListener('click', async () => {
                const itemId = card.dataset.itemId;
                const itemType = card.dataset.itemType;
                const match = datasets.listenAgainData?.find((i) => String(i.id) === itemId);
                if (match) {
                    if (itemType === 'playlist') {
                        navigate(`/playlist/${itemId}`);
                    } else if (match.data && ui.player) {
                        await ui.player.playTrack(match.data);
                    }
                }
            });
        });

        // Wire Forgotten Favorites cards
        container.querySelectorAll('#ytm-section-forgotten-favorites .ytm-wide-card').forEach((card) => {
            card.addEventListener('click', async () => {
                const itemId = card.dataset.itemId;
                const match = datasets.forgottenData?.find((i) => String(i.id) === itemId);
                if (match && match.data && ui.player) {
                    await ui.player.playTrack(match.data);
                }
            });
        });

        // Wire Podcast cards
        container.querySelectorAll('.ytm-podcast-card').forEach((card) => {
            card.addEventListener('click', () => {
                const podcastId = card.dataset.podcastId;
                if (podcastId) navigate(`/podcasts/${podcastId}`);
            });
        });

        // Wire Library cards
        container.querySelectorAll('#ytm-section-from-library .ytm-card').forEach((card) => {
            card.addEventListener('click', () => {
                const playlistId = card.dataset.itemId;
                if (playlistId) navigate(`/playlist/${playlistId}`);
            });
        });

        // Wire Album cards
        container.querySelectorAll('.ytm-album-card').forEach((card) => {
            card.addEventListener('click', () => {
                const albumId = card.dataset.albumId;
                if (albumId) navigate(`/album/${albumId}`);
            });
        });

        // Wire Community Playlist cards
        container.querySelectorAll('.ytm-community-card').forEach((card) => {
            card.addEventListener('click', () => {
                const playlistId = card.dataset.playlistId;
                if (playlistId) navigate(`/playlist/${playlistId}`);
            });
        });
    }
}

export const homeFeed = new HomeFeed();
