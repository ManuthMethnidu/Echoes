// js/podcasts-api.js
// PodcastIndex.org API integration for Echoes via secure serverless proxy

const PODCASTS_PROXY_BASE = '/api/podcasts';

export class PodcastsAPI {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 1000 * 60 * 5;
    }

    async fetchWithRetry(endpoint, options = {}) {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const url = `${PODCASTS_PROXY_BASE}?endpoint=${encodeURIComponent(cleanEndpoint)}`;
        const cacheKey = cleanEndpoint;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: options.signal,
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const data = await response.json();
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('PodcastIndex API request failed:', error);
            throw error;
        }
    }

    async searchPodcasts(query, options = {}) {
        try {
            const max = options.max || 20;
            const clean = options.clean ? '&clean' : '';
            const data = await this.fetchWithRetry(
                `/search/byterm?q=${encodeURIComponent(query)}&max=${max}${clean}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const validFeeds = data.feeds.filter(
                (feed) => feed && (feed.episodeCount === undefined || feed.episodeCount > 0) && feed.dead !== 1
            );
            const podcasts = validFeeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: validFeeds.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Podcast search failed:', error);
            return { items: [], total: 0 };
        }
    }

    async searchPodcastsByTitle(query, options = {}) {
        try {
            const max = options.max || 20;
            const clean = options.clean ? '&clean' : '';
            const data = await this.fetchWithRetry(
                `/search/bytitle?q=${encodeURIComponent(query)}&max=${max}${clean}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const validFeeds = data.feeds.filter(
                (feed) => feed && (feed.episodeCount === undefined || feed.episodeCount > 0) && feed.dead !== 1
            );
            const podcasts = validFeeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: validFeeds.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Podcast search by title failed:', error);
            return { items: [], total: 0 };
        }
    }

    async getPodcastById(id, options = {}) {
        try {
            const data = await this.fetchWithRetry(`/podcasts/byfeedid?id=${id}&pretty`, options);

            if (data.status !== 'true' || !data.feed) {
                return null;
            }

            return this.transformPodcastFull(data.feed);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get podcast by ID failed:', error);
            return null;
        }
    }

    async getPodcastEpisodes(id, options = {}) {
        try {
            const max = options.max || 50;
            const offset = options.offset || 0;
            const data = await this.fetchWithRetry(
                `/episodes/byfeedid?id=${id}&max=${max}&offset=${offset}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.items) {
                return { items: [], total: 0, hasMore: false };
            }

            const episodes = data.items.map((item) => this.transformEpisode(item));
            return {
                items: episodes,
                total: data.count || episodes.length,
                hasMore: episodes.length === max,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get podcast episodes failed:', error);
            return { items: [], total: 0, hasMore: false };
        }
    }

    async getTrendingPodcasts(options = {}) {
        try {
            const max = options.max || 20;
            const lang = options.lang || '';
            const cat = options.cat || '';
            const since = options.since || '';
            const params = new URLSearchParams({ max, pretty: '' });
            if (lang) params.append('lang', lang);
            if (cat) params.append('cat', cat);
            if (since) params.append('since', since);
            const queryString = params.toString().replace(/&pretty=$/, '');
            const data = await this.fetchWithRetry(`/podcasts/trending?${queryString}`, options);

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const validFeeds = data.feeds.filter(
                (feed) => feed && (feed.episodeCount === undefined || feed.episodeCount > 0) && feed.dead !== 1
            );
            const podcasts = validFeeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: validFeeds.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get trending podcasts failed:', error);
            return { items: [], total: 0 };
        }
    }

    async getRecentPodcasts(options = {}) {
        try {
            const max = options.max || 24;
            const lang = options.lang || '';
            const cat = options.cat || '';
            const since = options.since || '';
            const params = new URLSearchParams({ max, pretty: '' });
            if (lang) params.append('lang', lang);
            if (cat) params.append('cat', cat);
            if (since) params.append('since', since);
            const queryString = params.toString().replace(/&pretty=$/, '');
            const data = await this.fetchWithRetry(`/recent/feeds?${queryString}`, options);

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const validFeeds = data.feeds.filter(
                (feed) => feed && feed.dead !== 1 && (feed.episodeCount === undefined || feed.episodeCount > 0)
            );
            // Sort feeds with cover image first
            validFeeds.sort((a, b) => {
                const hasImgA = Boolean(a.image || a.artwork);
                const hasImgB = Boolean(b.image || b.artwork);
                if (hasImgA && !hasImgB) return -1;
                if (!hasImgA && hasImgB) return 1;
                return 0;
            });
            const podcasts = validFeeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: validFeeds.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get recent podcasts failed:', error);
            return { items: [], total: 0 };
        }
    }

    async testAuth() {
        console.log('Testing PodcastIndex auth...');
        try {
            const response = await fetch(`${PODCASTINDEX_API_BASE}/hub/pubnotify?id=75075&pretty`, {
                headers: await this.getAuthHeaders(),
            });
            const data = await response.json();
            console.log('Test response:', data);
            return data;
        } catch (error) {
            console.error('Auth test failed:', error);
        }
    }

    transformPodcast(feed) {
        const rawDesc = feed.description || '';
        const cleanDesc = rawDesc
            .replace(/<[^>]*>/g, '')
            .replace(/&[a-z0-9]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            id: feed.id?.toString() || '',
            podcastGuid: feed.podcastGuid || '',
            title: feed.title || 'Unknown Podcast',
            author: feed.author || feed.ownerName || '',
            description: cleanDesc,
            image: feed.image || feed.artwork || '',
            link: feed.link || '',
            feedUrl: feed.url || '',
            language: feed.language || '',
            categories: feed.categories || {},
            explicit: feed.explicit || false,
            episodeCount: feed.episodeCount || 0,
            newestItemPublishTime: feed.newestItemPubdate || feed.newestItemPublishTime || null,
        };
    }

    transformPodcastFull(feed) {
        const podcast = this.transformPodcast(feed);
        podcast.generator = feed.generator || '';
        podcast.locked = feed.locked || 0;
        podcast.medium = feed.medium || '';
        podcast.dead = feed.dead || 0;
        podcast.value = feed.value || null;
        podcast.funding = feed.funding || null;
        return podcast;
    }

    transformEpisode(item) {
        const rawDesc = item.description || '';
        const cleanDesc = rawDesc
            .replace(/<[^>]*>/g, '')
            .replace(/&[a-z0-9]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            id: item.id?.toString() || '',
            title: item.title || 'Unknown Episode',
            description: cleanDesc,
            link: item.link || '',
            guid: item.guid || '',
            datePublished: item.datePublished || 0,
            datePublishedPretty: item.datePublishedPretty || '',
            enclosureUrl: item.enclosureUrl || '',
            enclosureType: item.enclosureType || '',
            enclosureLength: item.enclosureLength || 0,
            duration: item.duration || null,
            explicit: item.explicit || 0,
            episode: item.episode || null,
            episodeType: item.episodeType || 'full',
            season: item.season || null,
            image: item.image || item.feedImage || '',
            feedId: item.feedId || null,
            feedTitle: item.feedTitle || '',
            feedImage: item.feedImage || '',
        };
    }
}

export const podcastsAPI = new PodcastsAPI();
