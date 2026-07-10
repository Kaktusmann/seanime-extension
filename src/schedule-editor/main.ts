/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
    $app.onAnimeScheduleItems((e) => {
        const GLOBAL_OFFSET_KEY = "scheduleOffsets.global"
        const ANIME_OFFSETS_KEY = "scheduleOffsets.anime"

        function parseOffset(raw: string | undefined): number {
            if (!raw) return 0
            const str = raw.trim().toLowerCase()
            if (str === "") return 0

            let sign = 1
            let rest = str
            if (rest[0] === "+") {
                rest = rest.slice(1)
            } else if (rest[0] === "-") {
                sign = -1
                rest = rest.slice(1)
            }
            if (rest === "") return NaN

            if (/^\d+(\.\d+)?$/.test(rest)) {
                return sign * parseFloat(rest)
            }

            const re = /(\d+(?:\.\d+)?)\s*(h|m)/g
            let match: RegExpExecArray | null
            let total = 0
            let consumed = ""
            while ((match = re.exec(rest)) !== null) {
                consumed += match[0]
                const value = parseFloat(match[1])
                total += match[2] === "h" ? value * 60 : value
            }
            if (consumed === "" || consumed.replace(/\s/g, "") !== rest.replace(/\s/g, "")) return NaN

            return sign * total
        }

        function getOffsetMinutesForMedia(mediaId: number): number {
            const global = parseOffset($storage.get<string>(GLOBAL_OFFSET_KEY) || "")
            const animeOffsets = $storage.get<Record<string, string>>(ANIME_OFFSETS_KEY) || {}
            const specific = parseOffset(animeOffsets[String(mediaId)])
            return (isNaN(global) ? 0 : global) + (isNaN(specific) ? 0 : specific)
        }

        function applyOffsetToItem(item: $app.Anime_ScheduleItem, minutes: number) {
            if (!minutes) return

            if (item.dateTime) {
                const d = new Date(item.dateTime)
                if (!isNaN(d.getTime())) {
                    d.setUTCMinutes(d.getUTCMinutes() + minutes)
                    item.dateTime = d.toISOString()
                    item.time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
                    return
                }
            }

            if (item.time) {
                const [h, m] = item.time.split(":").map(Number)
                if (!isNaN(h) && !isNaN(m)) {
                    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
                    item.time = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
                }
            }
        }

        for (const item of e.items || []) {
            applyOffsetToItem(item, getOffsetMinutesForMedia(item.mediaId))
        }
        e.next()
    })

    function mutateAnimeCollectionEvent(e: { next(): void; animeCollection?: $app.AL_AnimeCollection }) {
        const GLOBAL_OFFSET_KEY = "scheduleOffsets.global"
        const ANIME_OFFSETS_KEY = "scheduleOffsets.anime"
        const LAST_SEEN_KEY = "scheduleOffsets.lastSeenNextAiring"
        const RECENT_AIR_KEY = "scheduleOffsets.recentAirTimes"

        function parseOffset(raw: string | undefined): number {
            if (!raw) return 0
            const str = raw.trim().toLowerCase()
            if (str === "") return 0

            let sign = 1
            let rest = str
            if (rest[0] === "+") {
                rest = rest.slice(1)
            } else if (rest[0] === "-") {
                sign = -1
                rest = rest.slice(1)
            }
            if (rest === "") return NaN

            if (/^\d+(\.\d+)?$/.test(rest)) {
                return sign * parseFloat(rest)
            }

            const re = /(\d+(?:\.\d+)?)\s*(h|m)/g
            let match: RegExpExecArray | null
            let total = 0
            let consumed = ""
            while ((match = re.exec(rest)) !== null) {
                consumed += match[0]
                const value = parseFloat(match[1])
                total += match[2] === "h" ? value * 60 : value
            }
            if (consumed === "" || consumed.replace(/\s/g, "") !== rest.replace(/\s/g, "")) return NaN

            return sign * total
        }

        function getOffsetMinutesForMedia(mediaId: number): number {
            const global = parseOffset($storage.get<string>(GLOBAL_OFFSET_KEY) || "")
            const animeOffsets = $storage.get<Record<string, string>>(ANIME_OFFSETS_KEY) || {}
            const specific = parseOffset(animeOffsets[String(mediaId)])
            return (isNaN(global) ? 0 : global) + (isNaN(specific) ? 0 : specific)
        }

        const lists = e.animeCollection && e.animeCollection.MediaListCollection && e.animeCollection.MediaListCollection.lists
        if (lists) {
            const lastSeen = $storage.get<Record<string, { episode: number; airingAt: number }>>(LAST_SEEN_KEY) || {}
            const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
            let lastSeenChanged = false
            let recentAirChanged = false

            for (const list of lists) {
                if (!list || !list.entries) continue
                for (const entry of list.entries) {
                    const media = entry && entry.media
                    if (!media || !media.nextAiringEpisode) continue

                    const mediaIdStr = String(media.id)
                    const rawEpisode = media.nextAiringEpisode.episode
                    const rawAiringAt = media.nextAiringEpisode.airingAt

                    const prev = lastSeen[mediaIdStr]
                    if (prev && prev.episode < rawEpisode) {
                        recentAirTimes[`${mediaIdStr}-${prev.episode}`] = prev.airingAt
                        recentAirChanged = true
                    }
                    if (!prev || prev.episode !== rawEpisode || prev.airingAt !== rawAiringAt) {
                        lastSeen[mediaIdStr] = { episode: rawEpisode, airingAt: rawAiringAt }
                        lastSeenChanged = true
                    }

                    const minutes = getOffsetMinutesForMedia(media.id)
                    if (minutes) {
                        const deltaSeconds = minutes * 60
                        media.nextAiringEpisode.airingAt = rawAiringAt + deltaSeconds
                        media.nextAiringEpisode.timeUntilAiring += deltaSeconds
                    }
                }
            }

            if (lastSeenChanged) $storage.set(LAST_SEEN_KEY, lastSeen)
            if (recentAirChanged) $storage.set(RECENT_AIR_KEY, recentAirTimes)
        }

        e.next()
    }

    $app.onGetAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetRawAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetCachedAnimeCollection(mutateAnimeCollectionEvent)
    $app.onGetCachedRawAnimeCollection(mutateAnimeCollectionEvent)

    $app.onAnimeLibraryStreamCollection((e) => {
        const GLOBAL_OFFSET_KEY = "scheduleOffsets.global"
        const ANIME_OFFSETS_KEY = "scheduleOffsets.anime"
        const RECENT_AIR_KEY = "scheduleOffsets.recentAirTimes"

        function parseOffset(raw: string | undefined): number {
            if (!raw) return 0
            const str = raw.trim().toLowerCase()
            if (str === "") return 0

            let sign = 1
            let rest = str
            if (rest[0] === "+") {
                rest = rest.slice(1)
            } else if (rest[0] === "-") {
                sign = -1
                rest = rest.slice(1)
            }
            if (rest === "") return NaN

            if (/^\d+(\.\d+)?$/.test(rest)) {
                return sign * parseFloat(rest)
            }

            const re = /(\d+(?:\.\d+)?)\s*(h|m)/g
            let match: RegExpExecArray | null
            let total = 0
            let consumed = ""
            while ((match = re.exec(rest)) !== null) {
                consumed += match[0]
                const value = parseFloat(match[1])
                total += match[2] === "h" ? value * 60 : value
            }
            if (consumed === "" || consumed.replace(/\s/g, "") !== rest.replace(/\s/g, "")) return NaN

            return sign * total
        }

        function getOffsetMinutesForMedia(mediaId: number): number {
            const global = parseOffset($storage.get<string>(GLOBAL_OFFSET_KEY) || "")
            const animeOffsets = $storage.get<Record<string, string>>(ANIME_OFFSETS_KEY) || {}
            const specific = parseOffset(animeOffsets[String(mediaId)])
            return (isNaN(global) ? 0 : global) + (isNaN(specific) ? 0 : specific)
        }

        const list = e.streamCollection && e.streamCollection.continueWatchingList
        if (list && list.length) {
            const recentAirTimes = $storage.get<Record<string, number>>(RECENT_AIR_KEY) || {}
            const nowSeconds = Math.floor(Date.now() / 1000)

            e.streamCollection!.continueWatchingList = list.filter((episode) => {
                if (!episode || episode.isDownloaded) return true
                const mediaId = episode.baseAnime && episode.baseAnime.id
                if (!mediaId) return true

                const airedAt = recentAirTimes[`${mediaId}-${episode.episodeNumber}`]
                if (airedAt === undefined) return true

                const minutes = getOffsetMinutesForMedia(mediaId)
                if (!minutes || minutes <= 0) return true

                return nowSeconds >= airedAt + minutes * 60
            })
        }

        e.next()
    })

    $ui.register((ctx) => {
        const GLOBAL_OFFSET_KEY = "scheduleOffsets.global"
        const ANIME_OFFSETS_KEY = "scheduleOffsets.anime"

        function parseOffset(raw: string | undefined): number {
            if (!raw) return 0
            const str = raw.trim().toLowerCase()
            if (str === "") return 0

            let sign = 1
            let rest = str
            if (rest[0] === "+") {
                rest = rest.slice(1)
            } else if (rest[0] === "-") {
                sign = -1
                rest = rest.slice(1)
            }
            if (rest === "") return NaN

            if (/^\d+(\.\d+)?$/.test(rest)) {
                return sign * parseFloat(rest)
            }

            const re = /(\d+(?:\.\d+)?)\s*(h|m)/g
            let match: RegExpExecArray | null
            let total = 0
            let consumed = ""
            while ((match = re.exec(rest)) !== null) {
                consumed += match[0]
                const value = parseFloat(match[1])
                total += match[2] === "h" ? value * 60 : value
            }
            if (consumed === "" || consumed.replace(/\s/g, "") !== rest.replace(/\s/g, "")) return NaN

            return sign * total
        }

        function safeAnimeTitle(anime: $app.AL_BaseAnime | null | undefined): string {
            if (anime && anime.title && anime.title.userPreferred) return anime.title.userPreferred
            return ""
        }

        function getGlobalOffsetRaw(): string {
            return $storage.get<string>(GLOBAL_OFFSET_KEY) || ""
        }

        function getAnimeOffsets(): Record<string, string> {
            return $storage.get<Record<string, string>>(ANIME_OFFSETS_KEY) || {}
        }

        function refreshSchedule() {
            ctx.anime.clearScheduleCache()
            $app.invalidateClientQuery(["ANIME-COLLECTION-get-anime-collection-schedule", "ANIME-COLLECTION-get-library-collection"])
        }

        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Kaktusmann/seanime-extension/refs/heads/main/src/schedule-editor/icon.ico",
            withContent: true,
            width: "320px",
        })

        const currentMediaId = ctx.state<number>(0)
        const currentMediaTitle = ctx.state<string>("")
        const animeOffsets = ctx.state<Record<string, string>>(getAnimeOffsets())

        const globalOffsetRef = ctx.fieldRef<string>(getGlobalOffsetRaw())
        const mediaIdRef = ctx.fieldRef<string>("")
        const mediaOffsetRef = ctx.fieldRef<string>("")

        function loadMediaIntoForm(id: number, title: string) {
            currentMediaId.set(id)
            currentMediaTitle.set(title)
            if (id) {
                mediaIdRef.setValue(String(id))
                mediaOffsetRef.setValue(animeOffsets.get()[String(id)] || "")
            }
        }

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
                currentMediaId.set(0)
                currentMediaTitle.set("")
            }
        })

        function titleForMediaId(id: string): string {
            try {
                return safeAnimeTitle($anilist.getAnime(parseInt(id, 10))) || `Media ${id}`
            } catch (err) {
                return `Media ${id}`
            }
        }

        function formatOffsetMinutes(total: number): string {
            if (!total) return ""
            const sign = total < 0 ? "-" : "+"
            const abs = Math.abs(total)
            const h = Math.floor(abs / 60)
            const m = abs % 60
            let out = sign
            if (h > 0) out += `${h}h`
            if (m > 0) out += `${m}m`
            return out
        }

        function setGlobalOffset(value: string) {
            const trimmed = value.trim()
            const minutes = parseOffset(trimmed)
            if (isNaN(minutes)) {
                ctx.toast.error(`Invalid offset "${trimmed}". Use formats like +1h, -30m, 1h30m.`)
                return
            }
            $storage.set(GLOBAL_OFFSET_KEY, trimmed)
            globalOffsetRef.setValue(trimmed)
            refreshSchedule()
            ctx.toast.success(`Global schedule offset set to ${trimmed || "0m"}`)
        }

        function adjustGlobalOffset(deltaMinutes: number) {
            const current = parseOffset(getGlobalOffsetRaw())
            const total = (isNaN(current) ? 0 : current) + deltaMinutes
            setGlobalOffset(formatOffsetMinutes(total))
        }

        ctx.registerEventHandler("save-global-offset", () => setGlobalOffset(globalOffsetRef.current))
        ctx.registerEventHandler("clear-global-offset", () => {
            $storage.remove(GLOBAL_OFFSET_KEY)
            globalOffsetRef.setValue("")
            refreshSchedule()
            ctx.toast.success("Global schedule offset cleared")
        })
        const presetDeltas: Record<string, number> = { "-1h": -60, "-30m": -30, "+30m": 30, "+1h": 60 }
        for (const preset of Object.keys(presetDeltas)) {
            const delta = presetDeltas[preset]
            ctx.registerEventHandler(`preset-global-${preset}`, () => adjustGlobalOffset(delta))
        }

        function saveAnimeOffset(id: number, value: string) {
            const offsets = getAnimeOffsets()
            if (value === "") {
                delete offsets[String(id)]
            } else {
                offsets[String(id)] = value
            }
            $storage.set(ANIME_OFFSETS_KEY, offsets)
            animeOffsets.set({ ...offsets })
            mediaOffsetRef.setValue(value)
            refreshSchedule()
            ctx.toast.success(value === "" ? `Removed schedule offset for media ${id}` : `Schedule offset for media ${id} saved`)
        }

        ctx.registerEventHandler("save-anime-offset", () => {
            const idStr = (mediaIdRef.current || "").trim()
            const id = parseInt(idStr, 10)
            if (!idStr || isNaN(id)) {
                ctx.toast.error("Enter a valid media ID, or open the anime's page to autofill it.")
                return
            }

            const value = (mediaOffsetRef.current || "").trim()
            if (value !== "" && isNaN(parseOffset(value))) {
                ctx.toast.error(`Invalid offset "${value}". Use formats like +1h, -30m, 1h30m.`)
                return
            }

            saveAnimeOffset(id, value)
        })

        function adjustAnimeOffset(deltaMinutes: number) {
            const idStr = (mediaIdRef.current || "").trim()
            const id = parseInt(idStr, 10)
            if (!idStr || isNaN(id)) {
                ctx.toast.error("Enter a valid media ID, or open the anime's page to autofill it.")
                return
            }

            const offsets = getAnimeOffsets()
            const current = parseOffset(offsets[String(id)])
            const total = (isNaN(current) ? 0 : current) + deltaMinutes
            saveAnimeOffset(id, formatOffsetMinutes(total))
        }

        const animePresetDeltas: Record<string, number> = { "-1h": -60, "-30m": -30, "+30m": 30, "+1h": 60 }
        for (const preset of Object.keys(animePresetDeltas)) {
            const delta = animePresetDeltas[preset]
            ctx.registerEventHandler(`preset-anime-${preset}`, () => adjustAnimeOffset(delta))
        }

        function removeAnimeOffset(id: string) {
            const offsets = getAnimeOffsets()
            delete offsets[id]
            $storage.set(ANIME_OFFSETS_KEY, offsets)
            animeOffsets.set({ ...offsets })
            if (String(currentMediaId.get()) === id) mediaOffsetRef.setValue("")
            refreshSchedule()
            ctx.toast.success(`Removed schedule offset for media ${id}`)
        }

        ctx.registerEventHandler("cleanup-stale-offsets", () => {
            const offsets = getAnimeOffsets()
            let removed = 0
            for (const id of Object.keys(offsets)) {
                let stillAiring = false
                try {
                    const anime = $anilist.getAnime(parseInt(id, 10))
                    // anime.status crosses the Go/JS boundary as a wrapped value, not a
                    // plain string primitive, so a strict === against a literal never matches.
                    stillAiring = !!anime && String(anime.status || "") === "RELEASING"
                } catch (err) {
                }
                if (!stillAiring) {
                    delete offsets[id]
                    removed++
                }
            }
            if (removed > 0) {
                $storage.set(ANIME_OFFSETS_KEY, offsets)
                animeOffsets.set({ ...offsets })
                refreshSchedule()
            }
            ctx.toast.success(removed > 0 ? `Removed ${removed} offset(s) for shows no longer airing` : "No stale offsets found")
        })

        tray.render(() => {
            const offsets = animeOffsets.get()
            const ids = Object.keys(offsets)

            const items: any[] = [
                tray.text("Schedule Offsets", { style: { fontWeight: "600", fontSize: "16px" } }),

                tray.text("Global offset", { style: { fontWeight: "600" } }),
                tray.input({ placeholder: "e.g. +1h, -30m, 1h30m", fieldRef: globalOffsetRef }),
                tray.flex({
                    gap: 2,
                    items: [
                        tray.button({ label: "-1h", size: "xs", onClick: "preset-global--1h" }),
                        tray.button({ label: "-30m", size: "xs", onClick: "preset-global--30m" }),
                        tray.button({ label: "+30m", size: "xs", onClick: "preset-global-+30m" }),
                        tray.button({ label: "+1h", size: "xs", onClick: "preset-global-+1h" }),
                    ],
                }),
                tray.flex({
                    gap: 2,
                    items: [
                        tray.button({ label: "Save", size: "sm", intent: "primary", onClick: "save-global-offset" }),
                        tray.button({ label: "Clear", size: "sm", intent: "gray-subtle", onClick: "clear-global-offset" }),
                    ],
                }),

                tray.text("Per-anime override", { style: { fontWeight: "600", marginTop: "8px" } }),
                tray.text(
                    currentMediaTitle.get() ? `Viewing: ${currentMediaTitle.get()}` : "Open an anime page to autofill its media ID",
                    { style: { fontSize: "12px", opacity: "0.7" } },
                ),
                tray.input({ placeholder: "Media ID", fieldRef: mediaIdRef }),
                tray.input({ placeholder: "e.g. +1h, -30m, 1h30m (blank removes)", fieldRef: mediaOffsetRef }),
                tray.flex({
                    gap: 2,
                    items: [
                        tray.button({ label: "-1h", size: "xs", onClick: "preset-anime--1h" }),
                        tray.button({ label: "-30m", size: "xs", onClick: "preset-anime--30m" }),
                        tray.button({ label: "+30m", size: "xs", onClick: "preset-anime-+30m" }),
                        tray.button({ label: "+1h", size: "xs", onClick: "preset-anime-+1h" }),
                    ],
                }),
                tray.button({ label: "Save override", size: "sm", intent: "primary", onClick: "save-anime-offset" }),
            ]

            if (ids.length > 0) {
                items.push(
                    tray.flex({
                        style: { justifyContent: "space-between", alignItems: "center" },
                        items: [
                            tray.text(`${ids.length} override(s)`, { style: { fontSize: "12px", opacity: "0.7" } }),
                            tray.button({ label: "Remove finished shows", size: "xs", intent: "gray-subtle", onClick: "cleanup-stale-offsets" }),
                        ],
                    }),
                    tray.stack({
                        gap: 1,
                        items: ids.map((id) =>
                            tray.flex({
                                gap: 2,
                                style: { justifyContent: "space-between", alignItems: "center" },
                                items: [
                                    tray.text(`${titleForMediaId(id)}: ${offsets[id]}`, { style: { fontSize: "12px" } }),
                                    tray.button({
                                        label: "Remove",
                                        size: "xs",
                                        intent: "alert-subtle",
                                        onClick: ctx.eventHandler(`remove-anime-offset-${id}`, () => removeAnimeOffset(id)),
                                    }),
                                ],
                            }),
                        ),
                    }),
                )
            } else {
                items.push(tray.text("No per-anime overrides yet", { style: { fontSize: "12px", opacity: "0.6" } }))
            }

            return tray.stack({ gap: 3, items })
        })

        const offsetDropdownItem = ctx.action.newAnimePageDropdownItem({ label: "Set Schedule Offset" })
        offsetDropdownItem.mount()
        offsetDropdownItem.onClick((event) => {
            loadMediaIntoForm(event.media.id, safeAnimeTitle(event.media))
            tray.open()
        })
    })
}
