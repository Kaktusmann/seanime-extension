
function init() {
    $ui.register((ctx) => {

        const STORAGE_KEYS = {
            AUTOPLAY:       "anime-player.autoplay",
            PROVIDER:       "anime-player.provider",
            VOLUME:         "anime-player.volume",
            MANUAL_MATCHES: "anime-player.manualMatches",
        } as const;

        // Embedded assets
        const PLAYER_CSS: string = "__PLAYER_CSS__";
        const PLAYER_HTML: string = "__PLAYER_HTML__";
        const PLAYER_JS_BODY: string = "__PLAYER_JS__";

        const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

        const getSettings = () => ({
            autoplay:      ($storage.get(STORAGE_KEYS.AUTOPLAY)       as boolean)                ?? true,
            provider:      ($storage.get(STORAGE_KEYS.PROVIDER)       as string)                 ?? "animethemes",
            volume:        ($storage.get(STORAGE_KEYS.VOLUME)         as number)                 ?? 0.7,
            manualMatches: ($storage.get(STORAGE_KEYS.MANUAL_MATCHES) as Record<string, string>) ?? {},
        });

        const refs = {
            autoplay: ctx.fieldRef(getSettings().autoplay),
            provider: ctx.fieldRef(getSettings().provider),
            volume:   ctx.fieldRef(getSettings().volume),
        };

        const tray = ctx.newTray({
            tooltipText: "Anime Themes",
            iconUrl: "https://raw.githubusercontent.com/jabifx/seanime-extensions/master/src/AnimeThemes/icon.ico",
            withContent: true,
        });

        ctx.registerEventHandler("save-player-settings", () => {
            $storage.set(STORAGE_KEYS.AUTOPLAY, refs.autoplay.current);
            $storage.set(STORAGE_KEYS.PROVIDER, refs.provider.current);
            $storage.set(STORAGE_KEYS.VOLUME,   refs.volume.current);
            ctx.toast.success("Settings saved!");
        });

        tray.render(() => {
            const items = [
                tray.text("AnimeThemes Settings", {
                    style: { fontWeight: "bold", fontSize: "14px", marginBottom: "8px" },
                }),
                tray.select("Default Provider", {
                    fieldRef: refs.provider,
                    options: [
                        { label: "AnimeThemes", value: "animethemes" },
                        { label: "AniSongDB",   value: "anisongdb"   },
                    ],
                    help: "Can also be toggled inside the player",
                }),
                tray.select("Initial Volume", {
                    fieldRef: refs.volume,
                    options: [
                        { label: "0%",   value: 0.0  },
                        { label: "25%",  value: 0.25 },
                        { label: "50%",  value: 0.5  },
                        { label: "75%",  value: 0.75 },
                        { label: "100%", value: 1    },
                    ],
                }),
                tray.switch("Autoplay first OP", { fieldRef: refs.autoplay }),
                tray.button("Save Settings", { onClick: "save-player-settings", intent: "primary-subtle" }),
            ];
            return tray.stack({ items, style: { gap: "12px", padding: "8px" } });
        });

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
        button.mount();

        // State
        let isOpen: boolean = false;
        let lastInjectedId: string | null = null;
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

        const injectPlayer = async (anilistId: any): Promise<void> => {
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
                "if(!ip){console.error('AnimeThemes: Container not found');return;}" +

                // Create wrapper
                "var wr=document.createElement('div');" +
                "wr.setAttribute('data-anime-player','root');" +
                "wr.id='anime-theme-player-root';" +
                "wr.innerHTML=" + JSON.stringify(PLAYER_HTML) + ";" +

                "ip.parentNode.insertBefore(wr, ip);" +
                "ip.style.display='none';" +

                "var ANILIST_ID="     + JSON.stringify(anilistId)       + ";" +
                "var INITIAL_VOLUME=" + s.volume                        + ";" +
                "var AUTOPLAY="       + s.autoplay                      + ";" +
                "var PROVIDER="       + JSON.stringify(s.provider)      + ";" +
                "var MANUAL_MATCHES=" + JSON.stringify(s.manualMatches) + ";" +
                PLAYER_JS_BODY +
                "})();";

            trackedScript = await exec(payload);
            lastInjectedId = anilistId;
        };

        const setVisible = (v: boolean): Promise<void> =>
            run(
                "var w=document.getElementById('anime-theme-player-root');" +
                "if(w)w.style.display='" + (v ? "block" : "none") + "';" +

                "var c=document.querySelector('[data-anime-entry-page-content-container=\"true\"]');" +
                "if(c)c.style.display='" + (v ? "none" : "") + "';" +

                "var g=document.querySelector('[data-media-page-header-banner-bottom-gradient=\"true\"]');" +
                "if(g)g.style.pointerEvents='" + (v ? "none" : "") + "';" +

                (v ? "" : "var vid=document.querySelector('#anime-theme-player video');if(vid)vid.pause();")
            );

        button.onClick(async (e: { media: $app.AL_BaseAnime }) => {
            currentAnilistId = e.media.id.toString();

            if (isOpen) {
                await setVisible(false);
                isOpen = false;
                return;
            }

            if (lastInjectedId !== currentAnilistId) {
                button.setLoading(true);
                try {
                    await injectPlayer(currentAnilistId);
                } finally {
                    button.setLoading(false);
                }
            }

            await setVisible(true);
            isOpen = true;
        });

        ctx.dom.onReady(() => {
            ctx.screen.onNavigate(async (e: any) => {
                if (e.pathname !== "/entry") {
                    if (trackedScript) {
                        try { await trackedScript.remove(); } catch (_) {}
                        trackedScript = null;
                    }
                    await run(
                        "var w=document.getElementById('anime-theme-player-root');if(w)w.remove();" +
                        "var c=document.querySelector('[data-anime-player=\"css\"]');if(c)c.remove();" +
                        "var m=document.querySelector('[data-anime-entry-page-content-container=\"true\"]');if(m)m.style.display='';"
                    );
                    isOpen = false;
                    lastInjectedId = null;
                    currentAnilistId = null;
                    return;
                }
                const id = e.searchParams?.id;
                if (id) currentAnilistId = id;
            });
            ctx.screen.loadCurrent();
        });

    });
}