/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type FieldKey =
	| "titleRomaji" | "titleEnglish" | "titleNative" | "description" | "coverImage" | "bannerImage"
	| "format" | "status" | "season" | "seasonYear" | "episodes" | "airedEpisodes" | "duration"
	| "meanScore" | "startDate" | "endDate" | "genres" | "synonyms";

// Raw form values; a missing key means "keep the AniList value".
type Override = Partial<Record<FieldKey, string>>;

type OverrideStore = {
	load(): Record<number, Override>;
	save(mediaId: number, override: Override | null): void;
	applyToAnime(media: $app.AL_BaseAnime | undefined): void;
	applyToCollection(collection: $app.AL_AnimeCollection | undefined): void;
	applyToMetadata(mediaId: number, metadata: $app.Metadata_AnimeMetadata | undefined): void;
};

// @ts-ignore
function init() {
	$shared.define("overrides", () => {
		const key = "CUSTOM_ANIME_METADATA_V1";
		const load = () => ($storage.get<Record<number, Override>>(key) ?? {}) as Record<number, Override>;
		const save = (mediaId: number, override: Override | null) => {
			const all = load();
			if (override && Object.keys(override).length) all[mediaId] = override;
			else delete all[mediaId];
			$storage.set(key, all);
		};

		const WEEK_SECONDS = 7 * 24 * 60 * 60;

		const splitList = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

		function toDate(value: string) {
			const [year, month, day] = value.split("-").map(Number);
			return { year, month, day };
		}

		function applyOverride(media: $app.AL_BaseAnime, o: Override) {
			const title = media.title ?? (media.title = {});
			// Keep userPreferred pointing at the same language the user's AniList setting picked.
			const preferred = [
				[title.romaji, o.titleRomaji],
				[title.english, o.titleEnglish],
				[title.native, o.titleNative],
			].find(([original]) => original === title.userPreferred)?.[1];
			if (o.titleRomaji) title.romaji = o.titleRomaji;
			if (o.titleEnglish) title.english = o.titleEnglish;
			if (o.titleNative) title.native = o.titleNative;
			if (preferred) title.userPreferred = preferred;

			if (o.description) media.description = o.description;
			if (o.bannerImage) media.bannerImage = o.bannerImage;
			if (o.coverImage) media.coverImage = { ...media.coverImage, medium: o.coverImage, large: o.coverImage, extraLarge: o.coverImage };
			if (o.format) media.format = o.format as $app.AL_MediaFormat;
			if (o.status) media.status = o.status as $app.AL_MediaStatus;
			if (o.season) media.season = o.season as $app.AL_MediaSeason;
			if (o.seasonYear) media.seasonYear = Number(o.seasonYear);
			if (o.episodes) media.episodes = Number(o.episodes);
			if (o.duration) media.duration = Number(o.duration);
			if (o.meanScore) media.meanScore = Number(o.meanScore);
			if (o.startDate) media.startDate = toDate(o.startDate);
			if (o.endDate) media.endDate = toDate(o.endDate);
			if (o.genres) media.genres = splitList(o.genres);
			if (o.synonyms) media.synonyms = splitList(o.synonyms);

			if (!o.airedEpisodes) return;
			// Seanime derives the aired count from nextAiringEpisode, falling back to the total episode count.
			const aired = Number(o.airedEpisodes);
			if (media.episodes && aired >= media.episodes) {
				media.nextAiringEpisode = undefined;
				return;
			}
			media.nextAiringEpisode = {
				episode: aired + 1,
				airingAt: Math.floor(Date.now() / 1000) + WEEK_SECONDS,
				timeUntilAiring: WEEK_SECONDS,
			};
		}

		function applyToCollection(collection: $app.AL_AnimeCollection | undefined) {
			if (!collection) return;
			const overrides = load();
			for (const list of collection.MediaListCollection?.lists ?? []) {
				for (const entry of list.entries ?? []) {
					const override = entry.media && overrides[entry.media.id];
					if (override) applyOverride(entry.media!, override);
				}
			}
		}

		const applyToAnime = (media: $app.AL_BaseAnime | undefined) => {
			const override = media && load()[media.id];
			if (override) applyOverride(media, override);
		};

		// Streaming views list episodes from AniDB metadata, so episodes AniDB doesn't know yet must be added.
		const applyToMetadata = (mediaId: number, metadata: $app.Metadata_AnimeMetadata | undefined) => {
			const aired = Number(load()[mediaId]?.airedEpisodes);
			if (!metadata || !aired) return;
			const episodes = metadata.episodes ?? (metadata.episodes = {});
			for (let n = 1; n <= aired; n++) {
				if (episodes[n]) continue;
				episodes[n] = {
					anidbId: 0, tvdbId: 0, title: `Episode ${n}`, image: "", airDate: "", length: 0, summary: "", overview: "",
					episodeNumber: n, episode: `${n}`, seasonNumber: 0, absoluteEpisodeNumber: n, anidbEid: 0, hasImage: false,
				};
			}
			metadata.episodeCount = Math.max(metadata.episodeCount, aired);
		};

		return { load, save, applyToAnime, applyToCollection, applyToMetadata };
	});

	$app.onGetAnime((e) => {
		$shared.use<OverrideStore>("overrides").applyToAnime(e.anime);
		e.next();
	});

	$app.onGetAnimeCollection((e) => {
		$shared.use<OverrideStore>("overrides").applyToCollection(e.animeCollection);
		e.next();
	});
	$app.onGetRawAnimeCollection((e) => {
		$shared.use<OverrideStore>("overrides").applyToCollection(e.animeCollection);
		e.next();
	});
	$app.onGetCachedAnimeCollection((e) => {
		$shared.use<OverrideStore>("overrides").applyToCollection(e.animeCollection);
		e.next();
	});
	$app.onGetCachedRawAnimeCollection((e) => {
		$shared.use<OverrideStore>("overrides").applyToCollection(e.animeCollection);
		e.next();
	});

	$app.onAnimeMetadata((e) => {
		$shared.use<OverrideStore>("overrides").applyToMetadata(e.mediaId, e.animeMetadata);
		e.next();
	});

	// The episode list is built from its own copy of the media, which skips the platform hooks.
	$app.onAnimeEpisodeCollectionRequested((e) => {
		$shared.use<OverrideStore>("overrides").applyToAnime(e.media);
		e.next();
	});

	$ui.register((ctx) => {
		const DATE_PATTERN = /^\d{4}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/;
		const choices = (values: string[]) => [{ label: "Default", value: "" }, ...values.map((v) => ({ label: v, value: v }))];

		const FIELDS: { key: FieldKey; label: string; textarea?: boolean; options?: ReturnType<typeof choices>; numeric?: boolean; date?: boolean }[] = [
			{ key: "titleRomaji", label: "Title (Romaji)" },
			{ key: "titleEnglish", label: "Title (English)" },
			{ key: "titleNative", label: "Title (Native)" },
			{ key: "description", label: "Description", textarea: true },
			{ key: "coverImage", label: "Cover image URL" },
			{ key: "bannerImage", label: "Banner image URL" },
			{ key: "format", label: "Format", options: choices(["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"]) },
			{ key: "status", label: "Status", options: choices(["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"]) },
			{ key: "season", label: "Season", options: choices(["WINTER", "SPRING", "SUMMER", "FALL"]) },
			{ key: "seasonYear", label: "Season year", numeric: true },
			{ key: "episodes", label: "Total episodes", numeric: true },
			{ key: "airedEpisodes", label: "Aired episodes", numeric: true },
			{ key: "duration", label: "Duration (minutes)", numeric: true },
			{ key: "meanScore", label: "Mean score (0-100)", numeric: true },
			{ key: "startDate", label: "Start date (yyyy-mm-dd)", date: true },
			{ key: "endDate", label: "End date (yyyy-mm-dd)", date: true },
			{ key: "genres", label: "Genres (comma separated)" },
			{ key: "synonyms", label: "Synonyms (comma separated)" },
		];

		const store = $shared.use<OverrideStore>("overrides");
		const tray = ctx.newTray({ iconUrl: "https://raw.githubusercontent.com/Kaktusmann/seanime-extension/refs/heads/main/src/custom-anime-metadata/icon.ico", withContent: true, width: "32rem" });
		const current = ctx.state<{ id: number; title: string; banner: string } | null>(null);
		const refs = Object.fromEntries(FIELDS.map((f) => [f.key, ctx.fieldRef<string>("")])) as Record<FieldKey, ReturnType<typeof ctx.fieldRef<string>>>;

		function fill(override: Override) {
			for (const { key } of FIELDS) refs[key].setValue(override[key] ?? "");
		}

		function readForm() {
			const override: Override = {};
			for (const field of FIELDS) {
				const value = refs[field.key].current.trim();
				if (!value) continue;
				if (field.numeric && !/^\d+$/.test(value)) throw new Error(`${field.label} must be a whole number`);
				if (field.date && !DATE_PATTERN.test(value)) throw new Error(`${field.label} must follow yyyy-mm-dd`);
				override[field.key] = value;
			}
			return override;
		}

		function refreshClient() {
			// Hooks mutate Seanime's cached AniList objects in place, so originals only come back after a refetch.
			$anilist.clearCache();
			$anilist.refreshAnimeCollection();
			ctx.anime.clearEpisodeMetadataCache();
			$app.invalidateClientQuery(["ANIME-ENTRIES-get-anime-entry", "ANIME-get-anime-episode-collection"]);
		}

		function persist(mediaId: number, override: Override | null) {
			store.save(mediaId, override);
			refreshClient();
		}

		function labeledField(label: string, control: any) {
			return tray.flex([
				tray.text(label, {
					className: "flex items-center w-40 shrink-0 whitespace-nowrap px-3 bg-gray-800 rounded-l-xl border text-sm",
					style: { marginRight: "-1px" },
				}),
				control,
			], { gap: 0 });
		}

		const controlStyle = { borderRadius: "0 0.75rem 0.75rem 0", background: "rgb(var(--color-gray-900))" };

		tray.render(() => {
			const media = current.get();
			if (!media) return tray.text("Open an anime page and choose \"Edit Metadata\".", { className: "p-2 text-sm" });

			const fields = FIELDS.map((f) =>
				labeledField(
					f.label,
					f.options
						? tray.select("", { fieldRef: refs[f.key], options: f.options, style: controlStyle })
						: tray.input({ fieldRef: refs[f.key], textarea: f.textarea ?? false, placeholder: "Keep AniList value", style: f.textarea ? { ...controlStyle, resize: "none" } : controlStyle }),
				),
			);

			const banner = tray.div([], {
				className: "absolute h-40 rounded-t-xl bg-center bg-cover pointer-events-none",
				style: {
					top: "-0.75rem",
					left: "-0.75rem",
					width: "calc(100% + 1.5rem)",
					backgroundImage: `url(${media.banner})`,
					maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 100%)",
				},
			});

			const content = tray.stack(
				[
					tray.div(
						[
							tray.text("Custom Anime Metadata for", { className: "text-sm" }),
							tray.text(media.title, { className: "font-bold text-xl line-clamp-2 break-normal text-pretty leading-tight" }),
						],
						{ className: "space-y-1 font-semibold h-20" },
					),
					tray.div(fields, { className: "space-y-2 overflow-y-auto", style: { height: "24rem" } }),
					tray.flex(
						[
							tray.button("Reset", {
								intent: "alert",
								size: "md",
								onClick: ctx.eventHandler("reset", () => {
									persist(media.id, null);
									fill({});
									ctx.toast.success("Metadata reset to AniList values");
									tray.close();
								}),
							}),
							tray.button("Save", {
								intent: "primary",
								size: "md",
								onClick: ctx.eventHandler("save", () => {
									try {
										persist(media.id, readForm());
									} catch (err) {
										return ctx.toast.error((err as Error).message);
									}
									ctx.toast.success("Metadata saved");
									tray.close();
								}),
							}),
						],
						{ className: "justify-end" },
					),
				],
				{ className: "p-2 space-y-2" },
			);

			return tray.div([banner, tray.div([content], { style: { position: "relative" } })], { style: { position: "relative" } });
		});

		const button = ctx.action.newAnimePageButton({ label: "Edit Metadata" });
		button.mount();
		button.onClick(({ media }) => {
			current.set({ id: media.id, title: media.title?.userPreferred ?? `Anime ${media.id}`, banner: media.bannerImage ?? "" });
			fill($shared.use<OverrideStore>("overrides").load()[media.id] ?? {});
			tray.open();
		});
	});
}
