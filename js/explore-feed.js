// js/explore-feed.js - Modern YouTube Music style Explore / Browse experience
import { podcastsAPI } from './podcasts-api.js';
import { Player } from './player.js';
import { escapeHtml, trackDataStore } from './utils.js';
import { navigate } from './router.js';

export const MOODS_AND_GENRES = [
    { name: 'Commute', color: '#F4B400', id: 'commute' },
    { name: 'R&B & soul', color: '#8E24AA', id: 'rnb' },
    { name: 'Punjabi', color: '#FB8C00', id: 'punjabi' },
    { name: 'Hindustani classical', color: '#E91E63', id: 'hindustani_classical' },
    { name: 'Country & Americana', color: '#1E88E5', id: 'country' },
    { name: '1980s', color: '#43A047', id: '1980s' },
    { name: 'Hip-hop', color: '#FF5722', id: 'hip_hop' },
    { name: 'Feel good', color: '#26A69A', id: 'feel_good' },
    { name: 'Classical', color: '#B0BEC5', id: 'classical' },
    { name: '1960s', color: '#81C784', id: '1960s' },
    { name: 'Rock en Español', color: '#E53935', id: 'rock_en_espanol' },
    { name: 'Latin', color: '#FDD835', id: 'latin' },
    { name: 'Party', color: '#7B1FA2', id: 'party' },
    { name: 'Romance', color: '#C2185B', id: 'romance' },
    { name: 'Arabic', color: '#FBC02D', id: 'arabic' },
    { name: 'Hindi', color: '#FFA000', id: 'hindi' },
    { name: 'Pop', color: '#EC407A', id: 'pop' },
    { name: 'Indie & alternative', color: '#ECEFF1', id: 'indierock' },
    { name: '1990s', color: '#66BB6A', id: '1990s' },
    { name: 'Bengali', color: '#FFD54F', id: 'bengali' },
    { name: 'Malayalam', color: '#4CAF50', id: 'malayalam' },
    { name: 'Rock', color: '#D32F2F', id: 'rock' },
    { name: 'Energize', color: '#F57F17', id: 'energize' },
    { name: 'Desi hip-hop', color: '#FFFFFF', id: 'desi_hip_hop' },
];

export class ExploreFeed {
    constructor() {
        this.cache = new Map();
        this.isLoading = false;
    }

    async render(ui) {
        const container = document.getElementById('explore-view-container');
        if (!container) return;

        container.innerHTML = `
            <!-- Top Category Cards -->
            <div class="ytm-explore-top-cards">
                <div class="ytm-explore-top-card" data-action="new-releases">
                    <div class="ytm-explore-top-icon">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </div>
                    <div class="ytm-explore-top-title">New releases</div>
                </div>
                <div class="ytm-explore-top-card" data-action="charts">
                    <div class="ytm-explore-top-icon">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>
                        </svg>
                    </div>
                    <div class="ytm-explore-top-title">Charts</div>
                </div>
                <div class="ytm-explore-top-card" data-action="moods-genres">
                    <div class="ytm-explore-top-icon">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>
                        </svg>
                    </div>
                    <div class="ytm-explore-top-title">Moods & genres</div>
                </div>
                <div class="ytm-explore-top-card" data-action="podcasts">
                    <div class="ytm-explore-top-icon">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    </div>
                    <div class="ytm-explore-top-title">Podcasts</div>
                </div>
            </div>

            <!-- Explore Sections Placeholder -->
            <div id="ytm-explore-sections-container">
                <div class="ytm-section-skeleton">
                    <div class="ytm-skeleton-line" style="width: 240px; height: 28px; margin-bottom: 16px;"></div>
                    <div class="ytm-carousel">
                        ${Array(5).fill('<div class="ytm-card-skeleton"></div>').join('')}
                    </div>
                </div>
            </div>
        `;

        this.attachTopCardsListeners();
        await this.loadExploreSections(ui);
    }

    attachTopCardsListeners() {
        const topCards = document.querySelectorAll('.ytm-explore-top-card');
        topCards.forEach((card) => {
            card.addEventListener('click', () => {
                const action = card.dataset.action;
                if (action === 'new-releases') {
                    document.getElementById('explore-section-new-releases')?.scrollIntoView({ behavior: 'smooth' });
                } else if (action === 'charts') {
                    document.getElementById('explore-section-charts')?.scrollIntoView({ behavior: 'smooth' });
                } else if (action === 'moods-genres') {
                    document.getElementById('explore-section-moods-genres')?.scrollIntoView({ behavior: 'smooth' });
                } else if (action === 'podcasts') {
                    const podSection = document.getElementById('explore-section-podcasts');
                    if (podSection) {
                        podSection.scrollIntoView({ behavior: 'smooth' });
                    } else {
                        navigate('/podcasts');
                    }
                }
            });
        });
    }

    async loadExploreSections(ui) {
        const container = document.getElementById('ytm-explore-sections-container');
        if (!container) return;

        try {
            const [newReleases, topSongs, podcasts] = await Promise.allSettled([
                this.getNewReleases(ui),
                this.getTopSongs(ui),
                this.getTrendingPodcasts(),
            ]);

            const newReleasesData = newReleases.status === 'fulfilled' ? newReleases.value : [];
            const topSongsData = topSongs.status === 'fulfilled' ? topSongs.value : [];
            const podcastsData = podcasts.status === 'fulfilled' ? podcasts.value : [];

            let html = '';

            // 1. New albums & singles
            if (newReleasesData.length > 0) {
                html += this.renderNewReleasesSection(newReleasesData);
            }

            // 2. Top songs (Charts)
            if (topSongsData.length > 0) {
                html += this.renderTopSongsSection(topSongsData);
            }

            // 3. Moods & genres
            html += this.renderMoodsAndGenresSection();

            // 4. Podcasts
            if (podcastsData.length > 0) {
                html += this.renderPodcastsSection(podcastsData);
            }

            container.innerHTML = html;
            this.attachExploreControls(container, ui, {
                newReleasesData,
                topSongsData,
                podcastsData,
            });
        } catch (err) {
            console.error('Failed to load explore sections:', err);
            container.innerHTML = '<p style="color: var(--muted-foreground); text-align: center; padding: 2rem;">Could not load browse content.</p>';
        }
    }

    // --- DATA PROVIDERS ---

    async getNewReleases(ui) {
        try {
            const res = await ui.api?.searchAlbums('2026 new release') || await ui.api?.searchAlbums('latest releases');
            if (res && Array.isArray(res.items) && res.items.length > 0) {
                return res.items.slice(0, 14).map((item) => ({
                    id: item.id,
                    title: item.title,
                    artist: item.artist?.name || (item.artists && item.artists[0]?.name) || (typeof item.artist === 'string' ? item.artist : 'Artist'),
                    type: item.type === 'single' ? 'Single' : (item.numberOfTracks <= 3 ? 'Single' : (item.numberOfTracks <= 6 ? 'EP' : 'Album')),
                    explicit: Boolean(item.explicit),
                    cover: item.cover || item.image || '/images/default-cover.png',
                    data: item,
                }));
            }
        } catch (e) {
            console.warn('Could not load online new releases:', e);
        }

        // Curated fallback matching screenshot 1
        return [
            { id: 'rel_1', title: 'HOW TO QUIT SMOKING', artist: 'Dominic Fike', type: 'Album', explicit: true, cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop' },
            { id: 'rel_2', title: 'stecklinge.wav', artist: 'LENNSKO', type: 'Single', explicit: true, cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop' },
            { id: 'rel_3', title: 'LUZ', artist: 'HDN', type: 'Single', explicit: false, cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop' },
            { id: 'rel_4', title: 'OBSESSION', artist: 'Lambb', type: 'Single', explicit: false, cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=500&auto=format&fit=crop' },
            { id: 'rel_5', title: 'act 1. future', artist: 'SXCREDMANE', type: 'EP', explicit: false, cover: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=500&auto=format&fit=crop' },
            { id: 'rel_6', title: 'CONFESSIONS II: Instrumentals', artist: 'Madonna', type: 'Album', explicit: true, cover: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop' },
        ];
    }

    async getTopSongs(ui) {
        try {
            const res = await ui.api?.searchTracks('Top 50 global') || await ui.api?.searchTracks('Top Music Hits 2026');
            if (res && Array.isArray(res.items) && res.items.length > 0) {
                return res.items.slice(0, 12).map((item, idx) => ({
                    id: item.id,
                    title: item.title,
                    artist: item.artist?.name || (item.artists && item.artists[0]?.name) || (typeof item.artist === 'string' ? item.artist : 'Artist'),
                    album: item.album?.title || '',
                    cover: item.cover || item.album?.cover || item.image || '/images/default-cover.png',
                    rank: idx + 1,
                    trend: idx % 3 === 0 ? 'up' : (idx % 3 === 1 ? 'down' : 'neutral'),
                    delta: (idx % 2) + 1,
                    data: item,
                }));
            }
        } catch (e) {
            console.warn('Could not load online top songs:', e);
        }

        // Curated fallback matching screenshot 2
        return [
            { id: 'chart_1', title: 'Dai Dai', artist: 'Shakira & Burna Boy', album: 'Dai Dai', rank: 1, trend: 'up', delta: 1, cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop' },
            { id: 'chart_2', title: 'Tu Mil Jaaye (From "KING")', artist: 'Sachin-Jigar, Ed Sheeran, Arijit Singh', album: 'KING', rank: 2, trend: 'up', delta: 2, cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&auto=format&fit=crop' },
            { id: 'chart_3', title: 'POKITO', artist: 'Daddy Yankee & Diljit Dosanjh', album: 'LA POSTAL', rank: 3, trend: 'neutral', delta: 0, cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&auto=format&fit=crop' },
            { id: 'chart_4', title: 'KALYANI (Remix)', artist: 'ARJN, KDS, FIFTY4', album: 'KALYANI (Remix)', rank: 4, trend: 'down', delta: 1, cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&auto=format&fit=crop' },
            { id: 'chart_5', title: 'BbY WOW', artist: 'KAROL G, Judeline', album: 'NO ME ARREPIEN...', rank: 5, trend: 'down', delta: 2, cover: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=200&auto=format&fit=crop' },
            { id: 'chart_6', title: 'Alfaaz', artist: 'Hamza Malik & Zain Zohaib', album: 'Alfaaz', rank: 6, trend: 'up', delta: 1, cover: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=200&auto=format&fit=crop' },
            { id: 'chart_7', title: 'Guzarish', artist: 'Satinder Sartaaj', album: 'Guzarish', rank: 7, trend: 'neutral', delta: 0, cover: 'https://images.unsplash.com/photo-1445985543470-41f30c08b1c4?w=200&auto=format&fit=crop' },
            { id: 'chart_8', title: 'PESHTA', artist: 'Xamdam Sobirov', album: 'PESHTA', rank: 8, trend: 'up', delta: 3, cover: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=200&auto=format&fit=crop' },
            { id: 'chart_9', title: "You're Under Arrest", artist: 'ILLIT', album: 'BREAK EVEN', rank: 9, trend: 'up', delta: 1, cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=200&auto=format&fit=crop' },
            { id: 'chart_10', title: 'Casa Tupka Anthemo', artist: 'Yo Yo Honey Singh', album: 'Casa Tupka Anthemo', rank: 10, trend: 'down', delta: 2, cover: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=200&auto=format&fit=crop' },
            { id: 'chart_11', title: 'Barsaat', artist: 'Banjaare & Roni', album: 'Barsaat', rank: 11, trend: 'neutral', delta: 0, cover: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=200&auto=format&fit=crop' },
            { id: 'chart_12', title: 'Ala Bolelo (From "Jailer 2")', artist: 'Anirudh Ravichander', album: 'Ala Bolelo', rank: 12, trend: 'down', delta: 1, cover: 'https://images.unsplash.com/photo-1469488865564-c2de10f69f96?w=200&auto=format&fit=crop' },
        ];
    }

    async getTrendingPodcasts() {
        try {
            const res = await podcastsAPI.getTrendingPodcasts({ max: 10 });
            return (res.items || []).filter((p) => p && p.episodeCount > 0);
        } catch {
            return [];
        }
    }

    // --- HTML RENDERERS ---

    renderNewReleasesSection(items) {
        return `
            <section class="ytm-section" id="explore-section-new-releases">
                <div class="ytm-section-header">
                    <h2 class="ytm-section-title">New albums & singles</h2>
                    <div class="ytm-section-actions">
                        <button class="ytm-more-btn" id="explore-new-releases-more">More</button>
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
                        <div class="ytm-card ytm-explore-album-card" data-album-id="${escapeHtml(String(item.id))}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(item.cover)}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                <div class="ytm-play-badge">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                            </div>
                            <div class="ytm-card-title">${escapeHtml(item.title)}</div>
                            <div class="ytm-card-subtitle">
                                ${item.explicit ? '<span class="ytm-explicit-badge">E</span>' : ''}
                                ${escapeHtml(item.type || 'Album')} • ${escapeHtml(item.artist || 'Artist')}
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderTopSongsSection(tracks) {
        return `
            <section class="ytm-section" id="explore-section-charts">
                <div class="ytm-section-header">
                    <h2 class="ytm-section-title">Top songs</h2>
                    <div class="ytm-section-actions">
                        <button class="ytm-more-btn" id="explore-charts-more">More</button>
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-charts-grid">
                    ${tracks
                        .map(
                            (track, idx) => {
                                const rank = track.rank || idx + 1;
                                let trendHtml = '<span class="ytm-rank-trend ytm-trend-neutral">•</span>';
                                if (track.trend === 'up') {
                                    trendHtml = `<span class="ytm-rank-trend ytm-trend-up">▲ ${track.delta || 1}</span>`;
                                } else if (track.trend === 'down') {
                                    trendHtml = `<span class="ytm-rank-trend ytm-trend-down">▼ ${track.delta || 1}</span>`;
                                }

                                return `
                                    <div class="ytm-chart-item" data-track-id="${escapeHtml(String(track.id))}" data-index="${idx}">
                                        <div class="ytm-chart-cover-wrap">
                                            <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(track.cover)}" alt="" class="ytm-chart-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                                            <div class="ytm-chart-play-hover">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                            </div>
                                        </div>
                                        <div class="ytm-chart-rank">
                                            ${trendHtml}
                                            <span class="ytm-rank-num">${rank}</span>
                                        </div>
                                        <div class="ytm-chart-info">
                                            <div class="ytm-chart-title">${escapeHtml(track.title)}</div>
                                            <div class="ytm-chart-subtitle">${escapeHtml(track.artist)} ${track.album ? `• ${escapeHtml(track.album)}` : ''}</div>
                                        </div>
                                    </div>
                                `;
                            }
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    renderMoodsAndGenresSection() {
        return `
            <section class="ytm-section" id="explore-section-moods-genres">
                <div class="ytm-section-header">
                    <h2 class="ytm-section-title">Moods & genres</h2>
                    <div class="ytm-section-actions">
                        <button class="ytm-nav-btn ytm-prev" aria-label="Previous">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button class="ytm-nav-btn ytm-next" aria-label="Next">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="ytm-genres-grid">
                    ${MOODS_AND_GENRES.map(
                        (g) => `
                        <div class="ytm-genre-pill" data-genre-id="${escapeHtml(g.id)}" data-genre-name="${escapeHtml(g.name)}">
                            <span class="ytm-genre-accent" style="background-color: ${g.color};"></span>
                            <span class="ytm-genre-name">${escapeHtml(g.name)}</span>
                        </div>
                    `
                    ).join('')}
                </div>
            </section>
        `;
    }

    renderPodcastsSection(items) {
        return `
            <section class="ytm-section" id="explore-section-podcasts">
                <div class="ytm-section-header">
                    <div class="ytm-section-title-wrap">
                        <h2 class="ytm-section-title">Podcasts</h2>
                        <p class="ytm-section-subtitle">Top trending shows and series</p>
                    </div>
                    <div class="ytm-section-actions">
                        <a href="/podcasts" class="ytm-more-btn">More</a>
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
                        <div class="ytm-card ytm-podcast-card" data-podcast-id="${escapeHtml(String(item.id))}">
                            <div class="ytm-card-cover-wrap">
                                <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(item.image || '/images/default-cover.png')}" alt="" class="ytm-card-cover" loading="lazy" onerror="this.src='/images/default-cover.png';this.onerror=null;" />
                            </div>
                            <div class="ytm-card-title">${escapeHtml(item.title)}</div>
                            <div class="ytm-card-subtitle">${escapeHtml(item.author || '')} • ${item.episodeCount || 0} eps</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    // --- CONTROLS & LISTENERS ---

    attachExploreControls(container, ui, datasets) {
        const getPlayer = () => {
            if (ui && ui.player) return ui.player;
            try {
                return Player.instance;
            } catch {
                return null;
            }
        };

        const playQueue = async (tracks, startIndex = 0) => {
            const player = getPlayer();
            if (!player || !tracks || tracks.length === 0) return;
            try {
                const validIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
                await player.setQueue(tracks, validIndex);
                document.getElementById('shuffle-btn')?.classList.remove('active');
                await player.playTrackFromQueue();
            } catch (err) {
                console.error('Failed to play explore queue:', err);
            }
        };

        // Wire carousel scroll buttons
        container.querySelectorAll('.ytm-section').forEach((section) => {
            const carousel = section.querySelector('.ytm-carousel, .ytm-charts-grid');
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

        // Wire Album Cards
        container.querySelectorAll('.ytm-explore-album-card').forEach((card) => {
            card.addEventListener('click', async (e) => {
                const albumId = card.dataset.albumId;
                if (e.target.closest('.ytm-play-badge')) {
                    e.stopPropagation();
                    try {
                        const res = await ui.api?.getAlbum(albumId);
                        const tracks = res?.tracks || res?.items || res?.album?.tracks;
                        if (tracks && tracks.length > 0) {
                            await playQueue(tracks, 0);
                            return;
                        }
                    } catch (err) {
                        console.warn('Failed to load album tracks:', err);
                    }
                }
                if (albumId && !albumId.startsWith('rel_')) {
                    navigate(`/album/${albumId}`);
                }
            });
        });

        // Wire Top Songs Chart Items
        container.querySelectorAll('.ytm-chart-item').forEach((item) => {
            const trackId = item.dataset.trackId;
            const track = datasets.topSongsData?.find((t) => String(t.id) === String(trackId));
            if (track?.data) {
                trackDataStore.set(item, track.data);
            }

            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const trackList = datasets.topSongsData.map((t) => t.data || t);
                const startIndex = parseInt(item.dataset.index, 10) || 0;
                await playQueue(trackList, startIndex);
            });
        });

        // Wire Genre & Mood Pills
        container.querySelectorAll('.ytm-genre-pill').forEach((pill) => {
            pill.addEventListener('click', async () => {
                const genreId = pill.dataset.genreId;
                const genreName = pill.dataset.genreName;
                if (ui.renderGenrePage) {
                    await ui.renderGenrePage(genreId, genreName);
                }
            });
        });

        // Wire Podcast Cards
        container.querySelectorAll('.ytm-podcast-card').forEach((card) => {
            card.addEventListener('click', () => {
                const podcastId = card.dataset.podcastId;
                if (podcastId) navigate(`/podcasts/${podcastId}`);
            });
        });
    }
}

export const exploreFeed = new ExploreFeed();
