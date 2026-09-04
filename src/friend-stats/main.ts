/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type MediaType = "anime" | "manga"

interface FriendListEntry {
    status: $app.AL_MediaListStatus
    score: number
    progress: number
    media: { episodes?: number, chapters?: number }
    user: {
        name: string
        avatar?: { large?: string }
    }
}

const CACHE_TTL_MS = 5 * 60 * 1000

function init() {
    $ui.register((ctx) => {
        const mediaId = ctx.state(0)
        const mediaType = ctx.state<MediaType | null>(null)
        const friends = ctx.state<FriendListEntry[]>([])

        const animePanel = ctx.newWebview({
            slot: "after-anime-entry-episode-list",
            fullWidth: true,
            autoHeight: true,
        })

        const mangaPanel = ctx.newWebview({
            slot: "after-manga-entry-chapter-list",
            fullWidth: true,
            autoHeight: true,
        })

        // Both panels share the same state and content - only the slot differs.
        animePanel.channel.sync("friends", friends)
        animePanel.channel.sync("mediaType", mediaType)
        mangaPanel.channel.sync("friends", friends)
        mangaPanel.channel.sync("mediaType", mediaType)

        const openUrlRequest = ctx.state({ url: "", nonce: 0 })

        animePanel.channel.on("open-profile", (url: string) => {
            openUrlRequest.set(prev => ({ url, nonce: prev.nonce + 1 }))
        })
        mangaPanel.channel.on("open-profile", (url: string) => {
            openUrlRequest.set(prev => ({ url, nonce: prev.nonce + 1 }))
        })

        ctx.effect(() => {
            const { url } = openUrlRequest.get()
            if (!url) return

            try {
                if ($os.platform === "windows") {
                    $os.cmd("cmd", "/c", "start", url).start()
                } else if ($os.platform === "darwin") {
                    $os.cmd("open", url).start()
                } else {
                    $os.cmd("xdg-open", url).start()
                }
            } catch (err) {
                console.error("friend-stats: failed to open profile url", err)
            }
        }, [openUrlRequest])

        ctx.screen.onNavigate((e) => {
            if (e.pathname === "/entry" && !!e.searchParams.id) {
                mediaType.set("anime")
                mediaId.set(parseInt(e.searchParams.id))
            } else if (e.pathname.startsWith("/manga/entry") && !!e.searchParams.id) {
                mediaType.set("manga")
                mediaId.set(parseInt(e.searchParams.id))
            } else {
                mediaType.set(null)
                mediaId.set(0)
            }
        })
        ctx.screen.loadCurrent()

        ctx.effect(() => {
            const id = mediaId.get()
            const type = mediaType.get()
            if (!id || !type) {
                friends.set([])
                animePanel.hide()
                mangaPanel.hide()
                return
            }

            const panel = type === "anime" ? animePanel : mangaPanel

            const entries = ctx.cache.getOrSet(`friends-${id}`, () => {
                const token = $database.anilist.getToken()
                if (!token) return []

                const query = `
                    query ($mediaId: Int) {
                        Page(perPage: 50) {
                            mediaList(mediaId: $mediaId, isFollowing: true, sort: UPDATED_TIME_DESC) {
                                status
                                score(format: POINT_100)
                                progress
                                media {
                                    episodes
                                    chapters
                                }
                                user {
                                    name
                                    avatar {
                                        large
                                    }
                                }
                            }
                        }
                    }
                `

                try {
                    const res = $anilist.customQuery<{ Page: { mediaList: FriendListEntry[] } }>(
                        { query, variables: { mediaId: id } },
                        token,
                    )
                    return res?.Page?.mediaList ?? []
                } catch (err) {
                    console.error("friend-stats: failed to fetch following list", err)
                    return []
                }
            }, CACHE_TTL_MS) as FriendListEntry[]
            friends.set(entries)
            if (entries.length > 0) {
                panel.show()
            } else {
                panel.hide()
            }
        }, [mediaId, mediaType])

        const panelContent = () => `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    html { color-scheme: dark; overflow: hidden; }
    body { background: transparent; color: #e2e8f0; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 0; }
    .heading { font-size: 1.4rem; font-weight: 600; margin: 0 0 15px; opacity: 0.85; }
    .list { display: flex; flex-wrap: wrap; gap: 9px; }
    .row { display: flex; align-items: center; gap: 12px; padding: 9px 15px; background: rgba(255,255,255,0.04); border-radius: 12px; text-decoration: none; color: inherit; }
    .row:hover { background: rgba(255,255,255,0.08); }
    .avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: rgba(255,255,255,0.08); }
    .name { font-size: 1.3rem; max-width: 270px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .episode { font-size: 1.2rem; opacity: 0.8; }
    .score { font-size: 1.2rem; font-weight: 600; }
    .status { font-size: 1.1rem; font-weight: 600; padding: 3px 12px; border-radius: 999px; color: #10161f; }
</style>
</head>
<body>
<div id="app"></div>
<script>
    var STATUS_LABEL = {"CURRENT":{"anime":"Watching","manga":"Reading"},"PLANNING":"Planning","COMPLETED":"Completed","DROPPED":"Dropped","PAUSED":"Paused","REPEATING":{"anime":"Rewatching","manga":"Rereading"}}
    var STATUS_COLOR = {"CURRENT":"#3db4f2","PLANNING":"#f2c94c","COMPLETED":"#4cd137","DROPPED":"#e84118","PAUSED":"#a4a4a4","REPEATING":"#9b59b6"}

    function statusLabel(status, mediaType) {
        var label = STATUS_LABEL[status]
        if (label && typeof label === "object") return label[mediaType] || label.anime
        return label || status
    }

    function scoreColor(score) {
        if (score >= 80) return "#4cd137"
        if (score >= 60) return "#c9d137"
        if (score >= 40) return "#f2994a"
        return "#e84118"
    }

    function render(friends, mediaType) {
        var app = document.getElementById("app")
        app.innerHTML = ""
        if (!friends || friends.length === 0) return

        var heading = document.createElement("div")
        heading.className = "heading"
        heading.textContent = "Following"
        app.appendChild(heading)

        var list = document.createElement("div")
        list.className = "list"

        friends.forEach(function (f) {
            var username = (f.user && f.user.name) || ""

            var profileUrl = "https://anilist.co/user/" + encodeURIComponent(username)

            var row = document.createElement("a")
            row.className = "row"
            row.href = profileUrl
            row.target = "_blank"
            row.rel = "noopener noreferrer"
            row.addEventListener("click", function (event) {
                event.preventDefault()
                window.webview.send("open-profile", profileUrl)
            })

            var avatar = document.createElement("img")
            avatar.className = "avatar"
            avatar.src = (f.user && f.user.avatar && f.user.avatar.large) || ""
            row.appendChild(avatar)

            var name = document.createElement("div")
            name.className = "name"
            name.textContent = username || "Unknown"
            row.appendChild(name)

            if (f.progress > 0 && f.status !== "COMPLETED") {
                var total = f.media && (mediaType === "manga" ? f.media.chapters : f.media.episodes)
                var prefix = mediaType === "manga" ? "Ch " : "Ep "
                var episode = document.createElement("div")
                episode.className = "episode"
                episode.textContent = prefix + f.progress + (total ? "/" + total : "")
                row.appendChild(episode)
            }

            if (f.score > 0) {
                var score = document.createElement("div")
                score.className = "score"
                score.style.color = scoreColor(f.score)
                score.textContent = String(Math.round(f.score) / 10)
                row.appendChild(score)
            }

            var status = document.createElement("div")
            status.className = "status"
            status.style.background = STATUS_COLOR[f.status] || "#a4a4a4"
            status.textContent = statusLabel(f.status, mediaType)
            row.appendChild(status)

            list.appendChild(row)
        })

        app.appendChild(list)
    }

    var _friends = []
    var _mediaType = "anime"

    function rerender() { render(_friends, _mediaType) }

    window.webview.on("friends", function (d) { _friends = d || []; rerender() })
    window.webview.on("mediaType", function (d) { _mediaType = d === "manga" ? "manga" : "anime"; rerender() })
</script>
</body>
</html>
        `

        animePanel.setContent(panelContent)
        mangaPanel.setContent(panelContent)
    })
}
