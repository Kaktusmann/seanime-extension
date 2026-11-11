const $ = (id) => document.getElementById(id);

const els = {
    player:           $("anime-theme-player"),
    providerLabel:    $("atp-provider-label"),
    nowPlaying:       $("atp-now-playing"),
    toggleListBtn:    $("atp-toggle-list"),
    manualBtn:        $("atp-manual-btn"),
    manualDot:        $("atp-manual-dot"),
    providerBtn:      $("atp-provider-btn"),
    closeBtn:         $("atp-close-btn"),
    themesList:       $("atp-themes-list"),
    themesCol:        $("atp-themes-col"),
    videoWrapper:     $("atp-video-wrapper"),
    idle:             $("atp-idle"),
    audioOverlay:     $("atp-audio-overlay"),
    currentTime:      $("atp-current-time"),
    duration:         $("atp-duration"),
    progressBar:      $("atp-progress-bar"),
    progressFill:     $("atp-progress-fill"),
    playBtn:          $("atp-play-btn"),
    playIcon:         $("atp-play-icon"),
    pauseIcon:        $("atp-pause-icon"),
    skipBack:         $("atp-skip-back"),
    skipFwd:          $("atp-skip-fwd"),
    audioOnlyBtn:     $("atp-audio-only-btn"),
    fullscreenBtn:    $("atp-fullscreen-btn"),
    muteBtn:          $("atp-mute-btn"),
    volIcon:          $("atp-vol-icon"),
    mutedIcon:        $("atp-muted-icon"),
    volumeTrack:      $("atp-volume-track"),
    volumeFill:       $("atp-volume-fill"),
    manualPanel:      $("atp-manual-panel"),
    manualInput:      $("atp-manual-input"),
    manualProvider:   $("atp-manual-provider"),
    manualSearchBtn:  $("atp-manual-search-btn"),
    manualClearBtn:   $("atp-manual-clear-btn"),
    animeResults:     $("atp-anime-results"),
    credits:          $("atp-song-credits"),
};

let video           = null;
let currentVolume   = INITIAL_VOLUME;
let isMuted         = false;
let isAudioOnly     = false;
let isListVisible   = true;
let isManualVisible = false;
let attemptedProviders = new Set();

// Helpers
const fmt = (s) => {
    if (isNaN(s) || s === Infinity) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
};

const setPlaying = (playing) => {
    els.playIcon.style.display  = playing ? "none" : "";
    els.pauseIcon.style.display = playing ? "" : "none";
};

const setMuted = (muted) => {
    isMuted = muted;
    els.volIcon.style.display   = muted ? "none" : "";
    els.mutedIcon.style.display = muted ? "" : "none";
    if (video) video.muted = muted;
};

const setVolume = (v) => {
    currentVolume = Math.max(0, Math.min(1, v));
    els.volumeFill.style.width = `${currentVolume * 100}%`;
    if (video) video.volume = currentVolume;
};

const setProviderLabel = () => {
    els.providerLabel.textContent = PROVIDER === "animethemes" ? "AnimeThemes" : "AniSongDB";
    els.manualProvider.value = PROVIDER;
};

const setNowPlaying = (text) => {
    els.nowPlaying.textContent = text || "No theme selected";
};

const showIdle = (show) => {
    els.idle.style.display = show ? "" : "none";
};

const updateManualDot = () => {
    els.manualDot.style.display = MANUAL_MATCHES[ANILIST_ID] ? "block" : "none";
};

const setThemesLoading = (msg = "Loading themes…") => {
    els.themesList.innerHTML = `<div class="atp-status"><span class="atp-spinner"></span>${msg}</div>`;
};

const setThemesError = (msg) => {
    els.themesList.innerHTML = `<div class="atp-status error">${msg}</div>`;
};

// Video
const ensureVideo = () => {
    if (video) return video;

    video = document.createElement("video");
    video.controls = false;
    video.volume   = currentVolume;
    video.muted    = isMuted;

    video.addEventListener("timeupdate", () => {
        if (!video.duration) return;
        const pct = (video.currentTime / video.duration) * 100;
        els.progressFill.style.width = pct + "%";
        els.currentTime.textContent  = fmt(video.currentTime);
    });

    video.addEventListener("loadedmetadata", () => {
        els.duration.textContent = fmt(video.duration);
    });

    video.addEventListener("ended", () => {
        setPlaying(false);
    });

    video.addEventListener("play",  () => setPlaying(true));
    video.addEventListener("pause", () => setPlaying(false));

    els.videoWrapper.insertBefore(video, els.idle);
    return video;
};

const destroyVideo = () => {
    if (!video) return;
    video.pause();

    video.removeAttribute("src");
    video.load();
    setPlaying(false);
    els.progressFill.style.width = "0%";
    els.currentTime.textContent  = "0:00";
    els.duration.textContent     = "0:00";
};

// Play a theme
const playTheme = (item, autoplay = true) => {
    const videoUrl = item.dataset.video;
    if (!videoUrl) return;

    document.querySelectorAll("#anime-theme-player .theme-item")
        .forEach(i => i.classList.remove("active"));
    item.classList.add("active");

    showIdle(false);

    const v = ensureVideo();
    v.pause();
    v.currentTime = 0;
    v.src = videoUrl;

    const type   = item.dataset.type || "";
    const song   = item.dataset.song || "";
    const anime  = item.dataset.anime || "";
    const artist = item.querySelector(".theme-artist")?.textContent || "";

    const badgeEl = document.getElementById("atp-song-badge");
    const titleEl = document.getElementById("atp-song-title");
    const artistEl = document.getElementById("atp-song-artist");


    if(badgeEl) badgeEl.textContent = type;
    if(titleEl) titleEl.textContent = song;
    if(artistEl) artistEl.textContent = artist || anime;

    const composer = item.dataset.composer || "";
    const arranger = item.dataset.arranger || "";
    const creditsEl = document.getElementById("atp-song-credits");

    if (creditsEl) {
        const parts = [];

        if (composer) {
            parts.push(`<div class="atp-credit-item"><span class="atp-credit-label">COMPOSER: </span>${composer}</div>`);
        }
        if (arranger) {
            parts.push(`<div class="atp-credit-item"><span class="atp-credit-label">ARRANGER: </span>${arranger}</div>`);
        }

        if (parts.length > 0) {
            creditsEl.innerHTML = parts.join('');
            creditsEl.style.display = 'flex';
        } else {
            creditsEl.style.display = 'none';
        }
    }

    if (autoplay) {
        v.play().catch(() => {});
    }
};

const setAudioOnly = (on) => {
    isAudioOnly = on;
    els.videoWrapper.classList.toggle("audio-only-mode", on);
    els.audioOnlyBtn.classList.toggle("active", on);
};

const renderThemes = (themes) => {
    if (!themes.length) {
        setThemesError("No themes found.");
        return;
    }

    const priority = { "OP": 1, "ED": 2, "IN": 3 };

    themes.sort((a, b) => {
        const parseType = (str) => {
            const match = str.match(/^([A-Z]+)\s*(\d+)?/i);
            return {
                type: match ? match[1].toUpperCase() : "",
                num: match && match[2] ? parseInt(match[2]) : 999
            };
        };

        const aData = parseType(a.type);
        const bData = parseType(b.type);

        if (priority[aData.type] !== priority[bData.type]) {
            return (priority[aData.type] || 4) - (priority[bData.type] || 4);
        }

        return aData.num - bData.num;
    });

    els.themesList.innerHTML = themes.map(t => `
      <div class="theme-item"
           data-video="${t.videoUrl}"
           data-type="${t.type}"
           data-song="${t.song}"
           data-anime="${t.anime}"
           data-composer="${t.composer || ''}"
           data-arranger="${t.arranger || ''}"
           >
        <div class="theme-item-row">
          <span class="theme-type-badge">${t.type}</span>
          <span class="theme-song">${t.song}</span>
        </div>
        ${t.artist ? `<div class="theme-artist">${t.artist}</div>` : ""}
        <div class="theme-actions">
          <button class="theme-action-btn btn-play-video">▶ Video</button>
          <button class="theme-action-btn btn-play-audio">♪ Audio only</button>
        </div>
      </div>
    `).join("");

    els.themesList.querySelectorAll(".theme-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (e.target.closest(".theme-actions")) return;
            setAudioOnly(false);
            playTheme(item, true);
        });

        item.querySelector(".btn-play-video").addEventListener("click", (e) => {
            e.stopPropagation();
            setAudioOnly(false);
            playTheme(item, true);
        });

        item.querySelector(".btn-play-audio").addEventListener("click", (e) => {
            e.stopPropagation();
            setAudioOnly(true);
            playTheme(item, true);
        });
    });

    if (AUTOPLAY) {
        const firstItem = els.themesList.querySelector(".theme-item");
        if (firstItem) {
            playTheme(firstItem, true);
        }
    }
};

const animeThemesQuery = async (query, variables) => {
    const res = await fetch("https://rs.animethemes.moe/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data;
};

const fetchAnimeThemes = async () => {
    const data = await animeThemesQuery(
        `query ($id: Int!) {
            filterAnimeByExternalSite(site: ANILIST, id: [$id]) {
                title { romaji }
                themes {
                    type
                    sequence
                    song { title { romaji } staff { role artist { name { main } } } }
                    entries { videos { nodes { link } } }
                }
            }
        }`,
        { id: Number(ANILIST_ID) }
    );
    const anime = data.filterAnimeByExternalSite[0];
    if (!anime?.themes?.length) throw new Error("No themes found");

    return anime.themes
        .map(theme => {
            const videoUrl = theme.entries[0]?.videos.nodes[0]?.link;
            if (!videoUrl) return null;
            return {
                anime: anime.title.romaji,
                type: `${theme.type}${theme.sequence || ""}`,
                song: theme.song?.title.romaji || "Unknown",
                artist: theme.song?.staff
                    .filter(s => s.role === "Performance")
                    .map(s => s.artist.name.main)
                    .join(", ") || "",
                videoUrl,
            };
        })
        .filter(Boolean);
};

const fetchAniSongDB = async () => {
    const anilistId = Number(ANILIST_ID);

    // AniList → MAL
    const malResp = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            query: `query ($id: Int) { Media(id: $id) { idMal title { romaji english native } } }`,
            variables: { id: anilistId },
        }),
    });
    const malJson = await malResp.json();
    const malId   = malJson.data?.Media?.idMal;
    const title   =
        malJson.data?.Media?.title?.romaji ||
        malJson.data?.Media?.title?.english ||
        malJson.data?.Media?.title?.native || "Anime";
    if (!malId) throw new Error("AniList → MAL failed");

    // MAL → ANN (Jikan)
    const jikan    = await fetch(`https://api.jikan.moe/v4/anime/${malId}/external`);
    const jikanJson = await jikan.json();
    const ann      = jikanJson.data?.find(e => e.name === "ANN");
    if (!ann) throw new Error("MAL → ANN failed");

    const annId = Number(ann.url.match(/id=(\d+)/)?.[1]);
    if (!annId) throw new Error("ANN id missing");

    // ANN → AniSongDB
    const songsResp = await fetch("https://anisongdb.com/api/annId_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            annId,
            ignore_duplicate: false,
            opening_filter: true,
            ending_filter: true,
            insert_filter: true,
        }),
    });
    const songs = await songsResp.json();
    if (!Array.isArray(songs) || !songs.length) throw new Error("AniSongDB empty");

    const map = new Map();
    songs.forEach(s => {
        const file = s.MQ || s.HQ;
        if (!file) return;
        const type = s.songType
            .replace("Opening", "OP")
            .replace("Ending", "ED")
            .replace("Insert Song", "IN");
        const key = `${type}-${s.songName}`;
        if (!map.has(key)) {
            map.set(key, {
                anime: title,
                type,
                song: s.songName,
                artist: s.songArtist,
                composer: s.songComposer,
                arranger: s.songArranger,
                videoUrl: `https://naedist.animemusicquiz.com/${file}`,
            });
        }
    });

    const ord = { OP: 1, ED: 2, IN: 3 };
    return [...map.values()].sort((a, b) => {
        const aT = a.type.match(/[A-Z]+/)[0];
        const bT = b.type.match(/[A-Z]+/)[0];
        const aN = parseInt(a.type.match(/\d+/)?.[0] || "0");
        const bN = parseInt(b.type.match(/\d+/)?.[0] || "0");
        return (ord[aT] - ord[bT]) || (aN - bN);
    });
};

const fetchAniSongDBDirect = async (query) => {
    const res = await fetch("https://anisongdb.com/api/search_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            anime_search_filter: { search: query, partial_match: true },
            and_logic: false, ignore_duplicate: false,
            opening_filter: true, ending_filter: true, insert_filter: true,
            normal_broadcast: true, rebroadcast: true,
            standard: true, instrumental: true, chanting: true, character: true,
        }),
    });
    return res.json();
};

const fetchThemes = async (providerOverride) => {
    const provider = providerOverride || PROVIDER;

    // Check manual match override
    const manualId = MANUAL_MATCHES[ANILIST_ID];

    if (manualId) {
        setThemesLoading("Loading themes for manual match…");
        try {
            const filtered = await fetchAniSongDBDirect(manualId);
            if (!filtered.length) throw new Error("No themes for matched anime");

            const songMap = new Map();

            filtered.forEach(r => {
                if (r.animeENName !== manualId && r.animeJPName !== manualId) return;

                const videoUrl = r.MQ || r.HQ;
                if (!videoUrl) return;

                const type = r.songType.replace("Opening","OP").replace("Ending","ED").replace("Insert Song","IN");
                const key = `${type}-${r.songName}`;

                if (!songMap.has(key)) {
                    songMap.set(key, {
                        anime: r.animeENName || r.animeJPName,
                        type,
                        song: r.songName,
                        artist: r.songArtist,
                        composer: r.songComposer,
                        arranger: r.songArranger,
                        videoUrl: `https://naedist.animemusicquiz.com/${videoUrl}`,
                    });
                }
            });

            if (songMap.size === 0) throw new Error("No exact name matches found");

            renderThemes([...songMap.values()]);
            return;
        } catch (err) {
            console.error("[AnimeThemes] manual match failed:", err);
            // Si falla el filtro, intentará el fetch normal
        }
    }

    if (attemptedProviders.has(provider)) {
        setThemesError("No themes found on any provider.");
        return;
    }

    attemptedProviders.add(provider);
    setThemesLoading();

    try {
        const themes = provider === "animethemes"
            ? await fetchAnimeThemes()
            : await fetchAniSongDB();

        attemptedProviders.clear();
        renderThemes(themes);
    } catch (err) {
        console.error(`[AnimeThemes] failed on ${provider}:`, err);
        const fallback = provider === "animethemes" ? "anisongdb" : "animethemes";
        if (!attemptedProviders.has(fallback)) {
            setThemesLoading(`Not found on ${provider === "animethemes" ? "AnimeThemes" : "AniSongDB"}, trying ${fallback}…`);
            setTimeout(() => fetchThemes(fallback), 1000);
        } else {
            setThemesError("No themes found on AnimeThemes nor AniSongDB.");
        }
    }
};

const searchAnimeThemes = async (query) => {
    const data = await animeThemesQuery(
        `query ($q: String!) {
            search(search: $q, first: 15, page: 1) {
                anime { data { title { romaji } resources { nodes { site externalId } } } }
            }
        }`,
        { q: query }
    );
    return data.search.anime.data.map(a => ({
        name: a.title.romaji,
        anilistId: a.resources.nodes.find(r => r.site === "ANILIST")?.externalId ?? null,
    })).filter(a => a.anilistId);
};

const searchAniSongDBByName = async (query) => {
    const res = await fetch("https://anisongdb.com/api/search_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            anime_search_filter: { search: query, partial_match: true },
            and_logic: false, ignore_duplicate: false,
            opening_filter: true, ending_filter: true, insert_filter: true,
        }),
    });
    const data = await res.json();
    console.log(data);
    const seen = new Map();
    data.forEach(r => {
        const ids = r.linked_ids?.anilist;
        const anilistIds = Array.isArray(ids) ? ids : (ids ? [ids] : []);
        anilistIds.forEach(id => {
            if (!seen.has(id)) {
                seen.set(id, { name: r.animeENName || r.animeJPName, anilistId: id });
            }
        });
    });
    return [...seen.values()];
};

const displayAnimeResults = (results, provider) => {
    if (!results.length) {
        els.animeResults.innerHTML = `<div class="atp-status">No anime found</div>`;
        els.animeResults.classList.add("visible");
        return;
    }

    els.animeResults.innerHTML = results.map(r =>
        `<div class="anime-result-item" data-anilist-id="${r.anilistId}" data-name="${r.name}">${r.name}</div>`
    ).join("");
    els.animeResults.classList.add("visible");

    els.animeResults.querySelectorAll(".anime-result-item").forEach(item => {
        item.addEventListener("click", () => {
            const name = item.dataset.name;
            MANUAL_MATCHES[ANILIST_ID] = name;

            // close manual panel
            isManualVisible = false;
            els.manualPanel.classList.remove("visible");
            els.animeResults.classList.remove("visible");
            els.animeResults.innerHTML = "";
            els.manualBtn.classList.remove("active");

            updateManualDot();
            setThemesLoading("Loading matched themes…");
            fetchThemes();
        });
    });
};

// play/pause
els.playBtn.addEventListener("click", () => {
    if (!video?.src) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
});

// skip
els.skipBack.addEventListener("click", () => { if (video?.src) video.currentTime = Math.max(0, video.currentTime - 10); });
els.skipFwd.addEventListener("click",  () => { if (video?.src) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); });

// progress bar
els.progressBar.addEventListener("click", e => {
    if (!video?.src) return;
    const rect = els.progressBar.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
});

// volume
els.volumeTrack.addEventListener("click", e => {
    const rect = els.volumeTrack.getBoundingClientRect();
    setVolume((e.clientX - rect.left) / rect.width);
});

// mute
els.muteBtn.addEventListener("click", () => setMuted(!isMuted));

// audio only
els.audioOnlyBtn.addEventListener("click", () => setAudioOnly(!isAudioOnly));

// fullscreen
els.fullscreenBtn.addEventListener("click", () => {
    if (!video) return;
    (video.requestFullscreen || video.webkitRequestFullscreen)?.call(video);
});

// toggle list
els.toggleListBtn.addEventListener("click", () => {
    isListVisible = !isListVisible;

    els.themesCol.classList.toggle("collapsed", !isListVisible);
    els.player.querySelector(".atp-body").classList.toggle("collapsed", !isListVisible);

    els.toggleListBtn.classList.toggle("active", isListVisible);
});

// manual match toggle
els.manualBtn.addEventListener("click", () => {
    isManualVisible = !isManualVisible;
    els.manualPanel.classList.toggle("visible", isManualVisible);
    els.manualBtn.classList.toggle("active", isManualVisible);
});

// change provider
els.providerBtn.addEventListener("click", () => {
    PROVIDER = PROVIDER === "animethemes" ? "anisongdb" : "animethemes";
    setProviderLabel();
    attemptedProviders.clear();
    destroyVideo();
    showIdle(true);
    setNowPlaying("No theme selected");
    fetchThemes();
});

els.closeBtn.addEventListener("click", () => {
    destroyVideo();
    var root = document.getElementById("anime-theme-player-root");
    if (root) root.style.display = "none";

    var main = document.querySelector('[data-anime-entry-page-content-container="true"]');
    if (main) main.style.display = "";
});

// manual search
els.manualSearchBtn.addEventListener("click", async () => {
    const query    = els.manualInput.value.trim();
    const provider = els.manualProvider.value;
    if (!query) return;

    els.animeResults.innerHTML = `<div class="atp-status"><span class="atp-spinner"></span>Searching…</div>`;
    els.animeResults.classList.add("visible");

    try {
        const results = provider === "animethemes"
            ? await searchAnimeThemes(query)
            : await searchAniSongDBByName(query);
        displayAnimeResults(results, provider);
    } catch (err) {
        els.animeResults.innerHTML = `<div class="atp-status error">Search failed</div>`;
    }
});

els.manualInput.addEventListener("keypress", e => {
    if (e.key === "Enter") els.manualSearchBtn.click();
});

// manual clear
els.manualClearBtn.addEventListener("click", async () => {
    delete MANUAL_MATCHES[ANILIST_ID];
    els.manualInput.value = "";
    els.animeResults.classList.remove("visible");
    els.animeResults.innerHTML = "";
    updateManualDot();
    destroyVideo();
    showIdle(true);
    setNowPlaying("No theme selected");
    fetchThemes();
    isManualVisible = false;
    els.manualPanel.classList.remove("visible");
    els.manualBtn.classList.remove("active");
});

setVolume(INITIAL_VOLUME);
setProviderLabel();
updateManualDot();
showIdle(true);
fetchThemes();