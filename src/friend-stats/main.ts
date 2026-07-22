/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

interface FriendListEntry {
    status: $app.AL_MediaListStatus
    score: number
    progress: number
    media: { episodes?: number }
    user: {
        name: string
        avatar?: { large?: string }
    }
}

const CACHE_TTL_MS = 5 * 60 * 1000

function init() {
    $ui.register((ctx) => {
        const mediaId = ctx.state(0)
        const friends = ctx.state<FriendListEntry[]>([])

        const panel = ctx.newWebview({
            slot: "after-anime-entry-episode-list",
            fullWidth: true,
            autoHeight: true,
        })

        panel.channel.sync("friends", friends)
        
        const openUrl = ctx.state("")

        panel.channel.on("open-profile", (url: string) => {
            openUrl.set(url)
        })

        ctx.effect(() => {
            const url = openUrl.get()
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

            openUrl.set("")
        }, [openUrl])

        ctx.screen.onNavigate((e) => {
            mediaId.set(e.pathname === "/entry" && !!e.searchParams.id ? parseInt(e.searchParams.id) : 0)
        })
        ctx.screen.loadCurrent()

        ctx.effect(() => {
            const id = mediaId.get()
            if (!id) {
                friends.set([])
                panel.hide()
                return
            }

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
        }, [mediaId])

        panel.setContent(() => `
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
    var STATUS_LABEL = {"CURRENT":"Watching","PLANNING":"Planning","COMPLETED":"Completed","DROPPED":"Dropped","PAUSED":"Paused","REPEATING":"Rewatching"}
    var STATUS_COLOR = {"CURRENT":"#3db4f2","PLANNING":"#f2c94c","COMPLETED":"#4cd137","DROPPED":"#e84118","PAUSED":"#a4a4a4","REPEATING":"#9b59b6"}

    function scoreColor(score) {
        if (score >= 80) return "#4cd137"
        if (score >= 60) return "#c9d137"
        if (score >= 40) return "#f2994a"
        return "#e84118"
    }

    function render(friends) {
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
                var totalEpisodes = f.media && f.media.episodes
                var episode = document.createElement("div")
                episode.className = "episode"
                episode.textContent = "Ep " + f.progress + (totalEpisodes ? "/" + totalEpisodes : "")
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
            status.textContent = STATUS_LABEL[f.status] || f.status
            row.appendChild(status)

            list.appendChild(row)
        })

        app.appendChild(list)
    }

    window.webview.on("friends", render)
</script>
</body>
</html>
        `)
    })
}
