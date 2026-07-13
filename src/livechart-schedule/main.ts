/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

interface LcTrack {
    languageCode: string
    shortLabel: string
    category: string
}

interface LcSchedule {
    databaseId: string
    title: string
    shortTitle: string
    isJapan: boolean
    networkName: string | null
    tracks: LcTrack[]
    releaseStatus: string | null
    nextEpisodeNumber: number | null
    nextEpisodeDate: string | null
}

function init() {
    $app.onAnimeScheduleItems((e) => {
        const MAPPING_KEY = "livechart.mapping"
        const SCHEDULES_KEY = "livechart.schedules"
        const OVERRIDE_KEY = "livechart.override"
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const GLOBAL_MODE_KEY = "livechart.globalMode"

        // Read every storage key exactly once per hook call, not once per
        // item: $storage is one JSON blob per plugin (not per-key), so a
        // get/set inside a per-item loop means a full blob read-modify-write
        // for every single item - with a full schedule list that's dozens of
        // redundant DB round-trips (and log lines) for what should be a
        // handful of reads plus at most one write.
        const mapping = $storage.get<Record<string, { id: string | null; checkedAt: number }>>(MAPPING_KEY) || {}
        const schedulesCache = $storage.get<Record<string, { fetchedAt: number; schedules: LcSchedule[] }>>(SCHEDULES_KEY) || {}
        const overrides = $storage.get<Record<string, string>>(OVERRIDE_KEY) || {}
        const globalMode = $storage.get<string>(GLOBAL_MODE_KEY) || "japan"
        const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
        let recentAirTimesChanged = false

        function recordRecentAirTime(mediaId: number, episodeNumber: number, seconds: number) {
            const key = `${mediaId}-${episodeNumber}`
            if (recentAirTimes[key] === seconds) return
            recentAirTimes[key] = seconds
            recentAirTimesChanged = true
        }

        function pickSchedule(mediaId: number, schedules: LcSchedule[]): LcSchedule | null {
            if (!schedules.length) return null

            const overrideId = overrides[String(mediaId)]
            if (overrideId) {
                const chosen = schedules.find(s => s.databaseId === overrideId)
                if (chosen) return chosen
            }

            const jp = schedules.find(s => s.isJapan) || null
            if (globalMode === "japan") return jp || schedules[0]

            const nonJp = schedules.filter(s => !s.isJapan)
            const sub = nonJp.find(s => /sub/i.test(s.shortTitle) || /sub/i.test(s.title))
            return sub || nonJp[0] || jp || schedules[0]
        }

        function resolveNextEpisodeInfo(mediaId: number, anilistEpisodeNumber: number, rawSeconds: number | null, allowEarlierEpisodeOverride: boolean): { episode: number; seconds: number } | null {
            if (!mediaId || !anilistEpisodeNumber) return null

            const mappingEntry = mapping[String(mediaId)]
            const lcId = mappingEntry ? mappingEntry.id : null
            if (!lcId) return null

            const scheduleEntry = schedulesCache[lcId]
            const schedules = scheduleEntry ? scheduleEntry.schedules : null
            if (!schedules || !schedules.length) return null

            const chosen = pickSchedule(mediaId, schedules)
            if (!chosen) return null

            if (chosen.nextEpisodeDate != null && chosen.nextEpisodeNumber != null) {
                const matchesExactly = chosen.nextEpisodeNumber === anilistEpisodeNumber
                const isEarlierAndAllowed = allowEarlierEpisodeOverride && chosen.nextEpisodeNumber < anilistEpisodeNumber
                if (matchesExactly || isEarlierAndAllowed) {
                    const t = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(t)) return { episode: chosen.nextEpisodeNumber, seconds: Math.floor(t / 1000) }
                }
            }

            if (!chosen.isJapan && rawSeconds != null) {
                const jp = schedules.find(s => s.isJapan)
                if (jp && jp.nextEpisodeDate != null && chosen.nextEpisodeDate != null && jp.nextEpisodeNumber === chosen.nextEpisodeNumber) {
                    const jpMs = new Date(jp.nextEpisodeDate).getTime()
                    const chosenMs = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(jpMs) && !isNaN(chosenMs)) {
                        return { episode: anilistEpisodeNumber, seconds: rawSeconds + Math.round((chosenMs - jpMs) / 1000) }
                    }
                }
            }

            return null
        }

        for (const item of e.items || []) {
            try {
                let rawSeconds: number | null = null
                if (item.dateTime) {
                    const t = Date.parse(item.dateTime)
                    if (!isNaN(t)) rawSeconds = Math.floor(t / 1000)
                }
                const result = resolveNextEpisodeInfo(item.mediaId, item.episodeNumber, rawSeconds, false)
                if (result != null) {
                    const d = new Date(result.seconds * 1000)
                    item.episodeNumber = result.episode
                    item.dateTime = d.toISOString()
                    item.time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
                    recordRecentAirTime(item.mediaId, result.episode, result.seconds)
                }
            } catch (err) {
                // keep this item's original AniList-derived time
            }
        }
        if (recentAirTimesChanged) $storage.set(RECENT_AIR_KEY, recentAirTimes)
        e.next()
    })

    function mutateAnimeCollectionEvent(e: { next(): void; animeCollection?: $app.AL_AnimeCollection }) {
        const MAPPING_KEY = "livechart.mapping"
        const SCHEDULES_KEY = "livechart.schedules"
        const OVERRIDE_KEY = "livechart.override"
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const GLOBAL_MODE_KEY = "livechart.globalMode"

        // See the matching comment in onAnimeScheduleItems: reads happen once
        // per hook call rather than once per collection entry, since this can
        // iterate the user's whole library.
        const mapping = $storage.get<Record<string, { id: string | null; checkedAt: number }>>(MAPPING_KEY) || {}
        const schedulesCache = $storage.get<Record<string, { fetchedAt: number; schedules: LcSchedule[] }>>(SCHEDULES_KEY) || {}
        const overrides = $storage.get<Record<string, string>>(OVERRIDE_KEY) || {}
        const globalMode = $storage.get<string>(GLOBAL_MODE_KEY) || "japan"
        const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
        let recentAirTimesChanged = false

        function recordRecentAirTime(mediaId: number, episodeNumber: number, seconds: number) {
            const key = `${mediaId}-${episodeNumber}`
            if (recentAirTimes[key] === seconds) return
            recentAirTimes[key] = seconds
            recentAirTimesChanged = true
        }

        function pickSchedule(mediaId: number, schedules: LcSchedule[]): LcSchedule | null {
            if (!schedules.length) return null

            const overrideId = overrides[String(mediaId)]
            if (overrideId) {
                const chosen = schedules.find(s => s.databaseId === overrideId)
                if (chosen) return chosen
            }

            const jp = schedules.find(s => s.isJapan) || null
            if (globalMode === "japan") return jp || schedules[0]

            const nonJp = schedules.filter(s => !s.isJapan)
            const sub = nonJp.find(s => /sub/i.test(s.shortTitle) || /sub/i.test(s.title))
            return sub || nonJp[0] || jp || schedules[0]
        }

        function resolveNextEpisodeInfo(mediaId: number, anilistEpisodeNumber: number, rawSeconds: number | null, allowEarlierEpisodeOverride: boolean): { episode: number; seconds: number } | null {
            if (!mediaId || !anilistEpisodeNumber) return null

            const mappingEntry = mapping[String(mediaId)]
            const lcId = mappingEntry ? mappingEntry.id : null
            if (!lcId) return null

            const scheduleEntry = schedulesCache[lcId]
            const schedules = scheduleEntry ? scheduleEntry.schedules : null
            if (!schedules || !schedules.length) return null

            const chosen = pickSchedule(mediaId, schedules)
            if (!chosen) return null

            if (chosen.nextEpisodeDate != null && chosen.nextEpisodeNumber != null) {
                const matchesExactly = chosen.nextEpisodeNumber === anilistEpisodeNumber
                const isEarlierAndAllowed = allowEarlierEpisodeOverride && chosen.nextEpisodeNumber < anilistEpisodeNumber
                if (matchesExactly || isEarlierAndAllowed) {
                    const t = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(t)) return { episode: chosen.nextEpisodeNumber, seconds: Math.floor(t / 1000) }
                }
            }

            if (!chosen.isJapan && rawSeconds != null) {
                const jp = schedules.find(s => s.isJapan)
                if (jp && jp.nextEpisodeDate != null && chosen.nextEpisodeDate != null && jp.nextEpisodeNumber === chosen.nextEpisodeNumber) {
                    const jpMs = new Date(jp.nextEpisodeDate).getTime()
                    const chosenMs = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(jpMs) && !isNaN(chosenMs)) {
                        return { episode: anilistEpisodeNumber, seconds: rawSeconds + Math.round((chosenMs - jpMs) / 1000) }
                    }
                }
            }

            return null
        }

        const lists = e.animeCollection && e.animeCollection.MediaListCollection && e.animeCollection.MediaListCollection.lists
        if (lists) {
            const nowSeconds = Math.floor(Date.now() / 1000)
            for (const list of lists) {
                if (!list || !list.entries) continue
                for (const entry of list.entries) {
                    const media = entry && entry.media
                    if (!media || !media.nextAiringEpisode) continue
                    try {
                        const result = resolveNextEpisodeInfo(media.id, media.nextAiringEpisode.episode, media.nextAiringEpisode.airingAt, true)
                        if (result != null) {
                            media.nextAiringEpisode.episode = result.episode
                            media.nextAiringEpisode.airingAt = result.seconds
                            media.nextAiringEpisode.timeUntilAiring = result.seconds - nowSeconds
                            recordRecentAirTime(media.id, result.episode, result.seconds)
                        }
                    } catch (err) {
                        // keep this entry's original AniList-derived time
                    }
                }
            }
        }
        if (recentAirTimesChanged) $storage.set(RECENT_AIR_KEY, recentAirTimes)
        e.next()
    }

    $app.onGetAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetRawAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetCachedAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetCachedRawAnimeCollection(mutateAnimeCollectionEvent)

    $app.onAnimeEntry((e) => {
        const MAPPING_KEY = "livechart.mapping"
        const SCHEDULES_KEY = "livechart.schedules"
        const OVERRIDE_KEY = "livechart.override"
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const GLOBAL_MODE_KEY = "livechart.globalMode"

        const mapping = $storage.get<Record<string, { id: string | null; checkedAt: number }>>(MAPPING_KEY) || {}
        const schedulesCache = $storage.get<Record<string, { fetchedAt: number; schedules: LcSchedule[] }>>(SCHEDULES_KEY) || {}
        const overrides = $storage.get<Record<string, string>>(OVERRIDE_KEY) || {}
        const globalMode = $storage.get<string>(GLOBAL_MODE_KEY) || "japan"

        function recordRecentAirTime(mediaId: number, episodeNumber: number, seconds: number) {
            const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
            const key = `${mediaId}-${episodeNumber}`
            if (recentAirTimes[key] === seconds) return
            recentAirTimes[key] = seconds
            $storage.set(RECENT_AIR_KEY, recentAirTimes)
        }

        function pickSchedule(mediaId: number, schedules: LcSchedule[]): LcSchedule | null {
            if (!schedules.length) return null

            const overrideId = overrides[String(mediaId)]
            if (overrideId) {
                const chosen = schedules.find(s => s.databaseId === overrideId)
                if (chosen) return chosen
            }

            const jp = schedules.find(s => s.isJapan) || null
            if (globalMode === "japan") return jp || schedules[0]

            const nonJp = schedules.filter(s => !s.isJapan)
            const sub = nonJp.find(s => /sub/i.test(s.shortTitle) || /sub/i.test(s.title))
            return sub || nonJp[0] || jp || schedules[0]
        }

        function resolveNextEpisodeInfo(mediaId: number, anilistEpisodeNumber: number, rawSeconds: number | null, allowEarlierEpisodeOverride: boolean): { episode: number; seconds: number } | null {
            if (!mediaId || !anilistEpisodeNumber) return null

            const mappingEntry = mapping[String(mediaId)]
            const lcId = mappingEntry ? mappingEntry.id : null
            if (!lcId) return null

            const scheduleEntry = schedulesCache[lcId]
            const schedules = scheduleEntry ? scheduleEntry.schedules : null
            if (!schedules || !schedules.length) return null

            const chosen = pickSchedule(mediaId, schedules)
            if (!chosen) return null

            if (chosen.nextEpisodeDate != null && chosen.nextEpisodeNumber != null) {
                const matchesExactly = chosen.nextEpisodeNumber === anilistEpisodeNumber
                const isEarlierAndAllowed = allowEarlierEpisodeOverride && chosen.nextEpisodeNumber < anilistEpisodeNumber
                if (matchesExactly || isEarlierAndAllowed) {
                    const t = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(t)) return { episode: chosen.nextEpisodeNumber, seconds: Math.floor(t / 1000) }
                }
            }

            if (!chosen.isJapan && rawSeconds != null) {
                const jp = schedules.find(s => s.isJapan)
                if (jp && jp.nextEpisodeDate != null && chosen.nextEpisodeDate != null && jp.nextEpisodeNumber === chosen.nextEpisodeNumber) {
                    const jpMs = new Date(jp.nextEpisodeDate).getTime()
                    const chosenMs = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(jpMs) && !isNaN(chosenMs)) {
                        return { episode: anilistEpisodeNumber, seconds: rawSeconds + Math.round((chosenMs - jpMs) / 1000) }
                    }
                }
            }

            return null
        }

        const media = e.entry && e.entry.media
        if (media && media.nextAiringEpisode) {
            try {
                const nowSeconds = Math.floor(Date.now() / 1000)
                const result = resolveNextEpisodeInfo(media.id, media.nextAiringEpisode.episode, media.nextAiringEpisode.airingAt, true)
                if (result != null) {
                    media.nextAiringEpisode.episode = result.episode
                    media.nextAiringEpisode.airingAt = result.seconds
                    media.nextAiringEpisode.timeUntilAiring = result.seconds - nowSeconds
                    recordRecentAirTime(media.id, result.episode, result.seconds)
                }
            } catch (err) {
                // keep this entry's original AniList-derived time
            }
        }
        e.next()
    })

    $app.onUpcomingEpisodes((e) => {
        const MAPPING_KEY = "livechart.mapping"
        const SCHEDULES_KEY = "livechart.schedules"
        const OVERRIDE_KEY = "livechart.override"
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const GLOBAL_MODE_KEY = "livechart.globalMode"

        const mapping = $storage.get<Record<string, { id: string | null; checkedAt: number }>>(MAPPING_KEY) || {}
        const schedulesCache = $storage.get<Record<string, { fetchedAt: number; schedules: LcSchedule[] }>>(SCHEDULES_KEY) || {}
        const overrides = $storage.get<Record<string, string>>(OVERRIDE_KEY) || {}
        const globalMode = $storage.get<string>(GLOBAL_MODE_KEY) || "japan"
        const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
        let recentAirTimesChanged = false

        function recordRecentAirTime(mediaId: number, episodeNumber: number, seconds: number) {
            const key = `${mediaId}-${episodeNumber}`
            if (recentAirTimes[key] === seconds) return
            recentAirTimes[key] = seconds
            recentAirTimesChanged = true
        }

        function pickSchedule(mediaId: number, schedules: LcSchedule[]): LcSchedule | null {
            if (!schedules.length) return null

            const overrideId = overrides[String(mediaId)]
            if (overrideId) {
                const chosen = schedules.find(s => s.databaseId === overrideId)
                if (chosen) return chosen
            }

            const jp = schedules.find(s => s.isJapan) || null
            if (globalMode === "japan") return jp || schedules[0]

            const nonJp = schedules.filter(s => !s.isJapan)
            const sub = nonJp.find(s => /sub/i.test(s.shortTitle) || /sub/i.test(s.title))
            return sub || nonJp[0] || jp || schedules[0]
        }

        function resolveNextEpisodeInfo(mediaId: number, anilistEpisodeNumber: number, rawSeconds: number | null, allowEarlierEpisodeOverride: boolean): { episode: number; seconds: number } | null {
            if (!mediaId || !anilistEpisodeNumber) return null

            const mappingEntry = mapping[String(mediaId)]
            const lcId = mappingEntry ? mappingEntry.id : null
            if (!lcId) return null

            const scheduleEntry = schedulesCache[lcId]
            const schedules = scheduleEntry ? scheduleEntry.schedules : null
            if (!schedules || !schedules.length) return null

            const chosen = pickSchedule(mediaId, schedules)
            if (!chosen) return null

            if (chosen.nextEpisodeDate != null && chosen.nextEpisodeNumber != null) {
                const matchesExactly = chosen.nextEpisodeNumber === anilistEpisodeNumber
                const isEarlierAndAllowed = allowEarlierEpisodeOverride && chosen.nextEpisodeNumber < anilistEpisodeNumber
                if (matchesExactly || isEarlierAndAllowed) {
                    const t = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(t)) return { episode: chosen.nextEpisodeNumber, seconds: Math.floor(t / 1000) }
                }
            }

            if (!chosen.isJapan && rawSeconds != null) {
                const jp = schedules.find(s => s.isJapan)
                if (jp && jp.nextEpisodeDate != null && chosen.nextEpisodeDate != null && jp.nextEpisodeNumber === chosen.nextEpisodeNumber) {
                    const jpMs = new Date(jp.nextEpisodeDate).getTime()
                    const chosenMs = new Date(chosen.nextEpisodeDate).getTime()
                    if (!isNaN(jpMs) && !isNaN(chosenMs)) {
                        return { episode: anilistEpisodeNumber, seconds: rawSeconds + Math.round((chosenMs - jpMs) / 1000) }
                    }
                }
            }

            return null
        }

        const nowSeconds = Math.floor(Date.now() / 1000)
        for (const episode of (e.upcomingEpisodes && e.upcomingEpisodes.episodes) || []) {
            if (!episode) continue
            try {
                const result = resolveNextEpisodeInfo(episode.mediaId, episode.episodeNumber, episode.airingAt, true)
                if (result != null) {
                    // episodeMetadata (title/image/summary) was fetched for the
                    // original episode number - stale metadata under a
                    // different number would be worse than none.
                    if (result.episode !== episode.episodeNumber) episode.episodeMetadata = undefined
                    episode.episodeNumber = result.episode
                    episode.airingAt = result.seconds
                    episode.timeUntilAiring = result.seconds - nowSeconds
                    recordRecentAirTime(episode.mediaId, result.episode, result.seconds)
                }
            } catch (err) {
                // keep this episode's original AniList-derived time
            }
        }
        if (recentAirTimesChanged) $storage.set(RECENT_AIR_KEY, recentAirTimes)
        e.next()
    })

    $app.onAnimeLibraryStreamCollection((e) => {
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const SUPPRESS_CONTINUE_WATCHING_KEY = "livechart.suppressContinueWatching"

        const suppressEnabled = $storage.get<boolean>(SUPPRESS_CONTINUE_WATCHING_KEY) !== false

        const list = e.streamCollection && e.streamCollection.continueWatchingList
        if (suppressEnabled && list && list.length) {
            const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
            const nowSeconds = Math.floor(Date.now() / 1000)

            e.streamCollection!.continueWatchingList = list.filter((episode) => {
                if (!episode || episode.isDownloaded) return true
                const mediaId = episode.baseAnime && episode.baseAnime.id
                if (!mediaId) return true

                const correctedAt = recentAirTimes[`${mediaId}-${episode.episodeNumber}`]
                if (correctedAt === undefined) return true

                return nowSeconds >= correctedAt
            })
        }

        e.next()
    })

    $ui.register((ctx) => {
        const GLOBAL_MODE_KEY = "livechart.globalMode"
        const MAPPING_KEY = "livechart.mapping"
        const SCHEDULES_KEY = "livechart.schedules"
        const OVERRIDE_KEY = "livechart.override"
        const RECENT_AIR_KEY = "livechart.recentAirTimes"
        const SUPPRESS_CONTINUE_WATCHING_KEY = "livechart.suppressContinueWatching"

        const MAPPING_TTL_HIT = 30 * 24 * 60 * 60 * 1000
        const MAPPING_TTL_MISS = 3 * 24 * 60 * 60 * 1000
        const SCHEDULES_TTL = 20 * 60 * 1000
        const WARM_TICK_MS = 1500
        const WARM_QUEUE_REBUILD_MS = 10 * 60 * 1000
        const WARM_REFRESH_THROTTLE_MS = 5000
        const DEFAULT_OVERRIDE_VALUE = "__use_global_default__"

        const LC_ENDPOINT = "https://www.livechart.me/graphql"

        const LC_HEADERS: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json",
            "Connection": "Keep-Alive",
            "User-Agent": "me.livechart.android/7.7.2 (Linux; Android 16 SDK 36; Google Pixel 8 Pro)",
        }

        const LC_SEARCH_QUERY = `query($term: String) {
            anime(term: $term, first: 5) {
                nodes { databaseId anilistUrl }
            }
        }`

        const LC_SCHEDULES_QUERY = `query($id: ID!) {
            singleAnime(id: $id) {
                releaseSchedules(first: 30) {
                    nodes {
                        databaseId
                        title
                        shortTitle
                        network { name }
                        tracks { languageCode shortLabel category }
                        releaseState {
                            releaseStatus
                            nextRelease { date numberRange { minNumber label } }
                        }
                    }
                }
            }
        }`

        function readMapping(): Record<string, { id: string | null; checkedAt: number }> {
            return $storage.get<Record<string, { id: string | null; checkedAt: number }>>(MAPPING_KEY) || {}
        }

        function writeMapping(m: Record<string, { id: string | null; checkedAt: number }>) {
            $storage.set(MAPPING_KEY, m)
        }

        function readSchedulesCache(): Record<string, { fetchedAt: number; schedules: LcSchedule[] }> {
            return $storage.get<Record<string, { fetchedAt: number; schedules: LcSchedule[] }>>(SCHEDULES_KEY) || {}
        }

        function writeSchedulesCache(c: Record<string, { fetchedAt: number; schedules: LcSchedule[] }>) {
            $storage.set(SCHEDULES_KEY, c)
        }

        function getOverrides(): Record<string, string> {
            return $storage.get<Record<string, string>>(OVERRIDE_KEY) || {}
        }

        function extractAnilistId(url: string): number | null {
            const m = /anilist\.co\/anime\/(\d+)/.exec(url)
            return m ? parseInt(m[1], 10) : null
        }

        function parseSchedules(nodes: any[]): LcSchedule[] {
            return (nodes || []).map((n: any): LcSchedule => ({
                databaseId: String(n.databaseId),
                title: n.title || n.shortTitle || "Schedule",
                shortTitle: n.shortTitle || n.title || "Schedule",
                isJapan: !n.network,
                networkName: (n.network && n.network.name) || null,
                tracks: Array.isArray(n.tracks) ? n.tracks.map((t: any): LcTrack => ({
                    languageCode: t.languageCode || "",
                    shortLabel: t.shortLabel || "",
                    category: t.category || "",
                })) : [],
                releaseStatus: (n.releaseState && n.releaseState.releaseStatus) || null,
                nextEpisodeNumber: (n.releaseState && n.releaseState.nextRelease && n.releaseState.nextRelease.numberRange && n.releaseState.nextRelease.numberRange.minNumber) ?? null,
                nextEpisodeDate: (n.releaseState && n.releaseState.nextRelease && n.releaseState.nextRelease.date) || null,
            }))
        }

        function pickSchedule(mediaId: number, schedules: LcSchedule[]): LcSchedule | null {
            if (!schedules.length) return null

            const overrideId = getOverrides()[String(mediaId)]
            if (overrideId) {
                const chosen = schedules.find(s => s.databaseId === overrideId)
                if (chosen) return chosen
            }

            const jp = schedules.find(s => s.isJapan) || null
            const mode = $storage.get<string>(GLOBAL_MODE_KEY) || "japan"
            if (mode === "japan") return jp || schedules[0]

            const nonJp = schedules.filter(s => !s.isJapan)
            const sub = nonJp.find(s => /sub/i.test(s.shortTitle) || /sub/i.test(s.title))
            return sub || nonJp[0] || jp || schedules[0]
        }

        function scheduleLabel(s: LcSchedule): string {
            if (s.isJapan) return "Japan Broadcast"
            const parts: string[] = []
            if (s.networkName) parts.push(s.networkName)
            parts.push(s.title || s.shortTitle || "Schedule")

            // Prefer the dub language(s) when present (that's the track that
            // actually matters for a dub schedule); otherwise fall back to the
            // subtitle languages, since those can also disambiguate schedules
            // that share the same network/title but serve different regions.
            const dubLangs = s.tracks.filter(t => t.category === "AURAL" && t.languageCode !== "ja").map(t => t.languageCode.toUpperCase())
            const subLangs = s.tracks.filter(t => t.category === "TEXTUAL").map(t => t.languageCode.toUpperCase())
            const langs = dubLangs.length ? dubLangs : subLangs
            if (langs.length === 1) {
                parts.push(`(${langs[0]})`)
            } else if (langs.length > 1) {
                parts.push(langs.length <= 3 ? `(${langs.join("/")})` : `(${langs.length} languages)`)
            }

            return parts.join(" - ")
        }

        function formatDateUTC(d: Date): string {
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            const hh = String(d.getUTCHours()).padStart(2, "0")
            const mm = String(d.getUTCMinutes()).padStart(2, "0")
            return `${months[d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm} UTC`
        }

        function scheduleStatusText(s: LcSchedule): string {
            if (s.nextEpisodeDate == null || s.nextEpisodeNumber == null) {
                return s.releaseStatus === "FINISHED" ? "Finished" : "No upcoming episode data"
            }
            const d = new Date(s.nextEpisodeDate)
            if (isNaN(d.getTime())) return "No upcoming episode data"
            return `EP${s.nextEpisodeNumber} · ${formatDateUTC(d)}`
        }

        async function lcQuery<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
            const res = await ctx.fetch(LC_ENDPOINT, {
                method: "POST",
                headers: LC_HEADERS,
                body: JSON.stringify({ query, variables }),
            })
            if (!res.ok) throw new Error(`LiveChart request failed (${res.status})`)
            const body = res.json<{ data?: T; errors?: { message: string }[] }>()
            if (body.errors && body.errors.length) throw new Error(body.errors[0].message || "LiveChart GraphQL error")
            if (!body.data) throw new Error("LiveChart: empty response")
            return body.data
        }

        async function discoverLcAnimeId(mediaId: number, forceRefresh: boolean): Promise<string | null> {
            const mapping = readMapping()
            const key = String(mediaId)
            const cached = mapping[key]
            const now = Date.now()
            if (!forceRefresh && cached) {
                const ttl = cached.id ? MAPPING_TTL_HIT : MAPPING_TTL_MISS
                if (now - cached.checkedAt < ttl) return cached.id
            }

            let found: string | null = null
            try {
                const anime = $anilist.getAnime(mediaId)
                const titles: string[] = []
                if (anime && anime.title && anime.title.romaji) titles.push(anime.title.romaji)
                if (anime && anime.title && anime.title.english && anime.title.english !== anime.title.romaji) titles.push(anime.title.english)

                for (const term of titles) {
                    const data = await lcQuery<{ anime?: { nodes?: { databaseId: string; anilistUrl?: string }[] } }>(LC_SEARCH_QUERY, { term })
                    const nodes = (data.anime && data.anime.nodes) || []
                    const match = nodes.find(n => !!n.anilistUrl && extractAnilistId(n.anilistUrl!) === mediaId)
                    if (match) {
                        found = String(match.databaseId)
                        break
                    }
                }
            } catch (err) {
                // leave found = null; the miss is cached below so we back off rather than retry every pass
            }

            mapping[key] = { id: found, checkedAt: now }
            writeMapping(mapping)
            return found
        }

        async function refreshLcSchedules(lcId: string, forceRefresh: boolean): Promise<LcSchedule[]> {
            const cacheAll = readSchedulesCache()
            const cached = cacheAll[lcId]
            const now = Date.now()
            if (!forceRefresh && cached && now - cached.fetchedAt < SCHEDULES_TTL) return cached.schedules

            try {
                const data = await lcQuery<{ singleAnime?: { releaseSchedules?: { nodes?: any[] } } }>(LC_SCHEDULES_QUERY, { id: lcId })
                const nodes = (data.singleAnime && data.singleAnime.releaseSchedules && data.singleAnime.releaseSchedules.nodes) || []
                const schedules = parseSchedules(nodes)
                cacheAll[lcId] = { fetchedAt: now, schedules }
                writeSchedulesCache(cacheAll)
                return schedules
            } catch (err) {
                if (cached) return cached.schedules
                return []
            }
        }

        function safeAnimeTitle(anime: $app.AL_BaseAnime | null | undefined): string {
            if (anime && anime.title && anime.title.userPreferred) return anime.title.userPreferred
            return ""
        }

        function refreshSchedule(includeUpcomingEpisodes: boolean = true) {
            ctx.anime.clearScheduleCache()
            $app.invalidateClientQuery([
                "ANIME-COLLECTION-get-anime-collection-schedule",
                "ANIME-COLLECTION-get-library-collection",
                "ANIME-ENTRIES-get-anime-entry",
                "ANIME-ENTRIES-get-upcoming-episodes",
            ])
            if (includeUpcomingEpisodes) $anilist.refreshAnimeCollection()
        }

        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Kaktusmann/seanime-extension/refs/heads/main/src/livechart-schedule/icon.ico",
            withContent: true,
            width: "320px",
        })

        const currentMediaTitle = ctx.state<string>("")
        const currentSchedules = ctx.state<LcSchedule[]>([])
        const scheduleOptions = ctx.state<{ label: string; value: string }[]>([])
        const loadError = ctx.state<string>("")
        const effectiveInfo = ctx.state<string>("")
        const loading = ctx.state<boolean>(false)
        const warmProgress = ctx.state<{ done: number; total: number }>({ done: 0, total: 0 })
        const warmError = ctx.state<string>("")

        const globalModeRef = ctx.fieldRef<string>($storage.get<string>(GLOBAL_MODE_KEY) || "japan")
        const mediaIdRef = ctx.fieldRef<string>("")
        const overrideRef = ctx.fieldRef<string>(DEFAULT_OVERRIDE_VALUE)
        const suppressContinueWatchingRef = ctx.fieldRef<boolean>($storage.get<boolean>(SUPPRESS_CONTINUE_WATCHING_KEY) !== false)

        function getEnteredMediaId(): number | null {
            const idStr = (mediaIdRef.current || "").trim()
            const id = parseInt(idStr, 10)
            if (!idStr || isNaN(id)) return null
            return id
        }

        function updateEffectiveInfo(mediaId: number, schedules: LcSchedule[]) {
            const chosen = pickSchedule(mediaId, schedules)
            effectiveInfo.set(chosen ? `${scheduleLabel(chosen)} · ${scheduleStatusText(chosen)}` : "No data available")
        }

        async function loadAnimeSchedules(mediaId: number, forceRefresh: boolean) {
            loadError.set("")
            loading.set(true)
            try {
                const lcId = await discoverLcAnimeId(mediaId, forceRefresh)
                if (!lcId) {
                    scheduleOptions.set([])
                    currentSchedules.set([])
                    effectiveInfo.set("")
                    loadError.set("No LiveChart entry found for this anime")
                    return
                }
                const schedules = await refreshLcSchedules(lcId, forceRefresh)
                if (!schedules.length) {
                    scheduleOptions.set([])
                    currentSchedules.set([])
                    effectiveInfo.set("")
                    loadError.set("LiveChart has no release schedules for this anime")
                    return
                }
                currentSchedules.set(schedules)
                scheduleOptions.set(schedules.map(s => ({ label: scheduleLabel(s), value: s.databaseId })))
                overrideRef.setValue(getOverrides()[String(mediaId)] || DEFAULT_OVERRIDE_VALUE)
                updateEffectiveInfo(mediaId, schedules)
                refreshSchedule()
            } catch (err: any) {
                scheduleOptions.set([])
                currentSchedules.set([])
                effectiveInfo.set("")
                loadError.set("Failed to load LiveChart data: " + (err && err.message ? err.message : String(err)))
            } finally {
                loading.set(false)
            }
        }

        function loadMediaIntoForm(id: number, title: string) {
            currentMediaTitle.set(title)
            if (id) {
                mediaIdRef.setValue(String(id))
                loadAnimeSchedules(id, false)
            }
        }

        globalModeRef.onValueChange((v) => {
            $storage.set(GLOBAL_MODE_KEY, v)
            refreshSchedule()
            const id = getEnteredMediaId()
            if (id) updateEffectiveInfo(id, currentSchedules.get())
            ctx.toast.success(`Global schedule preference set to ${v === "japan" ? "Japan Broadcast" : "Simulcast"}`)
        })

        suppressContinueWatchingRef.onValueChange((v) => {
            $storage.set(SUPPRESS_CONTINUE_WATCHING_KEY, v)
            refreshSchedule()
            ctx.toast.success(v ? "Continue Watching will wait for the real release" : "Continue Watching suppression disabled")
        })

        overrideRef.onValueChange((v) => {
            const id = getEnteredMediaId()
            if (!id) {
                ctx.toast.error("Enter a valid media ID, or open the anime's page to autofill it.")
                return
            }
            const isDefault = !v || v === DEFAULT_OVERRIDE_VALUE
            const overrides = getOverrides()
            if (isDefault) delete overrides[String(id)]
            else overrides[String(id)] = v
            $storage.set(OVERRIDE_KEY, overrides)
            refreshSchedule()
            updateEffectiveInfo(id, currentSchedules.get())
            ctx.toast.success(isDefault ? "Reverted to global default" : "Schedule override saved")
        })

        ctx.registerEventHandler("load-lc-for-id", () => {
            const id = getEnteredMediaId()
            if (!id) {
                ctx.toast.error("Enter a valid media ID, or open the anime's page to autofill it.")
                return
            }
            loadAnimeSchedules(id, false)
        })

        ctx.registerEventHandler("refresh-lc-lookup", () => {
            const id = getEnteredMediaId()
            if (!id) {
                ctx.toast.error("Enter a valid media ID, or open the anime's page to autofill it.")
                return
            }
            loadAnimeSchedules(id, true)
        })

        ctx.registerEventHandler("clear-lc-cache", () => {
            $storage.remove(MAPPING_KEY)
            $storage.remove(SCHEDULES_KEY)
            $storage.remove(RECENT_AIR_KEY)
            refreshSchedule()
            ctx.toast.success("Cleared LiveChart cache")
            const id = getEnteredMediaId()
            if (id) loadAnimeSchedules(id, true)
        })

        ctx.screen.loadCurrent()
        ctx.screen.onNavigate((e) => {
            if (e.pathname === "/entry" && !!e.searchParams.id) {
                const id = parseInt(e.searchParams.id)
                let title = ""
                try {
                    title = safeAnimeTitle($anilist.getAnime(id))
                } catch (err) {
                }
                loadMediaIntoForm(id, title)
            } else {
                currentMediaTitle.set("")
                currentSchedules.set([])
                scheduleOptions.set([])
                loadError.set("")
                effectiveInfo.set("")
            }
        })

        tray.render(() => {
            const items: any[] = [
                tray.text("LiveChart Schedule", { style: { fontWeight: "600", fontSize: "16px" } }),

                tray.text("Global preference", { style: { fontWeight: "600" } }),
                tray.select({
                    label: "",
                    options: [
                        { label: "Japan Broadcast", value: "japan" },
                        { label: "Simulcast", value: "simulcast" },
                    ],
                    fieldRef: globalModeRef,
                }),
                tray.text(
                    "Simulcast picks the subbed release automatically.",
                    { style: { fontSize: "11px", opacity: "0.7" } },
                ),
                tray.switch({
                    label: "Hide unreleased episodes from Continue Watching",
                    side: "left",
                    fieldRef: suppressContinueWatchingRef,
                }),
            ]

            const progress = warmProgress.get()
            if (progress.total > 0 && progress.done < progress.total) {
                items.push(tray.text(
                    `Caching schedules in the background: ${progress.done}/${progress.total}`,
                    { style: { fontSize: "11px", opacity: "0.7" } },
                ))
            }
            const wErr = warmError.get()
            if (wErr) {
                items.push(tray.text(wErr, { style: { fontSize: "11px", opacity: "0.7" } }))
            }

            items.push(
                tray.text("Per-anime override", { style: { fontWeight: "600", marginTop: "8px" } }),
                tray.text(
                    currentMediaTitle.get() ? `Viewing: ${currentMediaTitle.get()}` : "Open an anime page to autofill its media ID",
                    { style: { fontSize: "12px", opacity: "0.7" } },
                ),
                tray.input({ placeholder: "Media ID", fieldRef: mediaIdRef }),
            )

            const err = loadError.get()
            const options = scheduleOptions.get()
            if (loading.get()) {
                items.push(tray.text("Loading LiveChart schedules…", { style: { fontSize: "12px", opacity: "0.7" } }))
            } else if (err) {
                items.push(tray.text(err, { style: { fontSize: "12px", opacity: "0.7" } }))
            } else if (!options.length) {
                items.push(tray.text("Enter a media ID and press Load to fetch its schedules", { style: { fontSize: "12px", opacity: "0.7" } }))
            } else {
                items.push(tray.select({
                    label: "",
                    placeholder: "Use global default",
                    options: [{ label: "Use global default", value: DEFAULT_OVERRIDE_VALUE }, ...options],
                    fieldRef: overrideRef,
                }))
                items.push(tray.text(`Now using: ${effectiveInfo.get()}`, { style: { fontSize: "11px", opacity: "0.7" } }))
            }

            items.push(
                tray.flex({
                    gap: 2,
                    items: [
                        tray.button({ label: "Load", size: "xs", intent: "primary", onClick: "load-lc-for-id" }),
                        tray.button({ label: "Refresh", size: "xs", intent: "gray-subtle", onClick: "refresh-lc-lookup" }),
                        tray.button({ label: "Clear cached matches", size: "xs", intent: "alert-subtle", onClick: "clear-lc-cache" }),
                    ],
                }),
            )

            return tray.stack({ gap: 3, items })
        })

        const scheduleDropdownItem = ctx.action.newAnimePageDropdownItem({ label: "LiveChart Schedule" })
        scheduleDropdownItem.mount()
        scheduleDropdownItem.onClick((event) => {
            loadMediaIntoForm(event.media.id, safeAnimeTitle(event.media))
            tray.open()
        })

        let warmQueue: number[] = []
        let warmQueueTotal = 0
        let warmQueueBuiltAt = 0
        let lastWarmRefreshAt = 0

        async function warmNext() {
            const now = Date.now()
            if (warmQueue.length === 0 && now - warmQueueBuiltAt > WARM_QUEUE_REBUILD_MS) {
                try {
                    const collection = $anilist.getAnimeCollection(false)
                    const lists = collection && collection.MediaListCollection && collection.MediaListCollection.lists
                    const ids: number[] = []
                    if (lists) {
                        for (const list of lists) {
                            if (!list || !list.entries) continue
                            const listStatus = list.status ? String(list.status) : ""
                            const listInScope = listStatus === "CURRENT" || listStatus === "PLANNING"
                            for (const entry of list.entries) {
                                const media = entry && entry.media
                                const entryStatus = entry && entry.status ? String(entry.status) : ""
                                const inScope = entryStatus ? (entryStatus === "CURRENT" || entryStatus === "PLANNING") : listInScope
                                const mediaStatus = media && media.status ? String(media.status) : ""
                                const isAiring = mediaStatus === "RELEASING"
                                if (media && inScope && isAiring) ids.push(media.id)
                            }
                        }
                    }
                    warmQueue = ids
                    warmQueueTotal = ids.length
                    warmQueueBuiltAt = now
                    warmProgress.set({ done: 0, total: warmQueueTotal })
                    warmError.set(lists ? (ids.length === 0 ? "No currently airing anime in your Watching/Planning lists" : "") : "Could not read your AniList collection yet")
                } catch (err: any) {
                    warmQueueBuiltAt = now
                    warmError.set("Failed to read AniList collection: " + (err && err.message ? err.message : String(err)))
                    return
                }
            }

            const mediaId = warmQueue.shift()
            if (mediaId == null) return

            warmProgress.set({ done: warmQueueTotal - warmQueue.length, total: warmQueueTotal })

            try {
                const lcId = await discoverLcAnimeId(mediaId, false)
                if (lcId) {
                    await refreshLcSchedules(lcId, false)
                    const t = Date.now()
                    const queueDrained = warmQueue.length === 0
                    if (queueDrained || t - lastWarmRefreshAt > WARM_REFRESH_THROTTLE_MS) {
                        lastWarmRefreshAt = t
                        refreshSchedule(queueDrained)
                    }
                }
            } catch (err) {
                // this anime's slot failed - it'll be retried once the queue rebuilds
            }
        }

        warmNext()
        ctx.setInterval(() => {
            warmNext()
        }, WARM_TICK_MS)
    })
}
