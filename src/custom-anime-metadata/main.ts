/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type FieldKey =
	| "titleRomaji" | "titleEnglish" | "titleNative" | "description" | "coverImage" | "bannerImage"
	| "format" | "status" | "season" | "seasonYear" | "episodes" | "airedEpisodes" | "duration"
	| "meanScore" | "startDate" | "endDate" | "genres" | "synonyms"
	| "anidbId" | "animapAnilistId" | "offsetProgress";

// Raw form values; a missing key means "keep the AniList value".
type Override = Partial<Record<FieldKey, string>>;

type OverrideStore = {
	load(): Record<number, Override>;
	save(mediaId: number, override: Override | null): void;
	progressOffset(mediaId: number): number;
	trackedOffset(mediaId: number): number;
	forgetShiftedProgress(mediaId: number): void;
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
			delete airedByMedia[mediaId];
			delete shiftedProgress[mediaId];
			$storage.set(key, all);
		};

		const WEEK_SECONDS = 7 * 24 * 60 * 60;

		// "+1" / "-3" shift the AniList aired count; a plain number replaces it.
		const isOffset = (value: string) => /^[+-]/.test(value);
		const airedByMedia: Record<number, number> = {};

		// Progress we already shifted on the cached entry; collection objects are mutated in place, so this keeps the shift from stacking.
		// Cleared whenever AniList progress is about to change, since the refetched value could otherwise equal it.
		const shiftedProgress: Record<number, number> = {};

		// Seanime ep N is tracked as AniList ep N - offset, so watching ep 5 with "+1" records 4.
		const progressOffset = (mediaId: number) => {
			const aired = load()[mediaId]?.airedEpisodes;
			return aired && isOffset(aired) ? Number(aired) : 0;
		};

		// "off" keeps the aired/schedule offset but leaves AniList progress untouched.
		const trackedOffset = (mediaId: number) => (load()[mediaId]?.offsetProgress === "off" ? 0 : progressOffset(mediaId));

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
			const next = media.nextAiringEpisode;
			// Cached objects are mutated in place, so an offset must not be applied on top of our own synthetic airing time.
			const alreadyApplied = next?.timeUntilAiring === WEEK_SECONDS;
			const anilistAired = next ? next.episode - 1 : media.episodes ?? 0;
			const aired = alreadyApplied ? anilistAired : Math.max(0, isOffset(o.airedEpisodes) ? anilistAired + Number(o.airedEpisodes) : Number(o.airedEpisodes));
			airedByMedia[media.id] = aired;
			if (alreadyApplied) return;
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

		// AniList stores N - offset, so show N in Seanime and the next episode to watch follows.
		function shiftProgress(entry: $app.AL_AnimeCollection_MediaListCollection_Lists_Entries, o: Override) {
			const mediaId = entry.media!.id;
			const offset = trackedOffset(mediaId);
			if (!offset || entry.progress === undefined || entry.progress === shiftedProgress[mediaId]) return;
			entry.progress = Math.max(0, entry.progress + offset);
			shiftedProgress[mediaId] = entry.progress;
		}

		function applyToCollection(collection: $app.AL_AnimeCollection | undefined) {
			if (!collection) return;
			const overrides = load();
			for (const list of collection.MediaListCollection?.lists ?? []) {
				for (const entry of list.entries ?? []) {
					const override = entry.media && overrides[entry.media.id];
					if (!override) continue;
					applyOverride(entry.media!, override);
					shiftProgress(entry, override);
				}
			}
		}

		const applyToAnime = (media: $app.AL_BaseAnime | undefined) => {
			const override = media && load()[media.id];
			if (override) applyOverride(media, override);
		};

		// Streaming views list episodes from AniDB metadata, so episodes AniDB doesn't know yet must be added.
		const applyToMetadata = (mediaId: number, metadata: $app.Metadata_AnimeMetadata | undefined) => {
			const override = load()[mediaId];
			if (!metadata || !override) return;

			if (override.anidbId) (metadata.mappings ?? (metadata.mappings = {})).anidbId = Number(override.anidbId);

			const aired = airedByMedia[mediaId] ?? (override.airedEpisodes && !isOffset(override.airedEpisodes) ? Number(override.airedEpisodes) : 0);
			if (!aired) return;
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

		const forgetShiftedProgress = (mediaId: number) => void delete shiftedProgress[mediaId];

		return { load, save, progressOffset, trackedOffset, forgetShiftedProgress, applyToAnime, applyToCollection, applyToMetadata };
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

	$app.onPreUpdateEntryProgress((e) => {
		const offset = e.mediaId ? $shared.use<OverrideStore>("overrides").trackedOffset(e.mediaId) : 0;
		if (!offset || e.progress === undefined) return e.next();
		$shared.use<OverrideStore>("overrides").forgetShiftedProgress(e.mediaId!);

		let progress = e.progress - offset;
		if (progress < 1) return e.preventDefault();
		// A negative offset can push past the end; without a total override totalCount is the real AniList total.
		const overrides = $shared.use<OverrideStore>("overrides").load();
		if (e.totalCount && !overrides[e.mediaId!]?.episodes) progress = Math.min(progress, e.totalCount);
		e.progress = progress;
		// Seanime picked COMPLETED from the unshifted progress.
		if (e.status === "COMPLETED" && e.totalCount && progress < e.totalCount) e.status = "CURRENT";
		e.next();
	});

	// Episode metadata comes from Animap keyed by AniList ID; look it up by the overridden Animap AniList or AniDB ID instead.
	$app.onAnimapMediaRequested((e) => {
		const override = e.from === "anilist" ? $shared.use<OverrideStore>("overrides").load()[e.id] : undefined;
		if (override?.animapAnilistId) {
			e.id = Number(override.animapAnilistId);
		} else if (override?.anidbId) {
			e.from = "anidb";
			e.id = Number(override.anidbId);
		}
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

	// Schedule items are built from AniList airing schedules, which ignore the overridden total episode count.
	$app.onAnimeScheduleItems((e) => {
		const store = $shared.use<OverrideStore>("overrides");
		const overrides = store.load();
		e.items = e.items?.filter((item) => {
			// Shift AniList numbering to match the aired-episodes offset.
			item.episodeNumber += store.progressOffset(item.mediaId);
			if (item.episodeNumber < 1) return false;
			const total = Number(overrides[item.mediaId]?.episodes);
			if (!total) return true;
			item.isSeasonFinale = item.episodeNumber === total;
			return item.episodeNumber <= total;
		});
		e.next();
	});

	$ui.register((ctx) => {
		const DATE_PATTERN = /^\d{4}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/;
		const choices = (values: string[]) => [{ label: "Default", value: "" }, ...values.map((v) => ({ label: v, value: v }))];

		const FIELDS: { key: FieldKey; label: string; textarea?: boolean; options?: ReturnType<typeof choices>; numeric?: boolean; signed?: boolean; date?: boolean; hint?: string }[] = [
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
			{ key: "airedEpisodes", label: "Aired episodes", numeric: true, signed: true, hint: "12, or +1 / -3 to offset AniList" },
			{ key: "offsetProgress", label: "Offset AniList progress", options: [{ label: "On", value: "" }, { label: "Off", value: "off" }] },
			{ key: "duration", label: "Duration", numeric: true, hint: "Minutes per episode" },
			{ key: "meanScore", label: "Mean score", numeric: true, hint: "0-100" },
			{ key: "startDate", label: "Start date", date: true, hint: "yyyy-mm-dd" },
			{ key: "endDate", label: "End date", date: true, hint: "yyyy-mm-dd" },
			{ key: "genres", label: "Genres", hint: "Comma separated" },
			{ key: "synonyms", label: "Synonyms", hint: "Comma separated" },
			{ key: "animapAnilistId", label: "Animap AniList ID", numeric: true, hint: "Load episodes from another anime" },
			{ key: "anidbId", label: "AniDB ID", numeric: true },
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
				if (field.numeric && !(field.signed ? /^[+-]?\d+$/ : /^\d+$/).test(value)) {
					throw new Error(`${field.label} must be a whole number${field.signed ? ", optionally prefixed with + or - for an offset" : ""}`);
				}
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
			ctx.anime.clearScheduleCache();
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
						: tray.input({ fieldRef: refs[f.key], textarea: f.textarea ?? false, placeholder: f.hint ?? "Keep AniList value", style: f.textarea ? { ...controlStyle, resize: "none" } : controlStyle }),
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

		const inMenu = $getUserPreference("buttonLocation") === "menu";
		const action = inMenu
			? ctx.action.newAnimePageDropdownItem({ label: "Edit Metadata" })
			: ctx.action.newAnimePageButton({ label: "Edit Metadata" });
		action.mount();
		action.onClick(({ media }) => {
			current.set({ id: media.id, title: media.title?.userPreferred ?? `Anime ${media.id}`, banner: media.bannerImage ?? "" });
			fill($shared.use<OverrideStore>("overrides").load()[media.id] ?? {});
			// The dropdown closing dismisses a tray opened in the same tick.
			if (inMenu) ctx.setTimeout(() => tray.open(), 500);
			else tray.open();
		});
	});
}
