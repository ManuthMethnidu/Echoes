// js/recap.js - Music Recap & Listening Analytics
import { db } from './db.js';
import { listeningTracker } from './listening-tracker.js';
import { escapeHtml, formatTime } from './utils.js';
import { GooeyNav } from './gooey-nav.js';

function formatHoursMinutes(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0 mins';
    const totalMinutes = Math.round(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} min${minutes === 1 ? '' : 's'}`;
    if (minutes === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
    return `${hours}h ${minutes}m`;
}

function calculateCutoff(timeframe) {
    const now = Date.now();
    switch (timeframe) {
        case '30d':
            return now - 30 * 24 * 60 * 60 * 1000;
        case '6m':
            return now - 180 * 24 * 60 * 60 * 1000;
        case 'year': {
            const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
            return startOfYear;
        }
        case 'all':
        default:
            return 0;
    }
}

export async function getRecapData(timeframe = 'all') {
    const history = (await db.getHistory()) || [];
    const cutoff = calculateCutoff(timeframe);

    const filtered = history.filter((item) => {
        const ts = item.timestamp || 0;
        return ts >= cutoff;
    });

    const trackerData = listeningTracker._load();
    const trackStatsMap = new Map();
    const artistStatsMap = new Map();
    const albumStatsMap = new Map();

    const timeOfDayCounts = {
        morning: 0,   // 06:00 - 11:59
        afternoon: 0, // 12:00 - 17:59
        evening: 0,   // 18:00 - 22:59
        night: 0,     // 23:00 - 05:59
    };

    let totalDurationSeconds = 0;

    for (const item of filtered) {
        const id = item.id;
        const durSec = item.duration ? (item.duration > 1000 ? Math.floor(item.duration / 1000) : item.duration) : 180;
        totalDurationSeconds += durSec;

        // Hour breakdown
        if (item.timestamp) {
            const hour = new Date(item.timestamp).getHours();
            if (hour >= 6 && hour < 12) timeOfDayCounts.morning++;
            else if (hour >= 12 && hour < 18) timeOfDayCounts.afternoon++;
            else if (hour >= 18 && hour < 23) timeOfDayCounts.evening++;
            else timeOfDayCounts.night++;
        }

        // Track stats
        if (!trackStatsMap.has(id)) {
            trackStatsMap.set(id, {
                track: item,
                playCount: 0,
                totalPlayTime: 0,
            });
        }
        const tStat = trackStatsMap.get(id);
        tStat.playCount++;
        tStat.totalPlayTime += durSec;

        // Artist stats
        const artistName = item.artist?.name || (item.artists && item.artists[0]?.name) || 'Unknown Artist';
        const artistId = item.artist?.id || (item.artists && item.artists[0]?.id) || artistName;
        if (!artistStatsMap.has(artistName)) {
            artistStatsMap.set(artistName, {
                id: artistId,
                name: artistName,
                playCount: 0,
                totalPlayTime: 0,
                artwork: item.artist?.artwork || item.cover || null,
            });
        }
        const aStat = artistStatsMap.get(artistName);
        aStat.playCount++;
        aStat.totalPlayTime += durSec;

        // Album stats
        const albumName = item.album?.name || item.album?.title;
        if (albumName) {
            if (!albumStatsMap.has(albumName)) {
                albumStatsMap.set(albumName, {
                    name: albumName,
                    artist: artistName,
                    artwork: item.album?.cover || item.cover || null,
                    playCount: 0,
                    totalPlayTime: 0,
                });
            }
            const albStat = albumStatsMap.get(albumName);
            albStat.playCount++;
            albStat.totalPlayTime += durSec;
        }
    }

    // Merge in listeningTracker data if history is small
    if (filtered.length < 5 && trackerData && trackerData.tracks) {
        for (const [trackId, info] of Object.entries(trackerData.tracks)) {
            if (!trackStatsMap.has(trackId) && info.playCount > 0) {
                totalDurationSeconds += info.totalPlayTime || (info.playCount * 180);
            }
        }
    }

    const sortedTracks = Array.from(trackStatsMap.values())
        .sort((a, b) => b.playCount - a.playCount || b.totalPlayTime - a.totalPlayTime)
        .map((entry, index) => ({
            rank: index + 1,
            ...entry.track,
            playCount: entry.playCount,
            totalPlayTime: entry.totalPlayTime,
        }));

    const sortedArtists = Array.from(artistStatsMap.values())
        .sort((a, b) => b.playCount - a.playCount || b.totalPlayTime - a.totalPlayTime)
        .map((entry, index) => ({
            rank: index + 1,
            ...entry,
        }));

    const sortedAlbums = Array.from(albumStatsMap.values())
        .sort((a, b) => b.playCount - a.playCount)
        .map((entry, index) => ({
            rank: index + 1,
            ...entry,
        }));

    // Calculate percentage breakdown for time of day and habits (Spotify-style)
    const totalPlays = filtered.length;
    const todSum = Object.values(timeOfDayCounts).reduce((a, b) => a + b, 0) || Math.max(1, totalPlays);
    const morningPct = Math.round((timeOfDayCounts.morning / todSum) * 100);
    const afternoonPct = Math.round((timeOfDayCounts.afternoon / todSum) * 100);
    const eveningPct = Math.round((timeOfDayCounts.evening / todSum) * 100);
    const nightPct = Math.round((timeOfDayCounts.night / todSum) * 100);

    // Derive Music Persona / Archetype backed by exact percentages (no emojis)
    let persona = {
        title: 'The Sonic Explorer',
        percentStat: '75% Variety',
        tagline: 'You explore far and wide, sampling diverse artists and tracks across your musical library.',
        icon: 'compass',
    };

    if (totalPlays > 0) {
        const topArtist = sortedArtists[0];
        const topArtistRatio = topArtist ? topArtist.playCount / totalPlays : 0;
        const topArtistPct = Math.round(topArtistRatio * 100);
        const maxTimeOfDay = Object.entries(timeOfDayCounts).sort((a, b) => b[1] - a[1])[0][0];
        const loopPct = sortedTracks[0] ? Math.round((sortedTracks[0].playCount / totalPlays) * 100) : 0;
        const varietyRatio = Math.min(99, Math.round((sortedArtists.length / totalPlays) * 100));

        if (topArtistRatio >= 0.35) {
            persona = {
                title: 'The Superfan',
                percentStat: `${topArtistPct}% Dedicated`,
                tagline: `${topArtistPct}% of all your listening was dedicated to ${topArtist.name}, putting you in their top 1% of listeners.`,
                icon: 'heart',
            };
        } else if (maxTimeOfDay === 'night' && nightPct >= 35) {
            persona = {
                title: 'The Night Owl',
                percentStat: `${nightPct}% Late Night`,
                tagline: `${nightPct}% of your listening took place during late-night hours between 11 PM and 6 AM while the world slept.`,
                icon: 'moon',
            };
        } else if (maxTimeOfDay === 'morning' && morningPct >= 35) {
            persona = {
                title: 'The Early Riser',
                percentStat: `${morningPct}% Morning`,
                tagline: `${morningPct}% of your listening powered your morning routine between 6 AM and 12 PM.`,
                icon: 'sun',
            };
        } else if (loopPct >= 25 && sortedTracks[0]) {
            persona = {
                title: 'The Heavy Looper',
                percentStat: `${loopPct}% On Repeat`,
                tagline: `${loopPct}% of your total plays were locked on "${sortedTracks[0].title}", spinning it on continuous repeat.`,
                icon: 'repeat',
            };
        } else if (sortedArtists.length >= 10) {
            persona = {
                title: 'The Sonic Explorer',
                percentStat: `${varietyRatio}% Variety`,
                tagline: `High sonic discovery: you traversed ${sortedArtists.length} distinct artists across ${totalPlays} streams.`,
                icon: 'compass',
            };
        } else if (afternoonPct >= 35) {
            persona = {
                title: 'Daytime Navigator',
                percentStat: `${afternoonPct}% Daytime`,
                tagline: `${afternoonPct}% of your listening accompanied your afternoon hours between 12 PM and 6 PM.`,
                icon: 'sun',
            };
        } else if (eveningPct >= 35) {
            persona = {
                title: 'Evening Unwinder',
                percentStat: `${eveningPct}% Evening`,
                tagline: `${eveningPct}% of your listening was soundtracked during evening hours between 6 PM and 11 PM.`,
                icon: 'sunset',
            };
        } else {
            persona = {
                title: 'The Sonic Explorer',
                percentStat: `${varietyRatio}% Variety`,
                tagline: `You balanced ${sortedArtists.length} artists across ${totalPlays} streams for an eclectic musical mix.`,
                icon: 'compass',
            };
        }
    }

    return {
        timeframe,
        totalDurationSeconds,
        totalPlays,
        uniqueTracksCount: sortedTracks.length,
        uniqueArtistsCount: sortedArtists.length,
        topTracks: sortedTracks.slice(0, 10),
        topArtists: sortedArtists.slice(0, 6),
        topAlbums: sortedAlbums.slice(0, 6),
        timeOfDay: timeOfDayCounts,
        persona,
    };
}

export async function renderRecapPage(container, ui, timeframe = 'all') {
    if (!container) return;

    // Destroy existing GooeyNav instance if re-rendering parent container
    if (container._recapGooeyNav) {
        try {
            container._recapGooeyNav.destroy();
        } catch {}
        container._recapGooeyNav = null;
    }

    container.innerHTML = `
        <div class="recap-container" style="max-width: 1040px; margin: 0 auto; padding: 1.5rem 1rem;">
            <div class="recap-header" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 2rem;">
                <div>
                    <h1 style="font-size: 2.25rem; font-weight: 800; letter-spacing: -0.03em; margin: 0; background: linear-gradient(135deg, var(--foreground, #ffffff) 40%, var(--muted-foreground, rgba(255,255,255,0.55))); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                        Echoes Recap
                    </h1>
                    <p style="color: var(--muted-foreground, #a1a1aa); font-size: 0.95rem; margin: 6px 0 0 0;">
                        Your personalized listening highlights, stats, and musical journey.
                    </p>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <div id="recap-timeframe-selector"></div>
                    <button id="recap-share-btn" class="btn-primary" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-weight: 600; cursor: pointer;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                        <span>Share Story</span>
                    </button>
                </div>
            </div>
            <div id="recap-content-body">
                <div style="text-align: center; padding: 4rem 1rem; color: var(--muted-foreground);">
                    <div class="skeleton" style="height: 140px; width: 100%; border-radius: 16px; margin-bottom: 1.5rem;"></div>
                    <div class="skeleton" style="height: 280px; width: 100%; border-radius: 16px;"></div>
                </div>
            </div>
        </div>
    `;

    const tfContainer = container.querySelector('#recap-timeframe-selector');
    const contentBody = container.querySelector('#recap-content-body');

    const TF_ITEMS = [
        { label: 'All Time', value: 'all' },
        { label: '2026', value: 'year' },
        { label: '6 Months', value: '6m' },
        { label: '30 Days', value: '30d' },
    ];
    const initialIndex = Math.max(0, TF_ITEMS.findIndex((item) => item.value === timeframe));

    // Mount GooeyNav component from React Bits
    if (tfContainer) {
        container._recapGooeyNav = new GooeyNav(tfContainer, {
            items: TF_ITEMS,
            initialActiveIndex: initialIndex,
            size: 'sm',
            frame: true,
            spread: 48,
            particleCount: 14,
            animationTime: 550,
            gooeyness: 0.5,
            wobble: 0.45,
            onChange: async (idx, item) => {
                await renderRecapContent(contentBody, item.value, ui);
            },
        });
    }

    await renderRecapContent(contentBody, timeframe, ui);

    // Attach share story button listener
    const shareBtn = container.querySelector('#recap-share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const activeTf = container._activeRecapTimeframe || timeframe;
            const recapData = await getRecapData(activeTf);
            openShareStoryModal(recapData);
        });
    }
}

async function renderRecapContent(contentBody, timeframe, ui) {
    if (!contentBody) return;

    // Track active timeframe for share modal
    if (contentBody.closest('.recap-container')) {
        contentBody.closest('.recap-container')._activeRecapTimeframe = timeframe;
    }

    contentBody.innerHTML = `
        <div style="text-align: center; padding: 4rem 1rem; color: var(--muted-foreground);">
            <div class="skeleton" style="height: 140px; width: 100%; border-radius: 16px; margin-bottom: 1.5rem;"></div>
            <div class="skeleton" style="height: 280px; width: 100%; border-radius: 16px;"></div>
        </div>
    `;

    const recapData = await getRecapData(timeframe);

    if (recapData.totalPlays === 0 && recapData.totalDurationSeconds === 0) {
        contentBody.innerHTML = `
            <div style="text-align: center; padding: 5rem 2rem; background: var(--card, #18181b); border-radius: 20px; border: 1px dashed var(--border, rgba(255,255,255,0.15));">
                <div style="width: 64px; height: 64px; margin: 0 auto 1.5rem auto; background: var(--secondary); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--foreground); border: 1px solid var(--border);">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"></path></svg>
                </div>
                <h3 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--foreground);">Your Recap is Waiting</h3>
                <p style="color: var(--muted-foreground); max-width: 440px; margin: 0 auto 1.5rem auto; font-size: 0.95rem; line-height: 1.5;">
                    You have not played any tracks during this period. Put on your favorite tracks, explore new albums, and your personalized stats will appear right here.
                </p>
                <a href="/" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 10px 24px; border-radius: 12px; font-weight: 600;">
                    Explore Music
                </a>
            </div>
        `;
        return;
    }

    const topTrack = recapData.topTracks[0];
    const totalTimeFormatted = formatHoursMinutes(recapData.totalDurationSeconds);

    // Calculate percentage bars for time of day
    const todSum = Object.values(recapData.timeOfDay).reduce((a, b) => a + b, 0) || 1;
    const morningPct = Math.round((recapData.timeOfDay.morning / todSum) * 100);
    const afternoonPct = Math.round((recapData.timeOfDay.afternoon / todSum) * 100);
    const eveningPct = Math.round((recapData.timeOfDay.evening / todSum) * 100);
    const nightPct = Math.round((recapData.timeOfDay.night / todSum) * 100);

    contentBody.innerHTML = `
        <!-- Metrics Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
            <div style="background: var(--card, #18181b); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 16px; padding: 1.5rem; position: relative; overflow: hidden;">
                <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 0.5rem; font-weight: 600;">
                    Listening Time
                </div>
                <div style="font-size: 2.2rem; font-weight: 800; letter-spacing: -0.02em; color: var(--foreground); line-height: 1;">
                    ${totalTimeFormatted}
                </div>
                <div style="font-size: 0.85rem; color: var(--muted-foreground); margin-top: 0.5rem;">
                    Across ${recapData.totalPlays} song plays
                </div>
            </div>

            <div style="background: var(--card, #18181b); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 16px; padding: 1.5rem; position: relative; overflow: hidden;">
                <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 0.5rem; font-weight: 600;">
                    Unique Artists
                </div>
                <div style="font-size: 2.2rem; font-weight: 800; letter-spacing: -0.02em; color: var(--foreground); line-height: 1;">
                    ${recapData.uniqueArtistsCount}
                </div>
                <div style="font-size: 0.85rem; color: var(--muted-foreground); margin-top: 0.5rem;">
                    ${recapData.uniqueTracksCount} unique tracks heard
                </div>
            </div>

            <div style="background: var(--card, #18181b); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 16px; padding: 1.5rem; position: relative; overflow: hidden; grid-column: span 2;">
                <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 0.5rem; font-weight: 600;">
                    Listening Archetype
                </div>
                <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <div style="font-size: 1.7rem; font-weight: 800; letter-spacing: -0.02em; color: var(--foreground); line-height: 1.2;">
                        ${recapData.persona.title}
                    </div>
                    <div style="display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; background: var(--secondary); border: 1px solid var(--border); font-size: 0.82rem; font-weight: 700; color: var(--foreground);">
                        ${recapData.persona.percentStat}
                    </div>
                </div>
                <p style="font-size: 0.9rem; color: var(--muted-foreground); margin: 8px 0 0 0; line-height: 1.45;">
                    ${recapData.persona.tagline}
                </p>
            </div>
        </div>

        ${topTrack ? `
        <!-- Top Track Hero Showcase -->
        <div style="margin-bottom: 2.5rem;">
            <div style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 0.75rem; font-weight: 700;">
                #1 Most Played Track
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; background: var(--secondary); border: 1px solid var(--border); border-radius: 20px; padding: 1.5rem;">
                <div style="position: relative; width: 140px; height: 140px; border-radius: 14px; overflow: hidden; flex-shrink: 0; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <img src="${escapeHtml(topTrack.cover || '/images/default-cover.png')}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />
                    <div style="position: absolute; top: 8px; left: 8px; background: var(--foreground); color: var(--background); font-size: 0.75rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">
                        #1
                    </div>
                </div>
                <div style="flex: 1; min-width: 240px;">
                    <div style="font-size: 1.4rem; font-weight: 800; color: var(--foreground); margin-bottom: 4px; line-height: 1.3;">
                        ${escapeHtml(topTrack.title)}
                    </div>
                    <div style="font-size: 1rem; color: var(--muted-foreground); margin-bottom: 12px;">
                        ${escapeHtml(topTrack.artist?.name || (topTrack.artists && topTrack.artists[0]?.name) || 'Unknown Artist')}
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <button class="recap-play-track-btn btn-primary" data-track-id="${escapeHtml(topTrack.id)}" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 999px; font-weight: 600; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span>Play Now</span>
                        </button>
                        <span style="font-size: 0.85rem; color: var(--muted-foreground);">
                            Played <strong>${topTrack.playCount} times</strong> &bull; ${formatHoursMinutes(topTrack.totalPlayTime)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Top Tracks & Top Artists 2-Column Split -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; margin-bottom: 2.5rem;">
            <!-- Top 5 Tracks -->
            <div>
                <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; color: var(--foreground);">
                    <span>Top Tracks</span>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${recapData.topTracks.slice(0, 5).map((track, i) => `
                        <div class="recap-track-row" style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--secondary); border-radius: 12px; border: 1px solid var(--border);">
                            <span style="font-size: 0.9rem; font-weight: 800; min-width: 20px; color: ${i === 0 ? 'var(--foreground)' : 'var(--muted-foreground)'}; text-align: center;">
                                ${i + 1}
                            </span>
                            <img src="${escapeHtml(track.cover || '/images/default-cover.png')}" alt="" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex-shrink: 0;" />
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 0.9rem; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(track.title)}
                                </div>
                                <div style="font-size: 0.8rem; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(track.artist?.name || (track.artists && track.artists[0]?.name) || 'Unknown')}
                                </div>
                            </div>
                            <span style="font-size: 0.8rem; color: var(--muted-foreground); flex-shrink: 0; font-weight: 600;">
                                ${track.playCount}x
                            </span>
                            <button class="recap-play-track-btn btn-icon" data-track-id="${escapeHtml(track.id)}" title="Play" style="flex-shrink: 0; padding: 6px; cursor: pointer; border: none; background: transparent; color: var(--foreground);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Top Artists -->
            <div>
                <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; color: var(--foreground);">
                    <span>Top Artists</span>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${recapData.topArtists.slice(0, 5).map((artist, i) => `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--secondary); border-radius: 12px; border: 1px solid var(--border);">
                            <span style="font-size: 0.9rem; font-weight: 800; min-width: 20px; color: ${i === 0 ? 'var(--foreground)' : 'var(--muted-foreground)'}; text-align: center;">
                                ${i + 1}
                            </span>
                            <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--secondary); border: 1px solid var(--border);">
                                <img src="${escapeHtml(artist.artwork || '/images/default-avatar.png')}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/images/default-avatar.png'" />
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 0.95rem; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(artist.name)}
                                </div>
                                <div style="font-size: 0.8rem; color: var(--muted-foreground);">
                                    ${artist.playCount} plays &bull; ${formatHoursMinutes(artist.totalPlayTime)}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <!-- Listening Clock & Daypart Breakdown (Clean percentages, zero emojis) -->
        <div style="background: var(--card, #18181b); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 20px; padding: 1.5rem; margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <h3 style="font-size: 1.2rem; font-weight: 700; margin: 0 0 4px 0; color: var(--foreground);">Listening Clock</h3>
                    <p style="color: var(--muted-foreground); font-size: 0.85rem; margin: 0;">When you hit play most often during the day</p>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                <div style="background: var(--secondary); padding: 1rem; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px; color: var(--foreground);">
                        <span>Morning (6 AM - 12 PM)</span>
                        <strong>${morningPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${morningPct}%; background: var(--foreground); border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: var(--secondary); padding: 1rem; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px; color: var(--foreground);">
                        <span>Afternoon (12 PM - 6 PM)</span>
                        <strong>${afternoonPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${afternoonPct}%; background: var(--foreground); border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: var(--secondary); padding: 1rem; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px; color: var(--foreground);">
                        <span>Evening (6 PM - 11 PM)</span>
                        <strong>${eveningPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${eveningPct}%; background: var(--foreground); border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: var(--secondary); padding: 1rem; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px; color: var(--foreground);">
                        <span>Late Night (11 PM - 6 AM)</span>
                        <strong>${nightPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${nightPct}%; background: var(--foreground); border-radius: 999px;"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Attach play button listeners
    contentBody.querySelectorAll('.recap-play-track-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const trackId = btn.dataset.trackId;
            const track = recapData.topTracks.find((t) => t.id === trackId);
            if (track && ui?.player) {
                await ui.player.playTrack(track);
            }
        });
    });
}

export function openShareStoryModal(recapData) {
    let modal = document.getElementById('recap-share-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'recap-share-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 480px; text-align: center; padding: 24px; border-radius: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--foreground);">Share Your Recap</h3>
                    <button id="close-recap-share-btn" class="modal-close" style="border: none; background: transparent; font-size: 1.5rem; cursor: pointer; color: var(--foreground);">&times;</button>
                </div>
                <div style="margin-bottom: 1.5rem; display: flex; justify-content: center;">
                    <canvas id="recap-story-canvas" width="720" height="960" style="max-width: 100%; height: auto; border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.6); border: 1px solid var(--border);"></canvas>
                </div>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="download-recap-img-btn" class="btn-primary" style="flex: 1; padding: 10px 18px; border-radius: 10px; font-weight: 600; cursor: pointer;">
                        Download PNG
                    </button>
                    <button id="copy-recap-img-btn" class="btn-secondary" style="flex: 1; padding: 10px 18px; border-radius: 10px; font-weight: 600; cursor: pointer;">
                        Copy Image
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#close-recap-share-btn');
        const overlay = modal.querySelector('.modal-overlay');
        const closeModal = () => modal.classList.remove('active');
        closeBtn?.addEventListener('click', closeModal);
        overlay?.addEventListener('click', closeModal);
    }

    modal.classList.add('active');
    drawStoryCard(modal.querySelector('#recap-story-canvas'), recapData);

    const downloadBtn = modal.querySelector('#download-recap-img-btn');
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            const canvas = modal.querySelector('#recap-story-canvas');
            if (!canvas) return;
            const a = document.createElement('a');
            a.download = `echoes-recap-${recapData.timeframe}.png`;
            a.href = canvas.toDataURL('image/png');
            a.click();
        };
    }

    const copyBtn = modal.querySelector('#copy-recap-img-btn');
    if (copyBtn) {
        copyBtn.onclick = async () => {
            const canvas = modal.querySelector('#recap-story-canvas');
            if (!canvas) return;
            try {
                canvas.toBlob(async (blob) => {
                    if (blob && navigator.clipboard && navigator.clipboard.write) {
                        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                        alert('Recap card copied to clipboard!');
                    }
                });
            } catch (err) {
                console.warn('Failed to copy image to clipboard:', err);
                alert('Could not copy automatically. Please use Download PNG.');
            }
        };
    }
}

function drawStoryCard(canvas, data) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const theme = document.documentElement.getAttribute('data-theme') || 'monochrome';
    const isLight = theme === 'white' || theme === 'latte';
    const computed = getComputedStyle(document.documentElement);

    // Dynamic active theme palette (solid, zero gradients)
    const bgColor = computed.getPropertyValue('--background').trim() || (isLight ? '#f4f4f5' : '#090a0f');
    const cardColor = computed.getPropertyValue('--card').trim() || computed.getPropertyValue('--secondary').trim() || (isLight ? '#ffffff' : '#12131a');
    const fgColor = computed.getPropertyValue('--foreground').trim() || (isLight ? '#18181b' : '#ffffff');
    const mutedColor = computed.getPropertyValue('--muted-foreground').trim() || (isLight ? '#71717a' : '#a1a1aa');
    const borderColor = computed.getPropertyValue('--border').trim() || (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)');
    const secondaryColor = computed.getPropertyValue('--secondary').trim() || (isLight ? '#e4e4e7' : '#1c1d24');

    const render = (logoImg = null) => {
        // Solid themed background (no gradient)
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);

        // Elegant outer card stroke
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, w - 48, h - 48);

        // Echoes Logo
        if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(48, 48, 44, 44, 10);
            ctx.clip();
            ctx.drawImage(logoImg, 48, 48, 44, 44);
            ctx.restore();
        }

        // Header Branding
        const textStartX = (logoImg && logoImg.complete && logoImg.naturalWidth > 0) ? 104 : 48;
        ctx.fillStyle = fgColor;
        ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('ECHOES', textStartX, 74);

        ctx.fillStyle = mutedColor;
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('MUSIC RECAP 2026', textStartX, 94);

        // Persona Title & Percentage Pill
        ctx.fillStyle = fgColor;
        ctx.font = 'bold 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(data.persona.title, 48, 160);

        if (data.persona.percentStat) {
            ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const pillText = data.persona.percentStat;
            const textWidth = ctx.measureText(pillText).width;
            const titleWidth = ctx.measureText(data.persona.title).width;
            const pillX = Math.min(w - 180, 48 + titleWidth + 16);
            ctx.fillStyle = secondaryColor;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(pillX, 137, textWidth + 20, 28, 999);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = fgColor;
            ctx.fillText(pillText, pillX + 10, 156);
        }

        // Tagline text
        ctx.fillStyle = mutedColor;
        ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const tagline = data.persona.tagline || '';
        if (ctx.measureText(tagline).width > w - 96) {
            const words = tagline.split(' ');
            let line1 = '';
            let line2 = '';
            for (const word of words) {
                if (ctx.measureText(line1 + word + ' ').width < w - 96 && !line2) {
                    line1 += word + ' ';
                } else {
                    line2 += word + ' ';
                }
            }
            ctx.fillText(line1.trim(), 48, 192);
            ctx.fillText(line2.trim(), 48, 212);
        } else {
            ctx.fillText(tagline, 48, 192);
        }

        // Stats Grid Box
        ctx.fillStyle = cardColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(48, 235, w - 96, 105, 16);
        ctx.fill();
        ctx.stroke();

        // Total Time
        ctx.fillStyle = mutedColor;
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('TOTAL LISTENING', 72, 268);

        ctx.fillStyle = fgColor;
        ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(formatHoursMinutes(data.totalDurationSeconds), 72, 312);

        // Total Plays
        ctx.fillStyle = mutedColor;
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('PLAYS', 350, 268);

        ctx.fillStyle = fgColor;
        ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(String(data.totalPlays), 350, 312);

        // Unique Artists
        ctx.fillStyle = mutedColor;
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('ARTISTS', 520, 268);

        ctx.fillStyle = fgColor;
        ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(String(data.uniqueArtistsCount), 520, 312);

        // Top Songs List
        ctx.fillStyle = fgColor;
        ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('TOP TRACKS', 48, 385);

        const tracksToShow = data.topTracks.slice(0, 3);
        let trackY = 415;
        tracksToShow.forEach((t, i) => {
            ctx.fillStyle = cardColor;
            ctx.strokeStyle = borderColor;
            ctx.beginPath();
            ctx.roundRect(48, trackY, w - 96, 60, 12);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = fgColor;
            ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`#${i + 1}`, 68, trackY + 36);

            ctx.fillStyle = fgColor;
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const titleText = t.title.length > 32 ? t.title.slice(0, 32) + '...' : t.title;
            ctx.fillText(titleText, 110, trackY + 28);

            ctx.fillStyle = mutedColor;
            ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const artistName = t.artist?.name || (t.artists && t.artists[0]?.name) || 'Unknown';
            ctx.fillText(artistName, 110, trackY + 48);

            ctx.fillStyle = mutedColor;
            ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`${t.playCount} plays`, w - 140, trackY + 36);

            trackY += 72;
        });

        // Top Artists List
        ctx.fillStyle = fgColor;
        ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('TOP ARTISTS', 48, trackY + 25);

        const artistsToShow = data.topArtists.slice(0, 3);
        let artistY = trackY + 55;
        artistsToShow.forEach((a, i) => {
            ctx.fillStyle = cardColor;
            ctx.strokeStyle = borderColor;
            ctx.beginPath();
            ctx.roundRect(48, artistY, w - 96, 52, 12);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = fgColor;
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`#${i + 1}`, 68, artistY + 32);

            ctx.fillStyle = fgColor;
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(a.name, 110, artistY + 32);

            ctx.fillStyle = mutedColor;
            ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`${a.playCount} plays`, w - 140, artistY + 32);

            artistY += 62;
        });

        // Clean Footer Watermark (site URL, no ArchiveTune)
        ctx.fillStyle = mutedColor;
        ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('echoes.mteck.tech', 48, h - 44);

        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = mutedColor;
        const subFooter = 'Echoes Music Streaming & DSP Engine';
        const subWidth = ctx.measureText(subFooter).width;
        ctx.fillText(subFooter, w - 48 - subWidth, h - 44);
    };

    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.src = isLight ? '/images/echoes_logo_black.png' : '/images/echoes_logo_white.png';
    logoImg.onload = () => render(logoImg);
    render(logoImg.complete && logoImg.naturalWidth > 0 ? logoImg : null);
}
