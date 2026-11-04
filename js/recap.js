// js/recap.js - ArchiveTune-inspired Music Recap & Listening Analytics
import { db } from './db.js';
import { listeningTracker } from './listening-tracker.js';
import { escapeHtml, formatTime } from './utils.js';

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

    // Derive Music Persona / Archetype
    let persona = {
        title: 'The Sonic Wanderer',
        tagline: 'You explore far and wide across a vast musical landscape.',
        icon: 'compass',
    };

    const totalPlays = filtered.length;
    if (totalPlays > 0) {
        const topArtist = sortedArtists[0];
        const topArtistRatio = topArtist ? topArtist.playCount / totalPlays : 0;
        const maxTimeOfDay = Object.entries(timeOfDayCounts).sort((a, b) => b[1] - a[1])[0][0];

        if (topArtistRatio >= 0.35) {
            persona = {
                title: 'The Devoted Fan',
                tagline: `Unconditionally dedicated to ${topArtist.name}, streaming them on heavy rotation.`,
                icon: 'heart',
            };
        } else if (maxTimeOfDay === 'night' && timeOfDayCounts.night / totalPlays > 0.4) {
            persona = {
                title: 'The Night Owl',
                tagline: 'Your finest listening sessions happen under the stars while the world sleeps.',
                icon: 'moon',
            };
        } else if (maxTimeOfDay === 'morning' && timeOfDayCounts.morning / totalPlays > 0.4) {
            persona = {
                title: 'The Morning Riser',
                tagline: 'Fueling your days with early beats and morning melodies.',
                icon: 'sun',
            };
        } else if (sortedTracks[0] && sortedTracks[0].playCount / totalPlays >= 0.25) {
            persona = {
                title: 'The Heavy Looper',
                tagline: 'When a track hits, you play it until the grooves wear down.',
                icon: 'repeat',
            };
        } else if (sortedArtists.length >= 15 && totalPlays >= 30) {
            persona = {
                title: 'The Trailblazer',
                tagline: 'Crate-digging and genre-hopping are in your DNA.',
                icon: 'sparkles',
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
    container.innerHTML = `
        <div class="recap-container" style="max-width: 1040px; margin: 0 auto; padding: 1.5rem 1rem;">
            <div class="recap-header" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 2rem;">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <span style="display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.12); padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">
                            ArchiveTune Edition
                        </span>
                    </div>
                    <h1 style="font-size: 2.25rem; font-weight: 800; letter-spacing: -0.03em; margin: 0; background: linear-gradient(135deg, #ffffff 40%, rgba(255,255,255,0.55)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                        Echoes Recap
                    </h1>
                    <p style="color: var(--muted-foreground, #a1a1aa); font-size: 0.95rem; margin: 6px 0 0 0;">
                        Your personalized listening highlights, stats, and musical journey.
                    </p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <div class="recap-timeframe-selector" style="display: flex; background: var(--secondary, #27272a); padding: 3px; border-radius: 10px; border: 1px solid var(--border, rgba(255,255,255,0.1));">
                        <button class="recap-tf-btn ${timeframe === 'all' ? 'active' : ''}" data-tf="all" style="padding: 6px 14px; font-size: 0.85rem; border-radius: 8px; border: none; background: ${timeframe === 'all' ? 'var(--primary, #ffffff)' : 'transparent'}; color: ${timeframe === 'all' ? '#000000' : 'var(--foreground, #ffffff)'}; font-weight: 600; cursor: pointer; transition: all 0.2s;">All Time</button>
                        <button class="recap-tf-btn ${timeframe === 'year' ? 'active' : ''}" data-tf="year" style="padding: 6px 14px; font-size: 0.85rem; border-radius: 8px; border: none; background: ${timeframe === 'year' ? 'var(--primary, #ffffff)' : 'transparent'}; color: ${timeframe === 'year' ? '#000000' : 'var(--foreground, #ffffff)'}; font-weight: 600; cursor: pointer; transition: all 0.2s;">2026</button>
                        <button class="recap-tf-btn ${timeframe === '6m' ? 'active' : ''}" data-tf="6m" style="padding: 6px 14px; font-size: 0.85rem; border-radius: 8px; border: none; background: ${timeframe === '6m' ? 'var(--primary, #ffffff)' : 'transparent'}; color: ${timeframe === '6m' ? '#000000' : 'var(--foreground, #ffffff)'}; font-weight: 600; cursor: pointer; transition: all 0.2s;">6 Months</button>
                        <button class="recap-tf-btn ${timeframe === '30d' ? 'active' : ''}" data-tf="30d" style="padding: 6px 14px; font-size: 0.85rem; border-radius: 8px; border: none; background: ${timeframe === '30d' ? 'var(--primary, #ffffff)' : 'transparent'}; color: ${timeframe === '30d' ? '#000000' : 'var(--foreground, #ffffff)'}; font-weight: 600; cursor: pointer; transition: all 0.2s;">30 Days</button>
                    </div>
                    <button id="recap-share-btn" class="btn-primary" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 10px; font-weight: 600; cursor: pointer;">
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

    // Timeframe selector listeners
    container.querySelectorAll('.recap-tf-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const tf = btn.dataset.tf;
            await renderRecapPage(container, ui, tf);
        });
    });

    const recapData = await getRecapData(timeframe);
    const contentBody = container.querySelector('#recap-content-body');
    if (!contentBody) return;

    if (recapData.totalPlays === 0 && recapData.totalDurationSeconds === 0) {
        contentBody.innerHTML = `
            <div style="text-align: center; padding: 5rem 2rem; background: var(--card, #18181b); border-radius: 20px; border: 1px dashed var(--border, rgba(255,255,255,0.15));">
                <div style="width: 72px; height: 72px; margin: 0 auto 1.5rem auto; background: rgba(255,255,255,0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem;">
                    🎧
                </div>
                <h3 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.5rem;">Your Recap is Waiting</h3>
                <p style="color: var(--muted-foreground); max-width: 440px; margin: 0 auto 1.5rem auto; font-size: 0.95rem; line-height: 1.5;">
                    You haven't played any tracks during this period. Put on your favorite tracks, explore new albums, and your personalized stats will appear right here!
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
                <div style="font-size: 1.7rem; font-weight: 800; letter-spacing: -0.02em; color: #ffffff; line-height: 1.2;">
                    ✨ ${recapData.persona.title}
                </div>
                <p style="font-size: 0.9rem; color: var(--muted-foreground); margin: 6px 0 0 0; line-height: 1.4;">
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
            <div style="display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)); border: 1px solid var(--border, rgba(255,255,255,0.15)); border-radius: 20px; padding: 1.5rem; backdrop-filter: blur(16px);">
                <div style="position: relative; width: 140px; height: 140px; border-radius: 14px; overflow: hidden; flex-shrink: 0; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <img src="${escapeHtml(topTrack.cover || '/images/default-cover.png')}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />
                    <div style="position: absolute; top: 8px; left: 8px; background: #eab308; color: #000; font-size: 0.75rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">
                        #1
                    </div>
                </div>
                <div style="flex: 1; min-width: 240px;">
                    <div style="font-size: 1.4rem; font-weight: 800; color: #ffffff; margin-bottom: 4px; line-height: 1.3;">
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
                <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px;">
                    <span>Top Tracks</span>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${recapData.topTracks.slice(0, 5).map((track, i) => `
                        <div class="recap-track-row" style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--secondary, rgba(255,255,255,0.03)); border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.06));">
                            <span style="font-size: 0.9rem; font-weight: 800; min-width: 20px; color: ${i === 0 ? '#eab308' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--muted-foreground)'}; text-align: center;">
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
                <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px;">
                    <span>Top Artists</span>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${recapData.topArtists.slice(0, 5).map((artist, i) => `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--secondary, rgba(255,255,255,0.03)); border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.06));">
                            <span style="font-size: 0.9rem; font-weight: 800; min-width: 20px; color: ${i === 0 ? '#eab308' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--muted-foreground)'}; text-align: center;">
                                ${i + 1}
                            </span>
                            <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: rgba(255,255,255,0.1);">
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

        <!-- Listening Clock & Daypart Breakdown -->
        <div style="background: var(--card, #18181b); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 20px; padding: 1.5rem; margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <h3 style="font-size: 1.2rem; font-weight: 700; margin: 0 0 4px 0;">Listening Clock</h3>
                    <p style="color: var(--muted-foreground); font-size: 0.85rem; margin: 0;">When you hit play most often during the day</p>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.05));">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                        <span>🌅 Morning (6am-12pm)</span>
                        <strong>${morningPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${morningPct}%; background: #38bdf8; border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.05));">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                        <span>☀️ Afternoon (12pm-6pm)</span>
                        <strong>${afternoonPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${afternoonPct}%; background: #f59e0b; border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.05));">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                        <span>🌆 Evening (6pm-11pm)</span>
                        <strong>${eveningPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${eveningPct}%; background: #ec4899; border-radius: 999px;"></div>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px; border: 1px solid var(--border, rgba(255,255,255,0.05));">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                        <span>🌙 Night Owl (11pm-6am)</span>
                        <strong>${nightPct}%</strong>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${nightPct}%; background: #8b5cf6; border-radius: 999px;"></div>
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

    // Attach share story button listener
    const shareBtn = container.querySelector('#recap-share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            openShareStoryModal(recapData);
        });
    }
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
                    <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700;">Share Your Recap</h3>
                    <button id="close-recap-share-btn" class="modal-close" style="border: none; background: transparent; font-size: 1.5rem; cursor: pointer;">&times;</button>
                </div>
                <div style="margin-bottom: 1.5rem; display: flex; justify-content: center;">
                    <canvas id="recap-story-canvas" width="720" height="960" style="max-width: 100%; height: auto; border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1);"></canvas>
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

    // Background gradient
    const bgGradient = ctx.createLinearGradient(0, 0, w, h);
    bgGradient.addColorStop(0, '#0f172a');
    bgGradient.addColorStop(0.5, '#020617');
    bgGradient.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, w, h);

    // Decorative ambient circles
    ctx.save();
    ctx.filter = 'blur(60px)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.beginPath();
    ctx.arc(w * 0.2, h * 0.2, 140, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.7, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Echoes Branding Header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('ECHOES', 48, 70);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('MUSIC RECAP 2026', 48, 98);

    // Persona badge
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(data.persona.title, 48, 160);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(data.persona.tagline, 48, 192);

    // Stats Grid Box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(48, 225, w - 96, 110, 16);
    ctx.fill();
    ctx.stroke();

    // Total Time
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('TOTAL LISTENING', 72, 260);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(formatHoursMinutes(data.totalDurationSeconds), 72, 305);

    // Total Plays
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PLAYS', 360, 260);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(data.totalPlays), 360, 305);

    // Unique Artists
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('ARTISTS', 530, 260);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(data.uniqueArtistsCount), 530, 305);

    // Top Songs List
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('TOP TRACKS', 48, 380);

    const tracksToShow = data.topTracks.slice(0, 3);
    let trackY = 415;
    tracksToShow.forEach((t, i) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(48, trackY, w - 96, 60, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = i === 0 ? '#eab308' : '#cbd5e1';
        ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`#${i + 1}`, 68, trackY + 36);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const titleText = t.title.length > 32 ? t.title.slice(0, 32) + '...' : t.title;
        ctx.fillText(titleText, 110, trackY + 28);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const artistName = t.artist?.name || (t.artists && t.artists[0]?.name) || 'Unknown';
        ctx.fillText(artistName, 110, trackY + 48);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${t.playCount} plays`, w - 140, trackY + 36);

        trackY += 72;
    });

    // Top Artists List
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('TOP ARTISTS', 48, trackY + 25);

    const artistsToShow = data.topArtists.slice(0, 3);
    let artistY = trackY + 55;
    artistsToShow.forEach((a, i) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(48, artistY, w - 96, 52, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = i === 0 ? '#eab308' : '#cbd5e1';
        ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`#${i + 1}`, 68, artistY + 32);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(a.name, 110, artistY + 32);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${a.playCount} plays`, w - 140, artistY + 32);

        artistY += 62;
    });

    // Footer Watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('echoes.mteck.tech &bull; ArchiveTune Edition', 48, h - 36);
}
