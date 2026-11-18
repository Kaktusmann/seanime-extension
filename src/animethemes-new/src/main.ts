
function init() {
    $ui.register((ctx) => {

        const MANUAL_MATCHES_KEY = "anime-player.manualMatches";

        // Embedded assets
        const PLAYER_CSS: string = "__PLAYER_CSS__";
        const PLAYER_HTML: string = "__PLAYER_HTML__";
        const PLAYER_JS_BODY: string = "__PLAYER_JS__";

        const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

        // userConfig values may arrive as strings (switch defaults are "true"/"false").
        const getSettings = () => ({
            autoplay:      $getUserPreference("autoplay") !== "false",
            provider:      $getUserPreference("defaultProvider") || "animethemes",
            volume:        Number($getUserPreference("initialVolume") ?? 0.7),
            manualMatches: ($storage.get(MANUAL_MATCHES_KEY) as Record<string, string>) ?? {},
        });

        const playerLocation = $getUserPreference("playerLocation") || "button";
        const showButton = playerLocation !== "tray";
        const showTrayPlayer = playerLocation !== "button";

        const currentMedia = ctx.state<{ id: string; title: string; banner: string } | null>(null);

        // Host objects can expose title fields that aren't plain JS strings, which tray.text rejects.
        const toMediaInfo = (id: string, media: any) => {
            const title = media?.title?.userPreferred ?? media?.title?.romaji;
            return {
                id,
                title: title ? String(title) : `Anime ${id}`,
                banner: media?.bannerImage ? String(media.bannerImage) : "",
            };
        };

        if (showTrayPlayer) {
            const tray = ctx.newTray({
                tooltipText: "Anime Themes",
                iconUrl: "https://raw.githubusercontent.com/jabifx/seanime-extensions/master/src/AnimeThemes/icon.ico",
                withContent: true,
                width: "28rem",
            });

            tray.render(() => {
                const media = currentMedia.get();

                const banner = tray.div([], {
                    className: "absolute h-40 rounded-t-xl bg-center bg-cover pointer-events-none",
                    style: {
                        top: "-0.75rem",
                        left: "-0.75rem",
                        width: "calc(100% + 1.5rem)",
                        backgroundImage: media?.banner ? `url(${media.banner})` : "none",
                        maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 100%)",
                    },
                });

                const content = tray.stack([
                    tray.div([
                        tray.text(media ? "AnimeThemes for" : "AnimeThemes", { className: "text-sm" }),
                        tray.text(media?.title || "Open an anime page to detect it", {
                            className: "font-bold text-xl line-clamp-2 break-normal text-pretty leading-tight",
                        }),
                    ], { className: "space-y-1 font-semibold h-20" }),
                    tray.flex([
                        tray.button("Toggle player", { intent: "primary", size: "md", onClick: "toggle-floating-player" }),
                    ], { className: "justify-end" }),
                ], { className: "p-2 space-y-2" });

                return tray.div([banner, tray.div([content], { style: { position: "relative" } })], { style: { position: "relative" } });
            });
        }

        const button = ctx.action.newAnimePageButton({
            label: "\u200b",
            intent: "gray-subtle",
            style: {
                backgroundImage: "url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tdXNpYzItaWNvbiBsdWNpZGUtbXVzaWMtMiI+PGNpcmNsZSBjeD0iOCIgY3k9IjE4IiByPSI0Ii8+PHBhdGggZD0iTTEyIDE4VjJsNyA0Ii8+PC9zdmc+)",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                backgroundSize: "21.5px 21.5px",
                width: "40px",
                padding: "0",
                paddingInlineStart: "0.5rem",
            },
            tooltipText: "Anime Themes",
        });
        if (showButton) button.mount();

        // State
        // "" means injected without an anime page (tray); undefined means no player.
        let lastInjectedId: string | undefined;

        // The player can dock/undock itself in-page, so the DOM is the source of truth.
        const isFloating = async (): Promise<boolean> => {
            const root = await ctx.dom.queryOne("#anime-theme-player-root");
            return root ? Boolean(await root.hasClass("floating")) : false;
        };
        let currentAnilistId: string | null = null;
        let trackedScript: any = null;

        const exec = async (code: string): Promise<any> => {
            const body = await ctx.dom.queryOne("body");
            if (!body) return null;
            const el = await ctx.dom.createElement("script");
            const safeDecode = 'decodeURIComponent(escape(window.atob("' + b64(code) + '")))';
            el.setText('eval(' + safeDecode + ')');

            body.append(el);
            return el;
        };

        const run = async (code: string): Promise<void> => {
            const el = await exec(code);
            if (el) { try { await el.remove(); } catch (_) {} }
        };

        const injectPlayer = async (anilistId: any, floating: boolean): Promise<void> => {
            if (trackedScript) {
                try { await trackedScript.remove(); } catch (_) {}
                trackedScript = null;
            }

            const s = getSettings();

            const payload =
                "(function(){" +
                "var ow=document.getElementById('anime-theme-player-root');" +
                "if(ow)ow.remove();" +
                "var os=document.querySelector('[data-anime-player=\"css\"]');" +
                "if(os)os.remove();" +
                "var st=document.createElement('style');" +
                "st.setAttribute('data-anime-player','css');" +
                "st.textContent=" + JSON.stringify(PLAYER_CSS) + ";" +
                "document.head.appendChild(st);" +
                "var ip=document.querySelector('[data-anime-entry-page-content-container=\"true\"]');" +
                (floating
                    // Replacing a docked player: give the page back what it hid.
                    ? "if(ip)ip.style.display='';" +
                      "var gr=document.querySelector('[data-media-page-header-banner-bottom-gradient=\"true\"]');" +
                      "if(gr)gr.style.pointerEvents='';"
                    : "if(!ip){console.error('AnimeThemes: Container not found');return;}") +

                // Create wrapper
                "var wr=document.createElement('div');" +
                "wr.setAttribute('data-anime-player','root');" +
                "wr.id='anime-theme-player-root';" +
                "wr.innerHTML=" + JSON.stringify(PLAYER_HTML) + ";" +

                (floating
                    ? "wr.classList.add('floating');document.body.appendChild(wr);"
                    : "ip.parentNode.insertBefore(wr, ip);ip.style.display='none';") +

                "var ANILIST_ID="     + JSON.stringify(anilistId)       + ";" +
                "var INITIAL_VOLUME=" + s.volume                        + ";" +
                "var AUTOPLAY="       + s.autoplay                      + ";" +
                "var PROVIDER="       + JSON.stringify(s.provider)      + ";" +
                "var MANUAL_MATCHES=" + JSON.stringify(s.manualMatches) + ";" +
                PLAYER_JS_BODY +
                "})();";

            trackedScript = await exec(payload);
            lastInjectedId = anilistId ?? "";
        };

        // The player's own X button hides the root in-page, so visibility is read from the DOM, not tracked here.
        const setVisible = (v: boolean | "toggle"): Promise<void> =>
            run(
                "(function(){var w=document.getElementById('anime-theme-player-root');" +
                "if(!w)return;" +
                "var v=" + (v === "toggle" ? "w.style.display==='none'" : v) + ";" +
                "w.style.display=v?'block':'none';" +

                "var c=document.querySelector('[data-anime-entry-page-content-container=\"true\"]');" +
                "if(c&&!w.classList.contains('floating'))c.style.display=v?'none':'';" +

                "var g=document.querySelector('[data-media-page-header-banner-bottom-gradient=\"true\"]');" +
                "if(g&&!w.classList.contains('floating'))g.style.pointerEvents=v?'none':'';" +

                "if(!v){var vid=document.querySelector('#anime-theme-player video');if(vid)vid.pause();}})();"
            );

        const togglePlayer = async (floating: boolean): Promise<void> => {
            if (lastInjectedId === (currentAnilistId ?? "") && await isFloating() === floating) {
                await setVisible("toggle");
                return;
            }

            await injectPlayer(currentAnilistId, floating);
            await setVisible(true);
        };

        ctx.registerEventHandler("toggle-floating-player", () => togglePlayer(true));

        button.onClick(async (e: { media: $app.AL_BaseAnime }) => {
            currentAnilistId = e.media.id.toString();
            currentMedia.set(toMediaInfo(currentAnilistId, e.media));
            button.setLoading(true);
            try {
                await togglePlayer(false);
            } finally {
                button.setLoading(false);
            }
        });

        ctx.dom.onReady(() => {
            ctx.screen.onNavigate(async (e: any) => {
                if (e.pathname !== "/entry") currentMedia.set(null);

                // The floating player is meant to keep playing across pages.
                if (e.pathname !== "/entry" && !(await isFloating())) {
                    if (trackedScript) {
                        try { await trackedScript.remove(); } catch (_) {}
                        trackedScript = null;
                    }
                    await run(
                        "var w=document.getElementById('anime-theme-player-root');if(w)w.remove();" +
                        "var c=document.querySelector('[data-anime-player=\"css\"]');if(c)c.remove();" +
                        "var m=document.querySelector('[data-anime-entry-page-content-container=\"true\"]');if(m)m.style.display='';"
                    );
                    lastInjectedId = undefined;
                    currentAnilistId = null;
                    return;
                }
                const id = e.searchParams?.id;
                if (!id) return;
                currentAnilistId = id;

                // One AniList request per entry visit; the page button fills this for free.
                if (!showTrayPlayer || currentMedia.get()?.id === id) return;
                currentMedia.set(toMediaInfo(id, $anilist.getAnime(Number(id))));
            });
            ctx.screen.loadCurrent();
        });

    });
}