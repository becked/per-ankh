# Changelog

## [2026-07-07-b39f690] - 2026-07-07

### Fixes

- (map) point resources atlas manifest at the baked hash — [9bd949a](https://github.com/becked/per-ankh/commit/9bd949afcd9d59b90ae9ce56b0539bad02e38a31)

### Other

- (assets) refresh XML-derived data tables — [b39f690](https://github.com/becked/per-ankh/commit/b39f690a00ae5c63ce0baf5f686d671ea102b737)

## [2026-07-07-9a49550] - 2026-07-07

### Features

- (games) let admins reparse a public game from its detail page — [3e40aa9](https://github.com/becked/per-ankh/commit/3e40aa95b28999e54f07e354da1b420df5b2ea3f)
- (tournament) "copy caster post" button on the match popover (#107) — [75085e2](https://github.com/becked/per-ankh/commit/75085e287cc83ecaed9dae640901bc5beac47c94)

### Other

- document local Worker setup (.dev.vars.example, dev-login, migrations) — [9a49550](https://github.com/becked/per-ankh/commit/9a4955048cb06874b23eea69044cd1b628d4f1b6)

## [2026-07-06-da16328] - 2026-07-06

### Features

- (tournament) surface live matches in a Live & Upcoming panel — [59bf017](https://github.com/becked/per-ankh/commit/59bf0176316d32e231fc861858bd401d6b32ea76)
- (tournament) restructure matches page into Live & Upcoming / All tabs — [2b7cf6e](https://github.com/becked/per-ankh/commit/2b7cf6eceb783ae7b552d704ef175776c4ceebfe)
- (tournament) unify match table row style across surfaces — [8792d14](https://github.com/becked/per-ankh/commit/8792d147e91b85965e64ff97d1da415d83557911)
- (tournament) merge caster & stream into one Casters & Streams column — [2b98ef3](https://github.com/becked/per-ankh/commit/2b98ef34959b5ddfaa4003e4ab25a14476930a51)
- (tournament) tidy inline caster display on match rows — [1287226](https://github.com/becked/per-ankh/commit/128722614bcd7ac6b39f2a2b600f3f11cacc26b2)
- (tournament) frame shared match table, align status colors — [dac6580](https://github.com/becked/per-ankh/commit/dac658070623ecdaf6c98d97ebba1c3b6dada945)
- (tournament) sticky UTC/local clock and restructured matches header — [4fdf3c0](https://github.com/becked/per-ankh/commit/4fdf3c0b35f06b5bee487e4e183619dd1e6eba1e)
- (tournament) refine match table row typography and contrast — [c8725c7](https://github.com/becked/per-ankh/commit/c8725c794df1aa3d24412e72049ec6dad3cee9f2)
- (tournament) unify clock/links/settings into a top-right action cluster — [8838a15](https://github.com/becked/per-ankh/commit/8838a15e5b1a6de4209461679607758807914484)
- (tournament) move match search into the header, share it across views — [43d248e](https://github.com/becked/per-ankh/commit/43d248e2bd7d58db16ab6953f2069c9a9767d930)
- (tournament) make Live & Upcoming 'View All' a filled-orange primary — [265d587](https://github.com/becked/per-ankh/commit/265d5874aefb3f9d491c1660c3cd5268d70741d6)
- (tournament) default the match clock to local time — [650fd63](https://github.com/becked/per-ankh/commit/650fd638270d40d53692086507fd83a7367f6e5c)
- (tournament) caster status in the sesh export + distinct needs-casters icon (#101) — [12082ee](https://github.com/becked/per-ankh/commit/12082ee6e60f7c33978bc87b78d3554282baab38)
- (tournament) show the viewer's timezone on the clock toggle — [6fa6990](https://github.com/becked/per-ankh/commit/6fa6990e49bc9b2770277b1e603c8d9d5b0d15a1)

### Fixes

- (tournament) drop celebratory empty state from the Cast view table — [d6825ac](https://github.com/becked/per-ankh/commit/d6825acdaa1538a87548618bd11acc38cd6a2f3f)
- (map) resolve a city's family per turn on the map — [da16328](https://github.com/becked/per-ankh/commit/da16328dcba30b793197837824729fbc1c743da9)

### Other

- (tournament) unify match lists into one shared MatchTable — [db87bb7](https://github.com/becked/per-ankh/commit/db87bb7f19cdc472f9e696210871a68dcf200d9e)
- (tournament) tighten Discord avatar↔name gap from 1.5 to 1 — [5d47e66](https://github.com/becked/per-ankh/commit/5d47e66649161994477bfa6ffd0ff7811434c82e)
- apply prettier formatting to CollapsibleSearch — [cb42926](https://github.com/becked/per-ankh/commit/cb429260920502d671210f81d8d2587987e2d27e)
- (release) deploy 2026-07-05-12082ee — [66ecd05](https://github.com/becked/per-ankh/commit/66ecd05d5345ddbfb81471d5444524cbeff8d392)
- restructure CLAUDE.md into root + nested files + skills — [aa576c2](https://github.com/becked/per-ankh/commit/aa576c23e32b3fe629db9cd008b9cd675be5ceca)
- (tournament) tabular-nums instead of monospace for match numbers — [ee10473](https://github.com/becked/per-ankh/commit/ee1047381e6420abe8d3b71e481738bd5bf1ace6)
- (header) put Upload icon before its label to match other buttons — [ec718ef](https://github.com/becked/per-ankh/commit/ec718ef59879d72b114c79052f0f872db2300fae)

## [2026-07-05-12082ee] - 2026-07-05

### Features

- (tournament) copy button for matches still needing casters — [67fdc28](https://github.com/becked/per-ankh/commit/67fdc2846ad7a6fe2cb4e0a28ee0a8d39bc1bb69)
- (tournament) surface live matches in a Live & Upcoming panel — [59bf017](https://github.com/becked/per-ankh/commit/59bf0176316d32e231fc861858bd401d6b32ea76)
- (tournament) restructure matches page into Live & Upcoming / All tabs — [2b7cf6e](https://github.com/becked/per-ankh/commit/2b7cf6eceb783ae7b552d704ef175776c4ceebfe)
- (tournament) unify match table row style across surfaces — [8792d14](https://github.com/becked/per-ankh/commit/8792d147e91b85965e64ff97d1da415d83557911)
- (tournament) merge caster & stream into one Casters & Streams column — [2b98ef3](https://github.com/becked/per-ankh/commit/2b98ef34959b5ddfaa4003e4ab25a14476930a51)
- (tournament) tidy inline caster display on match rows — [1287226](https://github.com/becked/per-ankh/commit/128722614bcd7ac6b39f2a2b600f3f11cacc26b2)
- (tournament) frame shared match table, align status colors — [dac6580](https://github.com/becked/per-ankh/commit/dac658070623ecdaf6c98d97ebba1c3b6dada945)
- (tournament) sticky UTC/local clock and restructured matches header — [4fdf3c0](https://github.com/becked/per-ankh/commit/4fdf3c0b35f06b5bee487e4e183619dd1e6eba1e)
- (tournament) refine match table row typography and contrast — [c8725c7](https://github.com/becked/per-ankh/commit/c8725c794df1aa3d24412e72049ec6dad3cee9f2)
- (tournament) unify clock/links/settings into a top-right action cluster — [8838a15](https://github.com/becked/per-ankh/commit/8838a15e5b1a6de4209461679607758807914484)
- (tournament) move match search into the header, share it across views — [43d248e](https://github.com/becked/per-ankh/commit/43d248e2bd7d58db16ab6953f2069c9a9767d930)
- (tournament) make Live & Upcoming 'View All' a filled-orange primary — [265d587](https://github.com/becked/per-ankh/commit/265d5874aefb3f9d491c1660c3cd5268d70741d6)
- (tournament) default the match clock to local time — [650fd63](https://github.com/becked/per-ankh/commit/650fd638270d40d53692086507fd83a7367f6e5c)
- (tournament) caster status in the sesh export + distinct needs-casters icon (#101) — [12082ee](https://github.com/becked/per-ankh/commit/12082ee6e60f7c33978bc87b78d3554282baab38)

### Fixes

- (game-detail) classify army units by the game's UnitCycle — [04e94db](https://github.com/becked/per-ankh/commit/04e94db437d3bef4fa8202fffd41c30d648eb43e)
- (tournament) list unscheduled parts under "To be scheduled" — [ce8785c](https://github.com/becked/per-ankh/commit/ce8785cd14c72a790be1d99a4698739cbf4a07f8)
- (tournament) suppress password-manager autofill in user autocomplete — [0fee5b6](https://github.com/becked/per-ankh/commit/0fee5b6b059322798061dbc396cab69dcf298ffa)
- (tournament) match cast grace in the needs-casters copy — [e2f359b](https://github.com/becked/per-ankh/commit/e2f359b327a0500056b2db00d625d694828667f0)
- (tournament) drop celebratory empty state from the Cast view table — [d6825ac](https://github.com/becked/per-ankh/commit/d6825acdaa1538a87548618bd11acc38cd6a2f3f)

### Other

- (tournament) note both copy tools in the controls-card comment — [1a6985b](https://github.com/becked/per-ankh/commit/1a6985b06354de8159328ad31bd78c4ee7f7b2a7)
- (release) deploy 2026-07-05-e34d7d8 — [9f7f4ba](https://github.com/becked/per-ankh/commit/9f7f4ba0345e635e564d9a04ef9d20ddf7b357ae)
- (tournament) unify match lists into one shared MatchTable — [db87bb7](https://github.com/becked/per-ankh/commit/db87bb7f19cdc472f9e696210871a68dcf200d9e)
- (tournament) tighten Discord avatar↔name gap from 1.5 to 1 — [5d47e66](https://github.com/becked/per-ankh/commit/5d47e66649161994477bfa6ffd0ff7811434c82e)
- apply prettier formatting to CollapsibleSearch — [cb42926](https://github.com/becked/per-ankh/commit/cb429260920502d671210f81d8d2587987e2d27e)

## [2026-07-05-e34d7d8] - 2026-07-05

### Features

- (scripts) support PINACOTHECA_DIR/OLD_WORLD_REFERENCE_DIR + bake:sprites — [e07d2d9](https://github.com/becked/per-ankh/commit/e07d2d94878b99d65a671186ce638733bccea15f)
- (parity) add Rust↔TS parser parity test harness — [f59291c](https://github.com/becked/per-ankh/commit/f59291c57fcb14387ce94407989692fe7800ecda)
- (parser) port families to TS, stand up parser foundations — [eab7417](https://github.com/becked/per-ankh/commit/eab7417be2a96c1baf411be7702ce0b81a6e01c6)
- (parser) port tribes to TS — [2c04e13](https://github.com/becked/per-ankh/commit/2c04e131ab2afddbac791184310082fec28abdd0)
- (parser) port religions to TS — [7147bee](https://github.com/becked/per-ankh/commit/7147bee0c6b9d0696ad78ae8e125a4f66e823769)
- (parser) port players to TS — [22b78c2](https://github.com/becked/per-ankh/commit/22b78c257d1db0743067499a64cab68070fe3385)
- (parser) port characters to TS — [288e20e](https://github.com/becked/per-ankh/commit/288e20efd44897ef9f6af671246e63682ac2e939)
- (parser) port cities + 8 sub-entities to TS — [838c153](https://github.com/becked/per-ankh/commit/838c153b6517aef67ce97f4a64002c254d75fd57)
- (parser) port tiles + tile_visibility + tile_changes to TS — [ded2807](https://github.com/becked/per-ankh/commit/ded28075d8b3ddb4a9630157897307dcccac86bc)
- (parser) port units + 5 sub-entities to TS — [e14faac](https://github.com/becked/per-ankh/commit/e14faac85cc7712d2e1f0de41eb007a5c772d467)
- (parser) port character_data to TS — [1d2962b](https://github.com/becked/per-ankh/commit/1d2962b6d00a6e63de09021443438625aa4d11fd)
- (parser) port player_data to TS — [8d1522a](https://github.com/becked/per-ankh/commit/8d1522ae8e281c7bbb2e077092a3b7e2051c6bdc)
- (parser) port diplomacy_relations to TS — [aed1c82](https://github.com/becked/per-ankh/commit/aed1c828d2253ce13745f39759dd82f875aecdbf)
- (parser) port timeseries to TS — [4d6d997](https://github.com/becked/per-ankh/commit/4d6d997864f58513cc0c6b04ed5ebfe2eff5b233)
- (parser) port events to TS — final entities, 46/46 done — [4dd2cdf](https://github.com/becked/per-ankh/commit/4dd2cdfefe188c6fe6ad78ea338e03eefcc4fb7f)
- (parser) add cloud orchestrator + Web Worker entry — [33fb5be](https://github.com/becked/per-ankh/commit/33fb5be5c270bf7fe40e43cdc3b6eb7b88c65244)
- (parity) cover match_metadata + tile_ownership_history — [653d068](https://github.com/becked/per-ankh/commit/653d0687318ac50d97de820e18125554299799c4)
- (parity,parser) share-parity harness + CityTerritory extraction — [400b130](https://github.com/becked/per-ankh/commit/400b130cc1b0776c619c44adc9c89752803e380c)
- (parser,dev) browser parser MVP page + map turn slider parity — [9b34cd4](https://github.com/becked/per-ankh/commit/9b34cd4ddee59a67adce28a3e01fff82cb99cdb1)
- (cloud) D1 schema + Discord auth + games upload/library — [a6d637a](https://github.com/becked/per-ankh/commit/a6d637ab9a6731db902079884814fb98292f8ea8)
- (cloud) observer mode + single-pick player picker — [41da010](https://github.com/becked/per-ankh/commit/41da0106b223ff823583bf9ac3ef89e5c7024efc)
- (cloud) /v1/stats + dashboard + player_summaries backfill — [2e2dd46](https://github.com/becked/per-ankh/commit/2e2dd464f07d11955fc3b6f3fead910dda619e25)
- (cloud) public game sharing + adapter-cloudflare SSR — [00e33ea](https://github.com/becked/per-ankh/commit/00e33eaee5a0ac251bcc376538f41e27d6ce35ec)
- (cloud) raw save download — GET /v1/games/:id/download — [783781e](https://github.com/becked/per-ankh/commit/783781e1f720f093cefdde01ee49f9939b8ff451)
- (cloud) re-import on parser version bump — [3b272f2](https://github.com/becked/per-ankh/commit/3b272f2a8c6157b5a05fb0c2f536509b598fdc71)
- (cloud) persistent header for cloud routes — [4ed0c95](https://github.com/becked/per-ankh/commit/4ed0c951b827c43d91d738c68ece6b18bc2eeafb)
- (cloud) /account page — Discord identity, OnlineIDs, sign out — [297eadd](https://github.com/becked/per-ankh/commit/297eaddde3d0cfbeb4ed229827dfb63490692c2f)
- (cloud) marketing landing at root on cloud build — [960806b](https://github.com/becked/per-ankh/commit/960806bf8090895258f366f460ac700f09cd5e56)
- (cloud) rename Re-import to Reparse — [dde3815](https://github.com/becked/per-ankh/commit/dde3815f73b5e5409460157b608c30d945af1f0a)
- (cloud) bulk upload up to 25 saves at once — [64f86dd](https://github.com/becked/per-ankh/commit/64f86ddea23297e6069aaa53549ba4381e9fa446)
- (cloud) per-ankh CLI for local dev (worker + sveltekit) — [efd22d1](https://github.com/becked/per-ankh/commit/efd22d17bfea3aff1ad6749c8529f6944c5dfaf7)
- (cloud) gate login to a single Discord ID for initial release — [ba6cbe2](https://github.com/becked/per-ankh/commit/ba6cbe2ec9953837eb1d374963343b9a3f2e26e3)
- (cloud) move anon-read rate limit from Cache API to D1 — [cb8cb0e](https://github.com/becked/per-ankh/commit/cb8cb0ec6e41ded4763b663f0c00d594c8c285b1)
- (games) bulk reparse for games on older parser versions — [60aee1c](https://github.com/becked/per-ankh/commit/60aee1c95743274be3718de5ffc130b2573b9d2f)
- (cloud) port game sidebar + collections to /dashboard — [0f71782](https://github.com/becked/per-ankh/commit/0f71782fc5e72cea52970bfda4da0f8242c21814)
- (cloud) resizable sidebar + auto-hiding thin scrollbars — [93780c3](https://github.com/becked/per-ankh/commit/93780c376e87e88ac808262e314e80a7130435a0)
- (cloud) structured JSON logging + CSP report endpoint — [06e88b6](https://github.com/becked/per-ankh/commit/06e88b613b84dcdcc2491ac651c4a5dd838e52ee)
- (cloud) close audit-log gap on auth + online-id endpoints — [0dd72f5](https://github.com/becked/per-ankh/commit/0dd72f50b2bb1b4298c64714d65115f084a09b8d)
- (cloud) remove Tauri runtime — [f97c09a](https://github.com/becked/per-ankh/commit/f97c09ae51acac4408259edf3c281ea168845f94)
- (cloud) rebuild app header and inline game-detail actions — [280f4e0](https://github.com/becked/per-ankh/commit/280f4e0621ed75f424c1d40e2937cd68047b103f)
- (cloud) restyle auth surface and unify login terminology — [e5b2098](https://github.com/becked/per-ankh/commit/e5b2098f50e25482a3aefe3498654059e337a200)
- (cloud) hide sidebar and search on non-owner game pages — [f657f60](https://github.com/becked/per-ankh/commit/f657f60b4dc3357be7acb7adb7f5e10fd0c1524a)
- (cloud) restyle game-detail summary strip to match overview cards — [cd1cc90](https://github.com/becked/per-ankh/commit/cd1cc905525c4ea7ff447ae29227e2a333767878)
- (cloud) cross-filter sidebar from dashboard nation and calendar charts — [a129416](https://github.com/becked/per-ankh/commit/a1294161999c38a018bb7eb3a68e23f55a4478d6)
- brand favicon, OG card, and unfurl metadata — [4afb177](https://github.com/becked/per-ankh/commit/4afb1778ca26119eed73a12d39ae267dd88dd482)
- (cloud) restyle dashboard to match game-detail charts — [d49f4ab](https://github.com/becked/per-ankh/commit/d49f4ab5917646b2316e9faffa90c053ad30da9c)
- (cloud) gate login on Discord username allowlist — [7541f07](https://github.com/becked/per-ankh/commit/7541f070c2f7a38dffd28807ce4746e47d2b0ae2)
- (cloud) restyle upload flow to match card pattern — [dba7dd5](https://github.com/becked/per-ankh/commit/dba7dd5ef0cb1022c863784ee0580183b4c16b07)
- (cloud) tighten header menu and clarify Upload label — [7aeb9a8](https://github.com/becked/per-ankh/commit/7aeb9a844da13438fd05f4dcffa15c7f2c736804)
- (cloud) hieroglyph parade band on upload surfaces — [198f5ff](https://github.com/becked/per-ankh/commit/198f5ff15e3286884ec515dad70d286436edd8f8)
- content-hash atlas and sprite assets for immutable caching — [373ce65](https://github.com/becked/per-ankh/commit/373ce65de7693a37f7c2806a3b4d3f6a19536795)
- (cloud) redirect /share/* to legacy.per-ankh.app — [b49400d](https://github.com/becked/per-ankh/commit/b49400d863f3731a70ad4c091c041a846cf54246)
- (cloud) redirect signed-in visitors at / to /dashboard — [dedeef1](https://github.com/becked/per-ankh/commit/dedeef17e4d653f51cd9954bdbc3ce6dcee48aaf)
- (prod) add ./per-ankh prod deploy & preflight CLI — [25bec18](https://github.com/becked/per-ankh/commit/25bec1883ba6fa2138881f319e1c06bed0a85a18)
- (ui) add collection button to game detail actions — [e4a2b97](https://github.com/becked/per-ankh/commit/e4a2b97c40c783ac2d022bdb17afe0e760cffcce)
- (techs) use OW XML display names for tech labels (closes #32) — [8e26cd6](https://github.com/becked/per-ankh/commit/8e26cd6c299298326637880cb49f186e5e3fdad8)
- (tournament) full first pass — schema, worker, frontend, CLI — [8de96ff](https://github.com/becked/per-ankh/commit/8de96ffd31598693b42df6e3b3470f2223339aff)
- (auth) gate Discord login on OW guild membership — [6b6b891](https://github.com/becked/per-ankh/commit/6b6b891bd32d5ce2fcceb074b686e84a63b6ae98)
- (tournament) enforce swiss_seed NOT NULL for swiss-phase slots (#22) — [aeaea48](https://github.com/becked/per-ankh/commit/aeaea48e9404d3f9c1a1ff00010f54e620f7b007)
- (auth) replace Discord-guild gate with invite-code passphrase — [a12d6cd](https://github.com/becked/per-ankh/commit/a12d6cd7f5fa164d9fb7020fa3381de40099fa96)
- (header) list user's tournaments and admin tournaments in the menu — [ba62f9a](https://github.com/becked/per-ankh/commit/ba62f9ad1dec1211d4e2d3e752312f9f6d6eca8c)
- (tournament) replace stacked tables with W-L flow and SVG bracket — [336c5af](https://github.com/becked/per-ankh/commit/336c5af61fe5f6dddd3aaceaea1b368470b99241)
- (header) add upload icon, sync search width to sidebar, balance vertical padding — [482c0cd](https://github.com/becked/per-ankh/commit/482c0cddda19245304bb12ceb8fc87011f1894e2)
- (tournament) auto-advance rounds, collapse admin lifecycle to two gates — [ad25f08](https://github.com/becked/per-ankh/commit/ad25f08a11c370c3be1e683b6c9cf98a7a5f0a93)
- (tournament) collapse admin/match routes into modal-driven public page — [5972110](https://github.com/becked/per-ankh/commit/59721104f857ecb8db52d58569005e3349bab5f5)
- (tournament) let admins set match results without a save upload — [c1d9baf](https://github.com/becked/per-ankh/commit/c1d9baf3658a16f76e8be303d63ffe46d1299577)
- (tournament) show first pick and map name in swiss bracket cells — [19d7bf9](https://github.com/becked/per-ankh/commit/19d7bf93a03347354924eff2279a53dc0312620e)
- (tournament) create tournaments from the UI — [ddfb3d0](https://github.com/becked/per-ankh/commit/ddfb3d0d1ecd1a49152c01000444e719fc68daa0)
- (game-detail) show uploader nation in title and add Winner panel — [673329c](https://github.com/becked/per-ankh/commit/673329c030b69773793249d508ee1a19a3f990fb)
- (tournament) drag-and-drop reorder of swiss-phase slots — [c04ae02](https://github.com/becked/per-ankh/commit/c04ae0261023c10b7e8b5559501b095bd22ac286)
- (tournament) admin-only setup phase with inline auto-save panels — [5542c07](https://github.com/becked/per-ankh/commit/5542c07d54aef228bb448df96519999e55884c63)
- (tournament) admin-configurable per-script map options — [535cf38](https://github.com/becked/per-ankh/commit/535cf38d66b3066ddef67037a976f12fdd6e50f7)
- (tournament) private-beta allowlist gates every tournament surface — [457e406](https://github.com/becked/per-ankh/commit/457e4062d594f085e91ebd4ca31cd9528fbccac9)
- (tournament) expose map size and aspect ratio per script — [aaada5e](https://github.com/becked/per-ankh/commit/aaada5e60952d5812a07085d00b30379e03635bd)
- (tournament) show championship bracket above swiss brackets in championship phase — [bdbbdf5](https://github.com/becked/per-ankh/commit/bdbbdf5977d64a29700881aceba10fbcb69886cf)
- (tournament) drop cutoff, everyone with N wins qualifies for bracket — [bc4ad57](https://github.com/becked/per-ankh/commit/bc4ad57d9c71d25f5fdbbe546d2c963595a3769a)
- (map) add overlay zoom/fit controls to SpriteMap — [37d0884](https://github.com/becked/per-ankh/commit/37d088469ed0659ba366cf9fab8be79bc5818f0d)
- (admin) dev-login CLI for local 2nd-user testing — [183a66f](https://github.com/becked/per-ankh/commit/183a66f34ca691cdbd4a87d167ba96385c6fbc92)
- (tournament) self-signup + slot autocomplete — [3e17654](https://github.com/becked/per-ankh/commit/3e176547f1bd450b345fb8e6b7a388a02debe1f7)
- (ui) styled error page matching app chrome — [1bbc449](https://github.com/becked/per-ankh/commit/1bbc4498e8b9ababc5ace6092a8b6cdd76234fa1)
- (home) rebuild home as public discovery feed — [966eda8](https://github.com/becked/per-ankh/commit/966eda84117e7a20b3c8bd0d454dcf653464aac9)
- (dashboard) remove My Tournaments section — [fb36e86](https://github.com/becked/per-ankh/commit/fb36e864fdd490bbc547101f0119deed81311874)
- (header) label the upload button "Upload" alongside its icon — [6181b1f](https://github.com/becked/per-ankh/commit/6181b1f829c447255244443447116da622bf8527)
- (game-detail) surface uploader identity when save has no leader name — [6bfe91b](https://github.com/becked/per-ankh/commit/6bfe91b301d306d006895f31bd62c7b1366c0553)
- (tournaments) rebuild listing with RecentSaveCard-style row cards — [64b8d95](https://github.com/becked/per-ankh/commit/64b8d95231260dd3f639490ea6c1ff84b02d28d9)
- (tournaments) simplify create modal to name + description — [d5df9bc](https://github.com/becked/per-ankh/commit/d5df9bc0a914ab3d8ebda3d6ad164ea4d72e4065)
- (home) replace generic player icon with uploader's Discord avatar — [512851d](https://github.com/becked/per-ankh/commit/512851d1845ca284eb8a428fe718651c33db2d8b)
- (prod) auto-generate changelog entries and deploy/* tags on deploy — [05b8f81](https://github.com/becked/per-ankh/commit/05b8f817f1b5c4b03e59b189658572b536df152e)
- (games) owner-editable save titles + server-side nation fallback — [136db32](https://github.com/becked/per-ankh/commit/136db32cd75138bd0a41fa57232014644a3453cb)
- (home) replace prose hero with bulleted feature list — [5a0e946](https://github.com/becked/per-ankh/commit/5a0e94681e13f732085a13c28db6765791964657)
- (home) add Difficulty to recent-game cards — [af7a312](https://github.com/becked/per-ankh/commit/af7a31296aceffc6c528ed1b5cd4c581d1d85284)
- (account) add Reparse-all button to user settings — [2a5551f](https://github.com/becked/per-ankh/commit/2a5551f5ce199dcc660be53961a8b52c13f151cb)
- (admin) /admin/reparse page for global parser sweeps — [9e36e4d](https://github.com/becked/per-ankh/commit/9e36e4dde984321e4ec0e9e50dd778a49825d083)
- (home) show Multiplayer label on MP game cards — [e6fca12](https://github.com/becked/per-ankh/commit/e6fca121d0f5f91f9a0979ac375a6cb6a2e0431c)
- (home) include AI players in recent-game card sparklines — [a1b1f31](https://github.com/becked/per-ankh/commit/a1b1f31f8d5a0e17cf3a60d5a4b48e2ef8dc953e)
- (home) add game title to recent-save cards and fix MP detection — [0d6f73b](https://github.com/becked/per-ankh/commit/0d6f73bb3cc1da452d3d13a9668faa276413f3c6)
- (dashboard) server-paginated sidebar with URL-driven filters — [77b55a4](https://github.com/becked/per-ankh/commit/77b55a430cf2ae05f59720e01386f21c0753cb08)
- (users) user profile with scoped library + aggregate stats — [cc9fcd0](https://github.com/becked/per-ankh/commit/cc9fcd0bd268be9009e9f1bb8a76d7467c2e8a43)
- (home) link profile card to library, add stat boxes and dark-theme panels — [9e79aff](https://github.com/becked/per-ankh/commit/9e79aff33795e807f69b00e0de7c79ac5f26ac7b)
- (game-detail) restyle tabs and tables to the games-table theme — [1cc6661](https://github.com/becked/per-ankh/commit/1cc6661228e82e7476d23779babb59090f4c9624)
- (scripts) anonymous UX-review screenshot walkthrough — [e71c974](https://github.com/becked/per-ankh/commit/e71c9744aa8159bceda6c32a9fedbe67642ef063)
- (game-detail) label the visibility toggle Public/Private — [c425c74](https://github.com/becked/per-ankh/commit/c425c74cfe813f6e41a548e85ff0d0c5a3be0de8)
- (account) public-by-default uploads with per-user override — [3fce53e](https://github.com/becked/per-ankh/commit/3fce53e4c7b6c6a67e794469bc02efa4bccabf01)
- (home) rework header and home page for signed-out discovery — [d0b7234](https://github.com/becked/per-ankh/commit/d0b7234fbf7928ff6bf728fa7146e1fc036882d1)
- (nav) add breadcrumb trail to game, tournament, and user pages — [4f12f25](https://github.com/becked/per-ankh/commit/4f12f25d2b9071df262e0b9c7892f1177a923535)
- (scripts) UX review as navigable folder bundle with auth + responsive passes — [68a2fe8](https://github.com/becked/per-ankh/commit/68a2fe886eff084600e4abeea1d922ce96ba9203)
- (settings) match overview card styling and add nation/religion icons — [e12e39f](https://github.com/becked/per-ankh/commit/e12e39f152154d76e642912cbe1cb255c28b9093)
- (game-detail) drop red from upload date, Turn label, and map status — [2639620](https://github.com/becked/per-ankh/commit/2639620dead4131afcd5f115e35625c4bdff056e)
- (users) replace native date filter with styled bits-ui date picker — [5048571](https://github.com/becked/per-ankh/commit/504857183f71b83a1b92f4d280041fb667281488)
- (ui) add shared styled UI primitives (select, checkbox, radio, toast, confirm) — [d3787d2](https://github.com/becked/per-ankh/commit/d3787d2a78d55854b0f6a97770ec1b4530823120)
- (home) add Discord sign-in CTA and saves heading to anon hero — [546d2e3](https://github.com/becked/per-ankh/commit/546d2e32f4871d58fdf9b4762caf1f1eb45a8ceb)
- (header) left-align wordmark, move menu right, collapse search to icon — [52a69b4](https://github.com/becked/per-ankh/commit/52a69b491f5b38fb1f466d278f0a398b9c31f11e)
- (upload) redesign nation picker as cards in the dark UI scheme — [c7609f9](https://github.com/becked/per-ankh/commit/c7609f96b26885e37f0c74ba66700f96b022653c)
- (upload) return to the originating page after upload — [3ca856c](https://github.com/becked/per-ankh/commit/3ca856c4b3a748b646d2a74bcbe2fd0e62122e75)
- (tournament) surface Mirror as a per-script map option — [4f99b98](https://github.com/becked/per-ankh/commit/4f99b9815d0fcbac02cadf6e92c293e1dea7fbe2)
- (tournament) model the map pool as instances with per-map options — [a5b2e7b](https://github.com/becked/per-ankh/commit/a5b2e7b9446d080bf44d43e45012103fbfc60d46)
- (tournament) rebuild bracket-seeding cascade as 6 tiers — [6d28aff](https://github.com/becked/per-ankh/commit/6d28aff3bef0c344d0239630422ce22069d04b65)
- (tournament) seed round-1 Swiss pairing by swiss seed — [87fc065](https://github.com/becked/per-ankh/commit/87fc06597e0d021821c6de20e55ae875e15845c4)
- (tournament) always-available guide and header cleanup — [0fab4d1](https://github.com/becked/per-ankh/commit/0fab4d109a580ea3dd61504edd38793b5b6bb40c)
- (tournament) drop the per-division help icons — [75ed878](https://github.com/becked/per-ankh/commit/75ed878f4020d6f9377df742e231feb461988b97)
- (auth) remove invite-code gate, open sign-up to all — [54b55e2](https://github.com/becked/per-ankh/commit/54b55e2280b09a0d73e3408a1d52cb1cd1c0353d)
- (tournament) redesign match modal, bracket map labels, and settings maps panel — [a84b51e](https://github.com/becked/per-ankh/commit/a84b51e4683db08a5cb2bf2f93d95673a98f48a7)
- (tournament) align championship bracket UI with Swiss redesign — [cfa2163](https://github.com/becked/per-ankh/commit/cfa2163be70fe6528ca3dcf9245620cccf5a816f)
- (tournament) move status chip below the nav trail, label it — [f1c2252](https://github.com/becked/per-ankh/commit/f1c2252ffc43e14b99f0d167174ad1a3fbecc63f)
- (tournament) redesign detail header with per-status hero strips — [a248b02](https://github.com/becked/per-ankh/commit/a248b028aff7d41ac1851fd08e710ff0f0240ecd)
- (tournament) render full championship bracket with TBD placeholders — [522ddf1](https://github.com/becked/per-ankh/commit/522ddf15236156faa089910220c24945729af98a)
- (tournament) anti-repeat maps by base script, not pool instance — [d4015d1](https://github.com/becked/per-ankh/commit/d4015d10fac11212d3d4bfad89b1c3146804104e)
- (tournament) move the guide from a modal into a paneled page — [cf4d0c0](https://github.com/becked/per-ankh/commit/cf4d0c007035c019c395126b29bbda1886419dde)
- (tournament) show player avatars in front of names — [7d18417](https://github.com/becked/per-ankh/commit/7d184172dd82bed28b6ca2dbb791f4ec1d2036eb)
- (tournament) replace modals with bits-ui popovers — [eb057e5](https://github.com/becked/per-ankh/commit/eb057e5fecb2cc374e5f42787e7250d6f56cd237)
- (tournament) lead map names with aspect ratio before size — [861a095](https://github.com/becked/per-ankh/commit/861a095ef86e3aa03208c35e40d7516df95e515c)
- (tournament) let admins add maps to a running tournament — [7a67145](https://github.com/becked/per-ankh/commit/7a671454de0f5be33658ba90e156ca87aa9a31b1)
- (games) plot victory points in card sparklines, add admin reindex — [3356fb7](https://github.com/becked/per-ankh/commit/3356fb783512614ebf89b017da44202784b3cdd4)
- (admin) add delete-game and purge-games commands — [cbb4ebd](https://github.com/becked/per-ankh/commit/cbb4ebda8efa5f2da20a629898d5192590061cfe)
- (home) order recent saves by save date instead of upload date — [45609ef](https://github.com/becked/per-ankh/commit/45609ef37c60702d730aba25ec9a1c880c16bb2e)
- (home) link game card uploader to their profile — [df29275](https://github.com/becked/per-ankh/commit/df292758803def3c13726d593b93c86ad70ddf4e)
- (improvements) bake real in-game improvement names from XML — [b6d49a5](https://github.com/becked/per-ankh/commit/b6d49a53684dd08ca704aa5ea36b6d9661c6b03d)
- (tournament) in-app admin management, delete, signup question, themed date picker — [f96b04b](https://github.com/becked/per-ankh/commit/f96b04b1503b119c85ce928a04175a8abd46b47d)
- (tournament) snapshot slot occupant at report time, surface substitution in bracket — [b73da27](https://github.com/becked/per-ankh/commit/b73da2778eb881c196bf56a3b412636a190078f2)
- (tournament) link substituted players to accounts and auto-claim slots — [f288bbf](https://github.com/becked/per-ankh/commit/f288bbfd3a704dda42eea9d7af0220e0ad7ca4a3)
- (tournament) toggle bracket diagram and standings within a card — [b255700](https://github.com/becked/per-ankh/commit/b255700918a2801856ba33b0f6852e721494e84a)
- (tournament) default Swiss groups to standings during championship — [2a13ace](https://github.com/becked/per-ankh/commit/2a13ace18bc0df66dba4d032096f3594a990da84)
- (tournament) animate the diagram/standings switch and panel swap — [3e5e376](https://github.com/becked/per-ankh/commit/3e5e376d92e2a2ae3e0b561d094844c247539fbd)
- (tournament) rework championship standings to seed/player/round — [867d604](https://github.com/becked/per-ankh/commit/867d6046a034d81732092123e7d059cb83ce75e6)
- (tournament) highlight champion/runner-up names and brighten completed header — [d0b2c64](https://github.com/becked/per-ankh/commit/d0b2c64f26efc5c8d61234f0312c411b89f1db56)
- (cli) add `./per-ankh backup` to snapshot D1 to a SQLite file — [65d3f0f](https://github.com/becked/per-ankh/commit/65d3f0f10b0c9289853357abfe1bd80f6477f4de)
- (tournament) add admin CSV export of standings + matches — [0f35534](https://github.com/becked/per-ankh/commit/0f35534c516081745b62d02948f323ac475b00cc)
- (tournament) tighten swiss bracket columns and add hover path-trace — [65c5544](https://github.com/becked/per-ankh/commit/65c5544b6b0f10ed1ecef104f0113007c250062f)
- (tournament) trace a player's path through the swiss bracket on hover — [e0c1974](https://github.com/becked/per-ankh/commit/e0c1974891784ba8d5f9ec63b52e15e32a2f5b63)
- (tournament) widen swiss round columns and center the bracket — [a01c3ab](https://github.com/becked/per-ankh/commit/a01c3ab5f7fb3e15ff660ef1216414cdbf0ec2ff)
- (tournament) rework match popover and add nation crests — [c7a3a88](https://github.com/becked/per-ankh/commit/c7a3a88c933104c7c1414ae3918a3548a49a7fc8)
- (tournament) refine match popover map control and layout — [c4d4b75](https://github.com/becked/per-ankh/commit/c4d4b757da96f9fc29e56dfc7816d6da144e9e21)
- (tournament) add local fixture seeder CLI — [72536f2](https://github.com/becked/per-ankh/commit/72536f2d60a3ed81476241803b3b9cbc2b6ed8e4)
- (tournament) schedule matches with time, stream, and caster — [bed2e4b](https://github.com/becked/per-ankh/commit/bed2e4bc6ea92521041bbfac8dc347c90da2e7db)
- (tournament) let admins self-sign-up and refresh signup UI — [1a82abc](https://github.com/becked/per-ankh/commit/1a82abc5c5c245d1424bce1ced1763671d6ed00d)
- (tournament) let admins edit a player's signup answer on the slots panel — [1c1656a](https://github.com/becked/per-ankh/commit/1c1656ad0e219d9b82c3a67a4f61335b14561a13)
- (tournament) show match times in the viewer's local timezone — [b666d2c](https://github.com/becked/per-ankh/commit/b666d2cb8f88d17f8ed103f391fe0a7453c51c6e)
- (tournament) add matches page with sortable table and calendar — [7036562](https://github.com/becked/per-ankh/commit/7036562cf34685fcf3fa00ba3bb2776317705ae0)
- (tournament) restyle match card caster/stream into a single link — [ce1f244](https://github.com/becked/per-ankh/commit/ce1f244d4444c8405cdfce4f29c370d4efe21c79)
- (tournament) simplify swiss standings columns — [554621d](https://github.com/becked/per-ankh/commit/554621d299b98de046a6b00f7281d66e51a25ee0)
- (map) render rivers on the hex map — [1b028d0](https://github.com/becked/per-ankh/commit/1b028d016b1129a4f1db1ef2b6fb1d2b34447819)
- (map) outline contested/unowned cities on the map — [dfdf8de](https://github.com/becked/per-ankh/commit/dfdf8de48b5dd2d20d02d6dd9e307df231a2ff79)
- (game-detail) add optional Founder column to cities table — [9243edd](https://github.com/becked/per-ankh/commit/9243edd66d5d16e9315ddb08d80b9b0388eaf337)
- (tournament) open tournament feature to the public — [5e19cb4](https://github.com/becked/per-ankh/commit/5e19cb49353bbfbacce0fae4453748fde99256d7)
- (staging) add staging environment with deploy CLI and separate resources — [b6b07ca](https://github.com/becked/per-ankh/commit/b6b07ca943b0e5cca44accc280e92a854927be0b)
- (tournament) label players by display name everywhere — [6eb9259](https://github.com/becked/per-ankh/commit/6eb9259f533a21ac4cba0ab06149e7462ef605df)
- (staging) add prod → staging reclone command (D1 + R2) — [293a30b](https://github.com/becked/per-ankh/commit/293a30bc1c7cde4e046428dc24711905ca2a8630)
- (cloud) add nightly events retention cron — [43023d7](https://github.com/becked/per-ankh/commit/43023d7a33f2203ad4440f83ecc73d139c4f51f7)
- (cloud) emit security_events tee draining to Skiff (#71) — [6db5f4e](https://github.com/becked/per-ankh/commit/6db5f4e43ac48d449e7846f48c3a86781ccd5cfa)
- (tournament) add admin-editable links with a Links menu — [3002d75](https://github.com/becked/per-ankh/commit/3002d754969690db1c236f814f912879ed599920)
- (game-detail) correct setting names and add a Map Settings panel — [00e6454](https://github.com/becked/per-ankh/commit/00e6454523c503668622962e20de807236a3c85a)
- (game-detail) add Specialists tab — [a3a7666](https://github.com/becked/per-ankh/commit/a3a7666a26e36f442586783573894a02ebf8fb66)
- (parser) extract leader fields + ratings, bump PARSER_VERSION 2.8.0 — [2dcd04e](https://github.com/becked/per-ankh/commit/2dcd04e46c684ab122d3a16f46ae74a0e3e3e27f)
- (assets) bake leader-archetype, rating, and ambition icons — [ec96f63](https://github.com/becked/per-ankh/commit/ec96f632826605d629263004b9bcb1e80f2a9243)
- (game-detail) add Leaders tab; move legitimacy chart from Events — [77d4d30](https://github.com/becked/per-ankh/commit/77d4d30375d9582a6b369dac9f62f399e272e46a)
- (game-detail) leader portraits, ambition names, and detail-panel polish — [abdf977](https://github.com/becked/per-ankh/commit/abdf977ce3bbe5be986311eba0399a247b603e5a)
- (game-detail) replace succession ribbons with leader cards + detail popover — [eee1824](https://github.com/becked/per-ankh/commit/eee1824eccceafd31a94c54e08262f73153d56c3)
- (game-detail) show leader regnal numerals (e.g. "Meera II the Fountainhead") — [be830b9](https://github.com/becked/per-ankh/commit/be830b921ea6ee9a1c28b2b582ba97191d76d042)
- (tournament) admin-initiated mid-tournament player withdrawal — [48a2026](https://github.com/becked/per-ankh/commit/48a20261e61993c9c038a974f06191f152efadf7)
- (account) reparse individual saves from Settings -> Maintenance — [f25ef68](https://github.com/becked/per-ankh/commit/f25ef6812ca22e5ff9f46b7064acb8711d13e15c)
- (game-detail) law table shows full adoption history; swap-aware tooltip — [b9c8f9a](https://github.com/becked/per-ankh/commit/b9c8f9af5817e84ce0b5124749e4998a6cfb2035)
- (deploy) assert frontend bundle API origin after build — [0791f86](https://github.com/becked/per-ankh/commit/0791f86c7517af2670335076e1366d96e6845159)
- (users) make Overview calendar cells clickable — [f3c0922](https://github.com/becked/per-ankh/commit/f3c0922fa8e1838b3325202fe2e7faa87aee4dcb)
- (admin) add find-user subcommand to search users by handle/name/email — [8e4b718](https://github.com/becked/per-ankh/commit/8e4b718cb058fb0ae48f1204bc1efdbac2249560)
- (tournament) compact map-config labels across the map pool — [03e012c](https://github.com/becked/per-ankh/commit/03e012cfe1bd3ef5fb360980a338998da6938a19)
- (tournament) name the in-game Map Script in the options editor — [bed6cee](https://github.com/becked/per-ankh/commit/bed6cee3e04b570d961581295ec9cd3d35d24963)
- (users) operator-set display alias overriding Discord name — [e9925a3](https://github.com/becked/per-ankh/commit/e9925a343aeb89f0b2e2bddf49f96cc2bb6e0a8c)
- (game-detail) head-to-head matchup view on the Military tab — [2a76cd9](https://github.com/becked/per-ankh/commit/2a76cd9571ff632ddef5467cf7fb7516f041a850)
- (skills) add doc-audit skill — [89d5d4b](https://github.com/becked/per-ankh/commit/89d5d4b70439557f0b651e82d1e2e832a4047387)
- (military) rework event rail into per-kind rows — [a4df8be](https://github.com/becked/per-ankh/commit/a4df8be165338371511da634561364862b654330)
- (military) grid the event rail to the power chart's x labels — [647c74a](https://github.com/becked/per-ankh/commit/647c74a3a10a5788af34066a86ee56c17dd41361)
- (military) unit icons for tech markers, merge overlapping ones — [25b47c0](https://github.com/becked/per-ankh/commit/25b47c0487e41cd95ac79eb805c2adecf5e4cae7)
- (military) use each law's own icon for event-rail law markers — [b28405f](https://github.com/becked/per-ankh/commit/b28405fec8182c00c40d268d90669c965a47618d)
- (military) restyle head-to-head build boxes inline with app — [31ef3a9](https://github.com/becked/per-ankh/commit/31ef3a970b7de9a14e84f8365ed5305905b17255)
- (military) align build panels on a shared unit-row order — [436f9ad](https://github.com/becked/per-ankh/commit/436f9ad717974da4656d2cf182a955c1552c8404)
- (tournament) rework matches list columns and add caster filter — [fe26995](https://github.com/becked/per-ankh/commit/fe26995a77d9426e08afbdd08e5124533636b34c)
- (home) add 2026 tournament banner and reorder mobile sections — [18f6fb3](https://github.com/becked/per-ankh/commit/18f6fb339b3c85c9ca722583c7166e1d943560ee)
- (tournament) match parts — per-sitting schedule, casters, VODs — [256afbf](https://github.com/becked/per-ankh/commit/256afbf7f5eb525de92bc7fc0716042c264c6a5e)
- (tournament) surface upcoming matches in an overview panel — [31eb4a6](https://github.com/becked/per-ankh/commit/31eb4a608c3777984f023afa9331cb4ddf4efeb4)
- (scripts) add `restore --local` to load a D1 backup into local dev — [17c088f](https://github.com/becked/per-ankh/commit/17c088ff5079448c4a0d5d0aa8b13575244d8c64)
- (tournament) refine upcoming-matches panel — [34951a2](https://github.com/becked/per-ankh/commit/34951a2b63e21e21cf2474e83f34fc05c715226b)
- (tournament) refine match popup casting layout and matches list — [d7f31c4](https://github.com/becked/per-ankh/commit/d7f31c40d2968a4a66723512d1651dbe0f236c47)
- (tournament) persisted global match numbers — [0d19a44](https://github.com/becked/per-ankh/commit/0d19a4430dbe99a9b85b8351b19d6d86a2f69dc2)
- (tournament) admin copy tools — DM, thread title, sesh export — [7692395](https://github.com/becked/per-ankh/commit/76923951b6967d97aa5e0587c4f3cceb88c11a08)
- (tournament) show the Match N badge on championship bracket cards — [166c942](https://github.com/becked/per-ankh/commit/166c942306b4e5ff99cddc41d2a66834576dd42f)
- (tournament) caster self-service + Cast view with shareable filters — [145da4c](https://github.com/becked/per-ankh/commit/145da4ce1d934ed94d51fd5fff898274a8aba120)
- (tournament) copy button for matches still needing casters — [67fdc28](https://github.com/becked/per-ankh/commit/67fdc2846ad7a6fe2cb4e0a28ee0a8d39bc1bb69)

### Fixes

- (bake) run sprites before crests in bake:all — [9b49f6e](https://github.com/becked/per-ankh/commit/9b49f6ec7e42ac7554be3c54abd6c3c059b8f4b9)
- (cloud) drop owner Cache-Control to no-store — [466e062](https://github.com/becked/per-ankh/commit/466e062d5347a26f673de7feac45f0bc33ba3ece)
- (cloud) assert CF-RAY on rate-limit paths, document CSRF stance — [42623ee](https://github.com/becked/per-ankh/commit/42623ee297ea416db2768c696ea334294b7fcbbe)
- (cloud) deep-walk OnlineID strip; document OAuth callback race — [f6c551f](https://github.com/becked/per-ankh/commit/f6c551f23458f88b8e5a62954f7062c57bb88826)
- clear pre-existing lint errors — [2fafe9c](https://github.com/becked/per-ankh/commit/2fafe9c235643c13ca260f3901d9b27c0d1bcb74)
- (cloud) drop public-read s-maxage from 1h to 60s — [4c7f829](https://github.com/becked/per-ankh/commit/4c7f829f2bbaf2d62237b1fb79420c8e7827c971)
- (parser) detect legacy winner XML formats + accept GameOver-only saves — [b59452b](https://github.com/becked/per-ankh/commit/b59452bb347824c433a731950a6f5cfef81059e2)
- pin SvelteKit dev server back to port 1420 — [a86a246](https://github.com/becked/per-ankh/commit/a86a246cef3cc7a3779f2fa92276b1b3b47a6342)
- (cloud) skip Discord consent screen for returning users — [f6b67c3](https://github.com/becked/per-ankh/commit/f6b67c301d781f9892891d4c79fda1a14fdddbae)
- capitalize Save Analytics in default page title — [f6fc674](https://github.com/becked/per-ankh/commit/f6fc6749c957b1adec1b5567fdbcb8d4d5a87650)
- (cloud) parade borders and static row span full band width — [f6ff7dd](https://github.com/becked/per-ankh/commit/f6ff7dd927210e4d6d631e3252c954755af44a20)
- (cloud) share session cookie across per-ankh.app subdomains — [f25db39](https://github.com/becked/per-ankh/commit/f25db39261654e7753a235812a6e62149ab5bdd2)
- (cloud) read meta from merged page data, not layout data — [674a4aa](https://github.com/becked/per-ankh/commit/674a4aac0549da5a0c6fddf311b3cfa7342a4d95)
- (csp) allow Cloudflare Web Analytics beacon — [698fd78](https://github.com/becked/per-ankh/commit/698fd78f6267705950882a9901917cb58dcc5601)
- (cloud) hide download action for anonymous viewers — [14c1bb3](https://github.com/becked/per-ankh/commit/14c1bb374cc5bd3a8b1973bfefee57381cecd1ce)
- (web) default missing array fields in older share blobs — [00e83d3](https://github.com/becked/per-ankh/commit/00e83d34d4c820e810899a3508227e36fb4f3d1d)
- (cloud) bump upload rate limits and promote to wrangler vars — [b19004e](https://github.com/becked/per-ankh/commit/b19004e6391552be271864aba0e9a6f202817edf)
- (cloud) point legacy CORS at legacy.per-ankh.app + Vary: Origin — [161d91c](https://github.com/becked/per-ankh/commit/161d91cccefa63da366f4e8cf7861682e99fc6c1)
- (cloud) point header wordmark to / for anonymous viewers — [c7389c2](https://github.com/becked/per-ankh/commit/c7389c2af71e082644bc0189e9ed58e4e5996a12)
- (cloud) hard-reload on logout to avoid stuck state — [f295d20](https://github.com/becked/per-ankh/commit/f295d200bfa67ac3fa9559cc8ce97c5582220317)
- (ui) rename ReimportButton state → status to unblock svelte-check — [616832c](https://github.com/becked/per-ankh/commit/616832ced680349184c1570b1b410637c467f290)
- (csp) detect dev via argv, not NODE_ENV — [5e5e47f](https://github.com/becked/per-ankh/commit/5e5e47f4d015650aba3f0961b446bad1caaea19c)
- (cloud) gate session cookie Domain on HTTPS, not request URL host — [3a166ed](https://github.com/becked/per-ankh/commit/3a166ed4d2407453f17d8c82052f6bb3f57c8c2a)
- (ui) collapse /login into /, refresh layout after OAuth callback — [9215618](https://github.com/becked/per-ankh/commit/92156189c808ec920b0fe2290ab6b00550df4f9f)
- (lint) drop unused svelte-ignore rule from GameActions popover — [5b7bdf9](https://github.com/becked/per-ankh/commit/5b7bdf9050f87ff74a7fe87f21d2bc1b02758da5)
- (tournament) authz + data-integrity bundle (#1, #2, #3, #4, #5, #7, #8, #10) — [56923f4](https://github.com/becked/per-ankh/commit/56923f47c1de3a853a9a4cae958a435c519ef376)
- (tournament) worker invariants + error shape (#6, #9, #14, #21, #23, #24, #25, #26) — [2303253](https://github.com/becked/per-ankh/commit/230325364a6d62138b1fab341d08ed5cff57cfab)
- (tournament) UI bugs in admin + components (#13, #14 UI, #15, #16, #18, #19, #31, #32) — [dab2251](https://github.com/becked/per-ankh/commit/dab2251735acc7a59a089e3e76503c12b336a85a)
- (tournament) bulk upload observer mode for 3+ humans (#17) — [cf3d8c1](https://github.com/becked/per-ankh/commit/cf3d8c1b6e6a34fb814fa386506315a420435f99)
- (api-cloud) tighten tournament client types + cloud typecheck (#11, #12, #30) — [5c73729](https://github.com/becked/per-ankh/commit/5c73729352936096d731491e585374a36992156e)
- (admin-cli) tournament command polish (#27, #28, #29) — [150b6eb](https://github.com/becked/per-ankh/commit/150b6eb296abdb52aca9cf2339f13d021b3ae604)
- (admin) validate map_script values when creating tournaments — [a36d10e](https://github.com/becked/per-ankh/commit/a36d10ef790a1367e3647ea1b8e1c1895e7a5a81)
- (games) lock out delete of tournament-linked saves — [13b3f08](https://github.com/becked/per-ankh/commit/13b3f081f9480a99ac49ce76e29a04df8aa03e13)
- (deps) bump svelte to 5.55.7 and devalue to 5.8.1 — [d9559cc](https://github.com/becked/per-ankh/commit/d9559cc875ff1b97a11683337841d56ee9c70456)
- (csp) detect dev via PER_ANKH_DEV env var, not process.argv — [3a706f2](https://github.com/becked/per-ankh/commit/3a706f2432d4bfbe899fe2b5e05456b68e34414b)
- (tournaments) redirect anonymous visitors to login — [b2e6edd](https://github.com/becked/per-ankh/commit/b2e6edd2d6d57d14d8ff96552d10a086b0f91593)
- (auth) default post-login redirect to / and refresh redirect call sites — [0f852e6](https://github.com/becked/per-ankh/commit/0f852e668533140e750dd7fdb35004048229af77)
- (game-detail) show winner in header when name is empty — [d05be0b](https://github.com/becked/per-ankh/commit/d05be0b38909754c75b10694f28559a60810399c)
- (csp) patch dev CSP at SSR time instead of in svelte.config.js — [04b117b](https://github.com/becked/per-ankh/commit/04b117b1f79778769ff9c4a96e3dab2795f8a898)
- (error-page) point home link at / and add a Go back option — [e72104a](https://github.com/becked/per-ankh/commit/e72104a8d01fbc1d9cc9820aae74cfae7224a6e5)
- (parser) source difficulty from root XML attribute — [c955f2b](https://github.com/becked/per-ankh/commit/c955f2b28bd95bad8c30db8264113e71598d7d76)
- (reimport) give the reparse modal a border like other popups — [6f722a9](https://github.com/becked/per-ankh/commit/6f722a99430d5566e4485f866b811e951dd28afe)
- (reimport) preserve tournament link and lock uploader on reparse — [c2f3c8c](https://github.com/becked/per-ankh/commit/c2f3c8c5f968ff4c0f9171300f9c7aac09d40389)
- (parser) source difficulty from per-player <Difficulty> array — [9970489](https://github.com/becked/per-ankh/commit/99704897ec69eee36853dcb7fb05db88691b0992)
- (about-modal) neutral Close button and close-on-outside-click — [605abf2](https://github.com/becked/per-ankh/commit/605abf22eb5d77f4bf513b9b3c0b64f806fbf989)
- (game-detail) prefer in-game leader name on the winner card — [e2cb64d](https://github.com/becked/per-ankh/commit/e2cb64d5fe6abf2087d8a9ef55cca0d74e7944a5)
- (parser) resolve legacy <WinnerVictory> against global victory ordering — [ae354f8](https://github.com/becked/per-ankh/commit/ae354f88ec48f8cf27d7b74f3b8d7fd3bbbd5c88)
- (game-detail) support same-nation (mirror match) players — [b56711d](https://github.com/becked/per-ankh/commit/b56711d26726c1d4c17b41da2dd9186e0211cb18)
- (auth) return users to their origin page after login + redirect_uri allowlist — [88f3bfe](https://github.com/becked/per-ankh/commit/88f3bfe6d4f21483e29062f82608a8c94c64b0da)
- (meta) standardize page titles and unify on meta system — [237fba5](https://github.com/becked/per-ankh/commit/237fba578e8800f6ba8df318ab69942666edd5d3)
- (tournament) let an admin replace the save for their own match — [c098632](https://github.com/becked/per-ankh/commit/c098632758a0d547f97da0bffaad46db0fd379b6)
- (tournament) correct bye-match presentation in championship bracket — [1f8634e](https://github.com/becked/per-ankh/commit/1f8634ee557671da8aa3e6406ea87159a4d5dcbe)
- (games) derive head/OG title from formatGameTitle — [8eb4851](https://github.com/becked/per-ankh/commit/8eb4851f5931c30fb7800a09be485450a24ef38f)
- (map) render city tiles in their founding nation's architecture — [4411084](https://github.com/becked/per-ankh/commit/4411084db503f6614e5e4098d26e5908fe677c39)
- (scripts) read .dev.vars with fs.readFileSync instead of cat — [54626ab](https://github.com/becked/per-ankh/commit/54626abc3909d1378c9824912cf5d792de1e2608)
- (account) reparse the whole library, not just the first 50 games — [3667cdf](https://github.com/becked/per-ankh/commit/3667cdfc72d085190bbecfc067bc8294e33ee9e5)
- (build) stop esbuild lowering destructuring instead of bumping Safari — [8ec6898](https://github.com/becked/per-ankh/commit/8ec6898865dfa7577ab208456a1f0f60f7d62ce3)
- (tournament) editing a slot's signup answer no longer unlinks the player — [ee8a8d6](https://github.com/becked/per-ankh/commit/ee8a8d6a4d156685649990001c1802ccc32dea75)
- (game-detail) correct overview metric bars for non-positive values — [f3a85b7](https://github.com/becked/per-ankh/commit/f3a85b79ea26134b60d8f0b4a011fef486072728)
- (parser) correct law-adoption history; exclude succession laws (2.9.1) — [7ef3539](https://github.com/becked/per-ankh/commit/7ef3539e8f0aab1eadae6650d4d3da9051de1ad3)
- (deps) resolve high-severity npm audit advisories — [1559152](https://github.com/becked/per-ankh/commit/1559152fd91fa35303127d5e392dac4d6874b3d4)
- (tournament) make audit event writes durable (#75) — [a792279](https://github.com/becked/per-ankh/commit/a7922795332497121b53e248f7d7edf9517f62ec)
- (military) center y-axis title to match sibling chart tabs — [e6cec07](https://github.com/becked/per-ankh/commit/e6cec0788570eea8b7581ea1c46127ac49dbfc04)
- (military) equalize event-rail marker sizes across categories — [95d5ef0](https://github.com/becked/per-ankh/commit/95d5ef0ea3bbcc7691668f72721b2582c309dbe0)
- (military) align build-box labels and flatten count styling — [213a747](https://github.com/becked/per-ankh/commit/213a747a1974e90d8bfefba6983edff6c203c705)
- (admin) clear tournament references in nuke-user before deleting user — [2644703](https://github.com/becked/per-ankh/commit/264470310fb712478728b20b3d166db057cbd6d6)
- (tournament) validate transition-championship body before closing rounds — [d78d84f](https://github.com/becked/per-ankh/commit/d78d84fa0947e237e97faa4960a32919870f291a)
- (tournament) surface off-year match dates and seed calendar on current month — [8b703e8](https://github.com/becked/per-ankh/commit/8b703e81c69dbed22f85328cf4afdf1f83fd58a7)
- (tournament) keep non-scheduled matches last in both sort directions — [cf141f1](https://github.com/becked/per-ankh/commit/cf141f1b681a5a24bdb10a219e01fc854c866f5c)
- (tournament) give the Links button full opacity to match Settings — [c271fb8](https://github.com/becked/per-ankh/commit/c271fb82fc046803eb2e1fd59806788a6048fc51)
- (tournament) reconcile up-next panel with match parts model — [6fc2324](https://github.com/becked/per-ankh/commit/6fc23244eeeba660f7c49cb7341653693dbf8060)
- (tournament) recompute match status/schedule against a live clock — [6bfb883](https://github.com/becked/per-ankh/commit/6bfb883feeb49a70d0d0e954dd51053a697480b0)
- (tournament) let a deliberately added blank part survive save — [d01026e](https://github.com/becked/per-ankh/commit/d01026e1abdd05cbcad85db55bfd25f5d1eadd29)
- (tournament) show Match N in the popover and tidy match-number wiring — [7b17f9c](https://github.com/becked/per-ankh/commit/7b17f9cb271b3e80ef995ada5276c4aa9fb67d85)
- (tournament) assign match_number when seeding local fixtures — [821ec9f](https://github.com/becked/per-ankh/commit/821ec9f6467cce989b1790b8cc3b52e69011b41e)
- (tournament) lint-clean Cast view URL sync + drop dead eslint directives — [14dbcc8](https://github.com/becked/per-ankh/commit/14dbcc8df83ee81977eb6ba1683f33bf515c53cd)
- (tournament) record the schedule ledger event on a match schedule PATCH — [de4d000](https://github.com/becked/per-ankh/commit/de4d000b66db8584184b68f34ebf023879c7670c)
- (game-detail) classify army units by the game's UnitCycle — [04e94db](https://github.com/becked/per-ankh/commit/04e94db437d3bef4fa8202fffd41c30d648eb43e)
- (tournament) list unscheduled parts under "To be scheduled" — [ce8785c](https://github.com/becked/per-ankh/commit/ce8785cd14c72a790be1d99a4698739cbf4a07f8)
- (tournament) suppress password-manager autofill in user autocomplete — [0fee5b6](https://github.com/becked/per-ankh/commit/0fee5b6b059322798061dbc396cab69dcf298ffa)
- (tournament) match cast grace in the needs-casters copy — [e2f359b](https://github.com/becked/per-ankh/commit/e2f359b327a0500056b2db00d625d694828667f0)

### Other

- remove unused theology and 3D unit sprite assets — [5ef7252](https://github.com/becked/per-ankh/commit/5ef725294f85a3df105c41d952fc5cb366989acb)
- clarify license boundary between code and game assets — [b409345](https://github.com/becked/per-ankh/commit/b409345a43375670280cb5995d1b206675f14547)
- refresh atlas manifests for pinacotheca 2.3.0 — [f09cefa](https://github.com/becked/per-ankh/commit/f09cefacedfd983e8aca493e328bb8a01107dc5c)
- gitignore baked assets and remove from tracking — [6ea5dce](https://github.com/becked/per-ankh/commit/6ea5dce6c302e4c5b6eda74e37c47bd1822ced60)
- gitignore assets/atlas-sources/ (duplicate bake output) — [9995825](https://github.com/becked/per-ankh/commit/9995825f87745da4b10143892cdeb2d2a7d64c9a)
- switch cloud auth to Discord OAuth and add tournament spec — [ab6653d](https://github.com/becked/per-ankh/commit/ab6653dae227b2d13c491bd6f87cf5adc948ba98)
- revise cloud-rewrite spec with v1 design decisions — [3190952](https://github.com/becked/per-ankh/commit/3190952253dad601886998a063a556226f71526e)
- drop replay stripping, add test corpus, clarify in-place layout — [1fc69bd](https://github.com/becked/per-ankh/commit/1fc69bd02a8bc0cf4157b774acd426ac17e9eaa2)
- add prospector tournament saves to test corpus — [ab79710](https://github.com/becked/per-ankh/commit/ab7971026bd5072a47276a8fc170ba46d848ef81)
- pin parser-rewrite details (parity harness, XML quirks, uploader picker) — [a93a127](https://github.com/becked/per-ankh/commit/a93a1273419824db5ffd05f8aa0ec9036da82886)
- drop fault-tolerant principle (no v1 backing, redundant with browser-first) — [d5c544a](https://github.com/becked/per-ankh/commit/d5c544a85a260221b3be2d7f8edd44a1caea4c7f)
- tighten cloud-rewrite code examples for SvelteKit best practices — [48ef4f3](https://github.com/becked/per-ankh/commit/48ef4f3980a5900c043003c91c2c99e2dd702dd4)
- (csp) allow localhost worker in dev — [6b9478f](https://github.com/becked/per-ankh/commit/6b9478f5e4510bb154feced7a8a3b7f9ed0df6c7)
- cloud productionization plan — merge, cutover, bake, Tauri sweep — [9d31889](https://github.com/becked/per-ankh/commit/9d3188999c5c0a9174e167c549db313021d7015d)
- add observability requirements + Logpush decision flag to cutover plan — [86570df](https://github.com/becked/per-ankh/commit/86570dfd5edd94720b3274855ce2199dffc1c7a5)
- rename per-ankh.sh → tauri.sh — [e2ac2ed](https://github.com/becked/per-ankh/commit/e2ac2eda7a685640ba505b5efdd6942e53fba6a8)
- (cloud) split bake into two stages around login allowlist — [805e61c](https://github.com/becked/per-ankh/commit/805e61c2603bd238771fa0ed2aa4eb1e85eb724f)
- drop parity harness and Tauri dev scripts — [27427db](https://github.com/becked/per-ankh/commit/27427dbeaa67e8f22d7ba0e7d2806065362ed08d)
- drop Tauri release workflow — [b4f279b](https://github.com/becked/per-ankh/commit/b4f279bc6ccc322dc67713dc77cb122c6ec9f5fd)
- rewrite project docs for cloud-only — [3de946c](https://github.com/becked/per-ankh/commit/3de946c2f8be90ba48fc999da931ed6813a1d249)
- add forward-only cloud deploy plan — [c9c68fd](https://github.com/becked/per-ankh/commit/c9c68fd7787551198b6141959057e2260ae04c8e)
- note Discord OAuth redirects are already configured — [266bab0](https://github.com/becked/per-ankh/commit/266bab0d563678460cee9c03ca44a475b136ed1e)
- tighten deploy plan after verification pass — [eb9e34a](https://github.com/becked/per-ankh/commit/eb9e34a2a61a887dea980e59b667d28566735acc)
- add design language audit reference — [e7ced01](https://github.com/becked/per-ankh/commit/e7ced01d8f23f47e955fc5bc5b3eed152061c055)
- apply prettier formatting across repo — [3719a0d](https://github.com/becked/per-ankh/commit/3719a0dffd464af41319549ab17e883b323cb1d7)
- (cloud) wire real SESSIONS_KV namespace IDs — [735e15f](https://github.com/becked/per-ankh/commit/735e15f76646aa0fc73adb3a6c1fcabd00a5d86b)
- (cloud) add root wrangler.toml for SSR Worker — [4894b35](https://github.com/becked/per-ankh/commit/4894b3511d4158fa177eb05f398fa28d87b3f88a)
- prod-safe defaults for frontend env vars — [85e21ba](https://github.com/becked/per-ankh/commit/85e21ba52df289418de5c00f5bf9d18680993187)
- (deploy) correct §3.7 to match actual Cloudflare notification catalog — [88ea930](https://github.com/becked/per-ankh/commit/88ea930725764c3f35cd84b877a050314f66d082)
- tighten about disclaimer and add takedown contact — [7f97fa3](https://github.com/becked/per-ankh/commit/7f97fa3e3f5f4eeb65f3306cfe6c90885e78b76f)
- (admin) replace cloud/admin.sh with ./per-ankh admin — [b8282ed](https://github.com/becked/per-ankh/commit/b8282ed32a39be0786c2a5295f1d1aac1d814bd4)
- add security review and action-flow walkthrough — [e07fcfa](https://github.com/becked/per-ankh/commit/e07fcfad050b0d51e039baae6330380dcf0a3d61)
- (deps) bump fast-xml-parser 5.7.2 → 5.7.3 — [c6e1ca2](https://github.com/becked/per-ankh/commit/c6e1ca2ee7271935e32064c58d2087465b05a063)
- prettier format — [8cd900b](https://github.com/becked/per-ankh/commit/8cd900bbe2925ced39bd1b1ab9dbc878842132ab)
- format generated manifests via prettier — [3ee85f9](https://github.com/becked/per-ankh/commit/3ee85f9dc4006fde080367425df3f4553f280cb9)
- correct stale "no individual units in saves" claim — [b10d5cb](https://github.com/becked/per-ankh/commit/b10d5cbf9e38d15c80279a4111025a3e0b9c19e6)
- cull stale Tauri/Rust/DuckDB references, consolidate save-format knowledge — [7b2cd87](https://github.com/becked/per-ankh/commit/7b2cd878cfc7b55c775cc6db24f60f5ac0fb1f2f)
- prettier format docs — [0899bf0](https://github.com/becked/per-ankh/commit/0899bf004deea219c96d741c03d7ab04cfb59447)
- (game-detail) use stable identity for each-block keys (closes #33) — [ce76ea5](https://github.com/becked/per-ankh/commit/ce76ea507e69048c8b1b8e480b5ef6f3942fceef)
- (tournament) self-review of first-pass tournament implementation — [4a867ed](https://github.com/becked/per-ankh/commit/4a867ed9bdaa79989d0abc4b2a7d37f6fae3ad75)
- (cloud) integration test harness for tournament handlers — [f6e4ecc](https://github.com/becked/per-ankh/commit/f6e4ecc50e86e77952b1079a4a673b1941bf9c05)
- (tournament) mark closed items in code-review punch list — [c47c8c5](https://github.com/becked/per-ankh/commit/c47c8c5734e518aa735e4b15ee35304914dbe69b)
- (tournament) exercise the rematch-swap branch in pairing (#20) — [400a603](https://github.com/becked/per-ankh/commit/400a60361bd3ca6051463550e4ef30ae36d7da7f)
- (tournament) add per-item status lines for closed punch-list items — [526e5f0](https://github.com/becked/per-ankh/commit/526e5f068c36b76d74a511f7e302c74509d4e3b7)
- (og) replace default share image with header wordmark — [062a2ee](https://github.com/becked/per-ankh/commit/062a2ee5c1314e0cf47ebfb9499f9ca5ce9300b7)
- (tournament) retire code-review punch list, refresh post-ship status — [d9faf8e](https://github.com/becked/per-ankh/commit/d9faf8ee58d726b3391efcd74da5d8f7c6ed6f44)
- (tournament) harden admin surface + backfill integration coverage — [901276e](https://github.com/becked/per-ankh/commit/901276edbda5f98f2b293fb45c42c7d00ebb113f)
- (tournament) retire closed open-work items, refresh post-hardening status — [1d4da8a](https://github.com/becked/per-ankh/commit/1d4da8afc7ef9c6d08ed3dbe888e1be16407a235)
- (tournament) rewrite workflow-shape note for auto-advance lifecycle — [17a125d](https://github.com/becked/per-ankh/commit/17a125d23b09ca2e8ff023a908ffada708ace956)
- (tournament) rename match status 'reported' to 'complete' — [0ec0c75](https://github.com/becked/per-ankh/commit/0ec0c75fba4a5a15ffbb751b968a220ce68d5ecd)
- temper atomic-commits rule with a pragmatism note — [239b6bf](https://github.com/becked/per-ankh/commit/239b6bfa1e1304751e658731437678158e1e6b3e)
- (tournament) tighten swiss flow bracket round column min-width — [a242f8a](https://github.com/becked/per-ankh/commit/a242f8af79944441f381266d0eb24565a001bae1)
- (tournament) refresh implementation notes against current code — [3bf83f2](https://github.com/becked/per-ankh/commit/3bf83f29eda93c6913363f4ea73dfc092c42ceba)
- (tournament) tweak swiss bracket map label placement and widen detail page — [8144797](https://github.com/becked/per-ankh/commit/8144797f552a682929e68619f14dbdb45b3e6140)
- (tournament) correct admin-write-path comments — [a7ea30d](https://github.com/becked/per-ankh/commit/a7ea30dc0c1dec96cd70c89419f1ca4cb4c36e3e)
- (claude) add prod-targeting command guardrail — [7a41e71](https://github.com/becked/per-ankh/commit/7a41e714bd80081d27c5b8f232778662ed10aca2)
- (security) add ASVS 5.0 Level 2 coverage review — [8395e7c](https://github.com/becked/per-ankh/commit/8395e7c229f5f38ec3ca2663d7a8343aeda10396)
- (tournament) add PR #49 code review — [a833245](https://github.com/becked/per-ankh/commit/a8332459a317713b3bc5f8bc2d7a260189c3832e)
- (tournament) add tournament-branch security review — [32f5d1f](https://github.com/becked/per-ankh/commit/32f5d1f35c07983a35bc9588bdd8e268bb27a73c)
- apply prettier formatting — [4e073f5](https://github.com/becked/per-ankh/commit/4e073f5ddc760450242194935fb9fd6b037c1894)
- drop the dismissible "you're signed up" tournament banner — [61310bf](https://github.com/becked/per-ankh/commit/61310bf67c3a0033b427d0188ce05f4830c167f9)
- prettier pass — [cbb4080](https://github.com/becked/per-ankh/commit/cbb408032269f3e69e27ec458ab28e13fe84ed3e)
- (release) deploy 2026-05-19-512851d — [6caad20](https://github.com/becked/per-ankh/commit/6caad2096afdd5d3eda6cb87da28280e5102dff9)
- (release) deploy 2026-05-19-136db32 — [70a56cf](https://github.com/becked/per-ankh/commit/70a56cf01c9d494e9c62b3bb01937df758522a50)
- (format) apply prettier — [f89faa7](https://github.com/becked/per-ankh/commit/f89faa79f8a36193aced6b3648f17182cc0a6d6c)
- (release) deploy 2026-05-19-f89faa7 — [4c44a2e](https://github.com/becked/per-ankh/commit/4c44a2e05dc8c345b3fae86b6a6ff318883ac2a4)
- (home) remove Discord login blurb from sign-in card — [6955e14](https://github.com/becked/per-ankh/commit/6955e14a0f23e179b1aa8354fa1d39450f779710)
- (modal) swap red bulk-reparse/reimport border for black to match other modals — [ac11b67](https://github.com/becked/per-ankh/commit/ac11b67e331d8d7263461dca2670505324767c10)
- (release) deploy 2026-05-19-0d6f73b — [720dc57](https://github.com/becked/per-ankh/commit/720dc5785236bbc8e6ce581b713679c432faaa12)
- (claude) codify "optimize for the app, not dev time" principle — [e0b8c7f](https://github.com/becked/per-ankh/commit/e0b8c7f9a8c258b75a3b320cf35838cfef00ad6d)
- (release) deploy 2026-05-20-77b55a4 — [953a0a8](https://github.com/becked/per-ankh/commit/953a0a8c7d6ec224ac10de8236fbd1d56b28acc4)
- (tournament) propose losses-asc as seeding tier 1 — [3de6aaa](https://github.com/becked/per-ankh/commit/3de6aaac7a1145b26750c0237ea7615f5717bbdc)
- (stats) consolidate aggregate-stats session docs into one — [8b5b7d0](https://github.com/becked/per-ankh/commit/8b5b7d0c9299750fe90200697ba2cdf2328d2db3)
- point historical parser-status doc at aggregate-statistics.md — [520a006](https://github.com/becked/per-ankh/commit/520a00644a6567b45c91fad0092f18fbc2e4bc8b)
- (ux-review) add 10-expert panel findings artifact — [55aee7c](https://github.com/becked/per-ankh/commit/55aee7c764904f0b581d0a361ff70b5e08f8eb19)
- replace native browser chrome with styled ui primitives — [8463400](https://github.com/becked/per-ankh/commit/8463400a8cacc5ab6d8ddd1c9f82d7e3b2eeb8a2)
- (tournament) align pages with dark-theme UX conventions — [30d309a](https://github.com/becked/per-ankh/commit/30d309af7bda16afe07f18932e6e35b68a931851)
- (ux-review) regenerate UX review report (2026-05-25) — [fdf3c0a](https://github.com/becked/per-ankh/commit/fdf3c0a1b77874a1c00508c66e05c5d1e25ad8ec)
- reformat aggregate-statistics.md — [94dc83c](https://github.com/becked/per-ankh/commit/94dc83c00a809753085b2bc5cd0e261f94621824)
- revise per-ankh home redesign spec — [5c4092a](https://github.com/becked/per-ankh/commit/5c4092a9d0bc34b1060e90ad6763e3ef77ca2423)
- add local tournament data investigation recipe to CLAUDE.md — [7189d9f](https://github.com/becked/per-ankh/commit/7189d9f441bc04e39b8239a3a221926d4444a69c)
- (tournament) apply prettier formatting to guide page — [775b3dd](https://github.com/becked/per-ankh/commit/775b3dd39db7cecdfee7c60fb8d9f129b10c8d9f)
- (deps) bump @sveltejs/kit to 2.61.1 — [609062e](https://github.com/becked/per-ankh/commit/609062e850fad6bfa4c4863fe6fbaded7085291b)
- (release) deploy 2026-05-25-609062e — [6a04341](https://github.com/becked/per-ankh/commit/6a043414d6e26ba47ce515ce6cbff20830e09139)
- (release) deploy 2026-05-25-cbb4ebd — [e023852](https://github.com/becked/per-ankh/commit/e0238524ec3d31d52627ccbf0a41f7b169568ebc)
- format +page.svelte — [cc20834](https://github.com/becked/per-ankh/commit/cc208341166fe46a8090e1bd332527ea0650ba08)
- (release) deploy 2026-05-25-cc20834 — [29dc3a0](https://github.com/becked/per-ankh/commit/29dc3a0bb2453ab2ecc98bc104fecc6fa2467a52)
- (release) deploy 2026-05-25-e2cb64d — [6197bed](https://github.com/becked/per-ankh/commit/6197bedf90da23bcd32a937872947b23bfb92a9e)
- (release) deploy 2026-05-26-ae354f8 — [8bd2cf6](https://github.com/becked/per-ankh/commit/8bd2cf6f32ff1c96678eaa6588636ab573a267e0)
- apply prettier formatting to game-detail files — [3e2c04d](https://github.com/becked/per-ankh/commit/3e2c04d4367b8aa4a0ca6d35c094dd87d87eef0c)
- (release) deploy 2026-05-26-3e2c04d — [28b2047](https://github.com/becked/per-ankh/commit/28b20479bf9b92a8355247e2205f97f6701cd513)
- (release) deploy 2026-05-27-df29275 — [9e91ba5](https://github.com/becked/per-ankh/commit/9e91ba516a5362522e3c634045dfd615c80f2e4b)
- (release) deploy 2026-05-27-b6d49a5 — [c41b89e](https://github.com/becked/per-ankh/commit/c41b89e1658a6f633dfec8d2e764ce853060989d)
- (tournament) fix stale map_pool lock assertion — [9143919](https://github.com/becked/per-ankh/commit/9143919299ec33f003c0926810d7f9541ea05ff8)
- (tournament) rename FirstPickNote to PickPreferenceNote — [2183412](https://github.com/becked/per-ankh/commit/218341278cc6789f67ea305672ed3d69f7238ac4)
- (release) deploy 2026-05-27-2183412 — [3200039](https://github.com/becked/per-ankh/commit/3200039f9400954ab852b76bf0821f6d9bbcdc7b)
- (release) deploy 2026-05-29-c098632 — [ce45687](https://github.com/becked/per-ankh/commit/ce456876ec91c452adc68edf474f5adfe285e7ce)
- (release) deploy 2026-05-29-f288bbf — [59f75c7](https://github.com/becked/per-ankh/commit/59f75c7f43aa3fe9f1242951599e2d6fcc752428)
- (release) deploy 2026-05-29-b255700 — [361a0e3](https://github.com/becked/per-ankh/commit/361a0e397d569139a5d5333bb7c6d528e265ca81)
- (release) deploy 2026-05-29-2a13ace — [b87386a](https://github.com/becked/per-ankh/commit/b87386a70543d4c9ce614466262a9e12562c230a)
- add C4 architecture model (HTML) — [68e1364](https://github.com/becked/per-ankh/commit/68e1364e4df058b450d68c8224b9972a6890a510)
- apply prettier formatting to c4-model.html — [6869c42](https://github.com/becked/per-ankh/commit/6869c427e1369f1329e7c6ec7bae7449e7a84191)
- (release) deploy 2026-05-29-6869c42 — [4cfdd96](https://github.com/becked/per-ankh/commit/4cfdd96cc4d2f7083bb86492f1f70d656d181f3c)
- (release) deploy 2026-05-29-867d604 — [0e1da7d](https://github.com/becked/per-ankh/commit/0e1da7d940e59c9d755dca04ac33a670b3aa192e)
- (release) deploy 2026-05-30-d0b2c64 — [cd592b6](https://github.com/becked/per-ankh/commit/cd592b6e1fbee133b4784dc867f8478baff6cf65)
- add owreference extraction reference + entity-popup data approaches — [17a7f78](https://github.com/becked/per-ankh/commit/17a7f789217df70fa642249ed8cd07e41ad71792)
- (tournament) label phase toggles Bracket/Rounds instead of Diagram — [d3e2f74](https://github.com/becked/per-ankh/commit/d3e2f740dfedd2deeeca25a48c3aafe7ec1f3649)
- prettier-format reference extraction tables — [35686a0](https://github.com/becked/per-ankh/commit/35686a040b3a34bf63b07971dc43fbbd00ea62aa)
- stop running prettier on markdown — [232aaf2](https://github.com/becked/per-ankh/commit/232aaf27c146b82c2b191dbfe2a08d02f1e31d3a)
- (release) deploy 2026-05-30-232aaf2 — [03ad4f5](https://github.com/becked/per-ankh/commit/03ad4f5c37031810253adcea89b62d699c440147)
- (release) deploy 2026-05-30-a01c3ab — [df31ce2](https://github.com/becked/per-ankh/commit/df31ce21f321605da2832ca5465beea9ffda90d0)
- (release) deploy 2026-05-30-c4d4b75 — [a510b7f](https://github.com/becked/per-ankh/commit/a510b7f3e2210712a13b8101ec885b5eeb217054)
- (release) deploy 2026-05-30-1f8634e — [dd6e02b](https://github.com/becked/per-ankh/commit/dd6e02b37650dc41ee0b8fba42f10608c4e9e22f)
- (release) deploy 2026-05-30-bed2e4b — [26584e4](https://github.com/becked/per-ankh/commit/26584e464bb63846a1b64d74f7ce3c531b59532e)
- (tournament) tidy signup config help text — [6f5803f](https://github.com/becked/per-ankh/commit/6f5803f0838109380530fd2f4fcd9d7814d8f0f4)
- (release) deploy 2026-05-30-6f5803f — [9be5c94](https://github.com/becked/per-ankh/commit/9be5c94c54cce4678b0a7bf2fb2b2f45f5d3804c)
- refresh CLAUDE.md for tournaments, CLI surface, and Worker tests — [c4a0299](https://github.com/becked/per-ankh/commit/c4a0299450c70104e24faef4e3814bc3aaaed257)
- (assets) bake dedicated fort renders into improvements atlas — [e6a7298](https://github.com/becked/per-ankh/commit/e6a72984852dce13a438a4eb5a9f1041523ca93a)
- apply prettier to formatScheduledWithLocal — [940f8ce](https://github.com/becked/per-ankh/commit/940f8ce101eb3a7663cb45aa5b612987812e7dc4)
- (release) deploy 2026-05-31-940f8ce — [18a02a9](https://github.com/becked/per-ankh/commit/18a02a9eda6ed6010787d0e6e5e035f0e99f0600)
- (release) deploy 2026-06-01-ce1f244 — [6fcc65b](https://github.com/becked/per-ankh/commit/6fcc65beb4db85e090a3b0af523db3d18d3ac424)
- (release) deploy 2026-06-01-554621d — [b273970](https://github.com/becked/per-ankh/commit/b2739709fea90299615017132725ef46df03f70d)
- tokenize UI colors and de-duplicate shared patterns — [26b6c1b](https://github.com/becked/per-ankh/commit/26b6c1b0c01248b9c5f60293a8ef9f4d4e45f80d)
- (release) deploy 2026-06-01-26b6c1b — [d8b742f](https://github.com/becked/per-ankh/commit/d8b742fbf322ff9b4a607e3e2dc4e9294d455716)
- (tournament) drop search placeholder on matches table filter — [6b7bdcf](https://github.com/becked/per-ankh/commit/6b7bdcf2dc7f474334ed483f8398081bf9393c9e)
- (tournament) cover PR#49 review coverage gaps (#54) — [f81b7dc](https://github.com/becked/per-ankh/commit/f81b7dc5c26fdccf7657917b06432eb66bf6b1bc)
- (release) deploy 2026-06-01-dfdf8de — [eecbe0e](https://github.com/becked/per-ankh/commit/eecbe0efa330a10b75935af4bbf6b189a701ef6f)
- add tournament beta-gate release plan — [af013aa](https://github.com/becked/per-ankh/commit/af013aaf2b87ea9b5709444fe898b8b878c191e4)
- (release) deploy 2026-06-01-4411084 — [bdebf51](https://github.com/becked/per-ankh/commit/bdebf51647ffe10944c424e78c2df668f78ba988)
- (release) deploy 2026-06-01-9243edd — [5f47446](https://github.com/becked/per-ankh/commit/5f474466b65cde4c50d6b6259674bef1ef59da9b)
- (release) deploy 2026-06-01-3667cdf — [f2c04e2](https://github.com/becked/per-ankh/commit/f2c04e2f3aaaa2f945df8ea39c1bbd76340e535a)
- (release) deploy 2026-06-02-5e19cb4 — [c4c0ffc](https://github.com/becked/per-ankh/commit/c4c0ffc5e9d3f779f521cf71c0e562df7a832dac)
- (staging) close documentation gaps found during provisioning — [71e0d5b](https://github.com/becked/per-ankh/commit/71e0d5bf559b86a3479f715d791347dedb1d62ec)
- (release) deploy 2026-06-06-293a30b — [782b3b8](https://github.com/becked/per-ankh/commit/782b3b8c1afe381e5e3368b801ae62cb9246cf2e)
- add performance architecture blog post — [7b1ad8b](https://github.com/becked/per-ankh/commit/7b1ad8b48e1d24704247955a6128813dd099f81f)
- (cloud) extract legacy share stack into share-legacy.ts — [a430c13](https://github.com/becked/per-ankh/commit/a430c1346b0c1629eac7bf63890bfa3eb4e759ae)
- drop stale invite-code references — [c4e18f0](https://github.com/becked/per-ankh/commit/c4e18f02be4559c049d9ea51e3bb52099186fa44)
- (cloud) set SECURITY_DB database ids — [3bd87d0](https://github.com/becked/per-ankh/commit/3bd87d074bed530f60e5b380f0766610911579c9)
- (release) deploy 2026-06-11-3bd87d0 — [4c0aca5](https://github.com/becked/per-ankh/commit/4c0aca538b95068ae43b24659c1157ee77acce39)
- (tournament) prettier-format links files — [a5975fc](https://github.com/becked/per-ankh/commit/a5975fc0d10471811cc3b9712599beeb5623d0dc)
- (deps) pin esbuild to 0.28.1, raise Vite Safari target to 15 — [11f67ed](https://github.com/becked/per-ankh/commit/11f67ed25b61e093873cc91d58e1ca6f5153c6af)
- (release) deploy 2026-06-15-8ec6898 — [493d5b7](https://github.com/becked/per-ankh/commit/493d5b751a923e88076bf35235598ac9457117a1)
- (game-detail) restyle Specialists tab filter controls — [b43e995](https://github.com/becked/per-ankh/commit/b43e995ba41c0490dc3577a12ad804ac7185ce99)
- (tournament) label link fields and drop placeholders — [b0a92a7](https://github.com/becked/per-ankh/commit/b0a92a7636bc2c3966999dc50c8ca27a5930ea52)
- (deps) apply npm audit fixes for new advisories — [2caa77b](https://github.com/becked/per-ankh/commit/2caa77bd99b7030ffc14c5aec131f768d7668e2e)
- (deploy) allowlist dev-only ws DoS in preflight audit gate — [bec2eb5](https://github.com/becked/per-ankh/commit/bec2eb5fa607705d9aea0697618d0ab66cdb4676)
- (release) deploy 2026-06-15-bec2eb5 — [97f7e98](https://github.com/becked/per-ankh/commit/97f7e98532ed5890f24e737323bf3b18feadd47a)
- (game-detail) roomier leader card padding and inter-nation spacing — [77bb1df](https://github.com/becked/per-ankh/commit/77bb1dff41cc72b5a670538baf424d4730669fd5)
- (game-detail) refine leader popover layout and accent — [caf0a78](https://github.com/becked/per-ankh/commit/caf0a7875568f73ae332f7952767ef10b8da85cf)
- (game-detail) recolor leader popover frame and deepen shadow — [31404fd](https://github.com/becked/per-ankh/commit/31404fd72af8d49cdb92590a87d74dd6f698e242)
- (formatting) wrap ROMAN_HUNDREDS array per prettier — [bc18335](https://github.com/becked/per-ankh/commit/bc18335d730d44f4636bf6b22947ff593c45558c)
- (release) deploy 2026-06-16-bc18335 — [de2deaf](https://github.com/becked/per-ankh/commit/de2deafe69cea3787966c07e99511d9334810aab)
- (tournament) drop redundant parens in SlotUsernameCell per prettier — [5d1eb22](https://github.com/becked/per-ankh/commit/5d1eb2214e933ccd709e3dba00babed9feeb9503)
- (release) deploy 2026-06-17-5d1eb22 — [f0167ee](https://github.com/becked/per-ankh/commit/f0167ee497241ffc54925e852ef23afaa0568e3b)
- apply prettier formatting — [39e8e4b](https://github.com/becked/per-ankh/commit/39e8e4bc18564df4d4e9674a10dc43770eb2010c)
- (release) deploy 2026-06-20-0791f86 — [1329294](https://github.com/becked/per-ankh/commit/1329294221a045e82e5bcc253dbdb4e6ad5b9f5d)
- add tournament rules reference, skill, and markdown soft-wrap rule — [ff1ca15](https://github.com/becked/per-ankh/commit/ff1ca15232a76164b1132f392f3d3ee095971d08)
- apply prettier formatting to tournament admin handlers — [987bab3](https://github.com/becked/per-ankh/commit/987bab3082afeba59aad3173e8488ccc3e3f9c6a)
- (release) deploy 2026-06-27-987bab3 — [5630ff9](https://github.com/becked/per-ankh/commit/5630ff9996f81c0573175515cddc03324250b251)
- (release) deploy 2026-06-28-e9925a3 — [5e54cf9](https://github.com/becked/per-ankh/commit/5e54cf9cc454da2043a2642380a0e3274b21d040)
- correct stale tournament beta-gate language to create-only allowlist — [5ac3d2d](https://github.com/becked/per-ankh/commit/5ac3d2dba379d7bfd7798b0a44ac1e01dd9df3f6)
- archive historical docs and delete obsolete pre-rewrite ones — [fe480c4](https://github.com/becked/per-ankh/commit/fe480c4c541c10bb1fb818375b06db077218766c)
- correct stale claims in retained docs and refresh Key docs — [a4b21a8](https://github.com/becked/per-ankh/commit/a4b21a8613c5bd25baa3e5931024461f3a1c36e5)
- remove public security/code review HTMLs — [067cbfe](https://github.com/becked/per-ankh/commit/067cbfe6d159f3cd4534a61d551360ea94c700d2)
- drop stale SECURITY_DB/KV provisioning comments — [0f7da77](https://github.com/becked/per-ankh/commit/0f7da775ae0ffdd398f1afcfc7a3ecc284bd9b95)
- add 2026-06-30 doc audit report — [05a5b6f](https://github.com/becked/per-ankh/commit/05a5b6f45b8ce8b36bd5b0d6a66ecc1daab90fc8)
- correct stale 'advisory' pairing/bye editing claim to match engine — [95ccccf](https://github.com/becked/per-ankh/commit/95ccccf27fd0eed1d3dfbcb005e14bb29885d37b)
- (military) address review feedback on matchup view — [de11ee9](https://github.com/becked/per-ankh/commit/de11ee9640037083bcbae538794fddd3e43a8c60)
- (military) position the event rail via convertToPixel — [52ed7fc](https://github.com/becked/per-ankh/commit/52ed7fc9c6d66eb94ccace977daad605d3429108)
- remove unused static/laws-icon.png — [cb49efa](https://github.com/becked/per-ankh/commit/cb49efa5d0cad7039255319c8753cfa907e8d2c1)
- (release) deploy 2026-07-01-436f9ad — [4f5b156](https://github.com/becked/per-ankh/commit/4f5b1568435bb99871da604e2ba592099458157d)
- (deps) bump echarts to 6.1.0 and force cookie >=0.7.0 — [c747e6e](https://github.com/becked/per-ankh/commit/c747e6ea03f20a1e2a58284ba94e783344b5a95a)
- (tournament) note #50 transition-validation fix and user-deletion FK gotcha — [9668850](https://github.com/becked/per-ankh/commit/966885048f5e213d547be3244a7ae469f8bcb898)
- (release) deploy 2026-07-02-18f6fb3 — [33b8de6](https://github.com/becked/per-ankh/commit/33b8de63e32ffd41e58fe7a261fb9d100baed60c)
- (release) deploy 2026-07-02-34951a2 — [9b74a8e](https://github.com/becked/per-ankh/commit/9b74a8e1db1aabd59198862e3a46d612ed28eb3d)
- (tournament) rename match-part VOD→Stream and apply parts-core review fixes — [edb4e47](https://github.com/becked/per-ankh/commit/edb4e4709764e19cba68acfc6b48db8f07937e09)
- (tournament) title-case the "In Progress" status toggle — [6b759d6](https://github.com/becked/per-ankh/commit/6b759d6b71fd70e61c9fd48760abbd9ec40e2f47)
- (release) deploy 2026-07-02-9e763b4 — [cd87b19](https://github.com/becked/per-ankh/commit/cd87b19fe11c8047516d708e8afc5b0c5d19015a)
- (tournament) drop the match-number id→number map — [9ace4a0](https://github.com/becked/per-ankh/commit/9ace4a05286096b9c4cad1a5e58f087232225ea0)
- (tournament) DRY the match_number assignment SQL — [9555b57](https://github.com/becked/per-ankh/commit/9555b57f6b3f0ce85ab9a3348420d24b917b7cb0)
- (tournament) unpad the popover Match N and narrow padMatchNumber — [a748af8](https://github.com/becked/per-ankh/commit/a748af8c00806a60dc2aa299e35adfb3d476ac3b)
- (tournament) drop the execCommand clipboard fallback — [c579a5b](https://github.com/becked/per-ankh/commit/c579a5bf41fde7683704ca38c6d9bd995a8c507b)
- (tournament) single-source the atlas-anchor slug and caveat threshold — [a50b502](https://github.com/becked/per-ankh/commit/a50b50255cc07af187a3cfbc02b853ea0428fcba)
- document OWTOURNAMENTATLAS_DIR in .env.example — [c5c94ff](https://github.com/becked/per-ankh/commit/c5c94ffe28a4c5050d55d35ba807ba9f4d50e847)
- fix prettier formatting in match-numbers integration test — [3cfc3c2](https://github.com/becked/per-ankh/commit/3cfc3c29ee70cc63220b4e17691718a8631cea0a)
- (release) deploy 2026-07-02-3cfc3c2 — [2157191](https://github.com/becked/per-ankh/commit/215719105ec7aad715d752ca149643a4d6c97d86)
- (tournament) pair-and-project the schedule save filter — [b6f3f79](https://github.com/becked/per-ankh/commit/b6f3f79e7cd317270510714a5663ba1df480d0bf)
- (release) deploy 2026-07-02-8925e9b — [03c26fa](https://github.com/becked/per-ankh/commit/03c26fafae5211a47f4e2392cf0e99066eab06c1)
- (tournament) make the copy buttons icon-only — [bb3a97b](https://github.com/becked/per-ankh/commit/bb3a97bab0176c53aa98697f13100edfc00df125)
- (tournament) consolidate match labels and tidy the matches page — [3998a0d](https://github.com/becked/per-ankh/commit/3998a0d159c6a09ca72051b897527bfd52f222c8)
- (tournament) fix stale caster deep-link example in rules — [dc998a6](https://github.com/becked/per-ankh/commit/dc998a61439649b3f748b5931cd8052992ce42d0)
- apply prettier formatting to public-reads test — [488a3e7](https://github.com/becked/per-ankh/commit/488a3e7a2052a9790bfbf9bd61fdf734723a17fe)
- (release) deploy 2026-07-03-488a3e7 — [ce6d6d8](https://github.com/becked/per-ankh/commit/ce6d6d8c44615e02217636e7a5a4a45849eda9da)
- (tournament) note both copy tools in the controls-card comment — [1a6985b](https://github.com/becked/per-ankh/commit/1a6985b06354de8159328ad31bd78c4ee7f7b2a7)

## [2026-07-03-488a3e7] - 2026-07-03

### Features

- (tournament) admin copy tools — DM, thread title, sesh export — [7692395](https://github.com/becked/per-ankh/commit/76923951b6967d97aa5e0587c4f3cceb88c11a08)
- (tournament) caster self-service + Cast view with shareable filters — [145da4c](https://github.com/becked/per-ankh/commit/145da4ce1d934ed94d51fd5fff898274a8aba120)

### Fixes

- (tournament) lint-clean Cast view URL sync + drop dead eslint directives — [14dbcc8](https://github.com/becked/per-ankh/commit/14dbcc8df83ee81977eb6ba1683f33bf515c53cd)
- (tournament) record the schedule ledger event on a match schedule PATCH — [de4d000](https://github.com/becked/per-ankh/commit/de4d000b66db8584184b68f34ebf023879c7670c)

### Other

- (tournament) drop the execCommand clipboard fallback — [c579a5b](https://github.com/becked/per-ankh/commit/c579a5bf41fde7683704ca38c6d9bd995a8c507b)
- (tournament) single-source the atlas-anchor slug and caveat threshold — [a50b502](https://github.com/becked/per-ankh/commit/a50b50255cc07af187a3cfbc02b853ea0428fcba)
- document OWTOURNAMENTATLAS_DIR in .env.example — [c5c94ff](https://github.com/becked/per-ankh/commit/c5c94ffe28a4c5050d55d35ba807ba9f4d50e847)
- (tournament) make the copy buttons icon-only — [bb3a97b](https://github.com/becked/per-ankh/commit/bb3a97bab0176c53aa98697f13100edfc00df125)
- (tournament) consolidate match labels and tidy the matches page — [3998a0d](https://github.com/becked/per-ankh/commit/3998a0d159c6a09ca72051b897527bfd52f222c8)
- (tournament) fix stale caster deep-link example in rules — [dc998a6](https://github.com/becked/per-ankh/commit/dc998a61439649b3f748b5931cd8052992ce42d0)
- apply prettier formatting to public-reads test — [488a3e7](https://github.com/becked/per-ankh/commit/488a3e7a2052a9790bfbf9bd61fdf734723a17fe)

## [2026-07-02-8925e9b] - 2026-07-02

### Fixes

- (tournament) let a deliberately added blank part survive save — [d01026e](https://github.com/becked/per-ankh/commit/d01026e1abdd05cbcad85db55bfd25f5d1eadd29)

### Other

- (tournament) pair-and-project the schedule save filter — [b6f3f79](https://github.com/becked/per-ankh/commit/b6f3f79e7cd317270510714a5663ba1df480d0bf)

## [2026-07-02-3cfc3c2] - 2026-07-02

### Features

- (tournament) persisted global match numbers — [0d19a44](https://github.com/becked/per-ankh/commit/0d19a4430dbe99a9b85b8351b19d6d86a2f69dc2)
- (tournament) show the Match N badge on championship bracket cards — [166c942](https://github.com/becked/per-ankh/commit/166c942306b4e5ff99cddc41d2a66834576dd42f)

### Fixes

- (tournament) show Match N in the popover and tidy match-number wiring — [7b17f9c](https://github.com/becked/per-ankh/commit/7b17f9cb271b3e80ef995ada5276c4aa9fb67d85)
- (tournament) assign match_number when seeding local fixtures — [821ec9f](https://github.com/becked/per-ankh/commit/821ec9f6467cce989b1790b8cc3b52e69011b41e)

### Other

- (tournament) drop the match-number id→number map — [9ace4a0](https://github.com/becked/per-ankh/commit/9ace4a05286096b9c4cad1a5e58f087232225ea0)
- (tournament) DRY the match_number assignment SQL — [9555b57](https://github.com/becked/per-ankh/commit/9555b57f6b3f0ce85ab9a3348420d24b917b7cb0)
- (tournament) unpad the popover Match N and narrow padMatchNumber — [a748af8](https://github.com/becked/per-ankh/commit/a748af8c00806a60dc2aa299e35adfb3d476ac3b)
- fix prettier formatting in match-numbers integration test — [3cfc3c2](https://github.com/becked/per-ankh/commit/3cfc3c29ee70cc63220b4e17691718a8631cea0a)

## [2026-07-02-9e763b4] - 2026-07-02

### Features

- (tournament) match parts — per-sitting schedule, casters, VODs — [256afbf](https://github.com/becked/per-ankh/commit/256afbf7f5eb525de92bc7fc0716042c264c6a5e)
- (tournament) refine match popup casting layout and matches list — [d7f31c4](https://github.com/becked/per-ankh/commit/d7f31c40d2968a4a66723512d1651dbe0f236c47)

### Fixes

- (tournament) reconcile up-next panel with match parts model — [6fc2324](https://github.com/becked/per-ankh/commit/6fc23244eeeba660f7c49cb7341653693dbf8060)
- (tournament) recompute match status/schedule against a live clock — [6bfb883](https://github.com/becked/per-ankh/commit/6bfb883feeb49a70d0d0e954dd51053a697480b0)

### Other

- (tournament) rename match-part VOD→Stream and apply parts-core review fixes — [edb4e47](https://github.com/becked/per-ankh/commit/edb4e4709764e19cba68acfc6b48db8f07937e09)
- (tournament) title-case the "In Progress" status toggle — [6b759d6](https://github.com/becked/per-ankh/commit/6b759d6b71fd70e61c9fd48760abbd9ec40e2f47)

## [2026-07-02-34951a2] - 2026-07-02

### Features

- (tournament) surface upcoming matches in an overview panel — [31eb4a6](https://github.com/becked/per-ankh/commit/31eb4a608c3777984f023afa9331cb4ddf4efeb4)
- (scripts) add `restore --local` to load a D1 backup into local dev — [17c088f](https://github.com/becked/per-ankh/commit/17c088ff5079448c4a0d5d0aa8b13575244d8c64)
- (tournament) refine upcoming-matches panel — [34951a2](https://github.com/becked/per-ankh/commit/34951a2b63e21e21cf2474e83f34fc05c715226b)

### Fixes

- (tournament) give the Links button full opacity to match Settings — [c271fb8](https://github.com/becked/per-ankh/commit/c271fb82fc046803eb2e1fd59806788a6048fc51)

## [2026-07-02-18f6fb3] - 2026-07-02

### Features

- (tournament) rework matches list columns and add caster filter — [fe26995](https://github.com/becked/per-ankh/commit/fe26995a77d9426e08afbdd08e5124533636b34c)
- (home) add 2026 tournament banner and reorder mobile sections — [18f6fb3](https://github.com/becked/per-ankh/commit/18f6fb339b3c85c9ca722583c7166e1d943560ee)

### Fixes

- (admin) clear tournament references in nuke-user before deleting user — [2644703](https://github.com/becked/per-ankh/commit/264470310fb712478728b20b3d166db057cbd6d6)
- (tournament) validate transition-championship body before closing rounds — [d78d84f](https://github.com/becked/per-ankh/commit/d78d84fa0947e237e97faa4960a32919870f291a)
- (tournament) surface off-year match dates and seed calendar on current month — [8b703e8](https://github.com/becked/per-ankh/commit/8b703e81c69dbed22f85328cf4afdf1f83fd58a7)
- (tournament) keep non-scheduled matches last in both sort directions — [cf141f1](https://github.com/becked/per-ankh/commit/cf141f1b681a5a24bdb10a219e01fc854c866f5c)

### Other

- (deps) bump echarts to 6.1.0 and force cookie >=0.7.0 — [c747e6e](https://github.com/becked/per-ankh/commit/c747e6ea03f20a1e2a58284ba94e783344b5a95a)
- (tournament) note #50 transition-validation fix and user-deletion FK gotcha — [9668850](https://github.com/becked/per-ankh/commit/966885048f5e213d547be3244a7ae469f8bcb898)

## [2026-07-01-436f9ad] - 2026-07-01

### Features

- (game-detail) head-to-head matchup view on the Military tab — [2a76cd9](https://github.com/becked/per-ankh/commit/2a76cd9571ff632ddef5467cf7fb7516f041a850)
- (skills) add doc-audit skill — [89d5d4b](https://github.com/becked/per-ankh/commit/89d5d4b70439557f0b651e82d1e2e832a4047387)
- (military) rework event rail into per-kind rows — [a4df8be](https://github.com/becked/per-ankh/commit/a4df8be165338371511da634561364862b654330)
- (military) grid the event rail to the power chart's x labels — [647c74a](https://github.com/becked/per-ankh/commit/647c74a3a10a5788af34066a86ee56c17dd41361)
- (military) unit icons for tech markers, merge overlapping ones — [25b47c0](https://github.com/becked/per-ankh/commit/25b47c0487e41cd95ac79eb805c2adecf5e4cae7)
- (military) use each law's own icon for event-rail law markers — [b28405f](https://github.com/becked/per-ankh/commit/b28405fec8182c00c40d268d90669c965a47618d)
- (military) restyle head-to-head build boxes inline with app — [31ef3a9](https://github.com/becked/per-ankh/commit/31ef3a970b7de9a14e84f8365ed5305905b17255)
- (military) align build panels on a shared unit-row order — [436f9ad](https://github.com/becked/per-ankh/commit/436f9ad717974da4656d2cf182a955c1552c8404)

### Fixes

- (military) center y-axis title to match sibling chart tabs — [e6cec07](https://github.com/becked/per-ankh/commit/e6cec0788570eea8b7581ea1c46127ac49dbfc04)
- (military) equalize event-rail marker sizes across categories — [95d5ef0](https://github.com/becked/per-ankh/commit/95d5ef0ea3bbcc7691668f72721b2582c309dbe0)
- (military) align build-box labels and flatten count styling — [213a747](https://github.com/becked/per-ankh/commit/213a747a1974e90d8bfefba6983edff6c203c705)

### Other

- correct stale tournament beta-gate language to create-only allowlist — [5ac3d2d](https://github.com/becked/per-ankh/commit/5ac3d2dba379d7bfd7798b0a44ac1e01dd9df3f6)
- archive historical docs and delete obsolete pre-rewrite ones — [fe480c4](https://github.com/becked/per-ankh/commit/fe480c4c541c10bb1fb818375b06db077218766c)
- correct stale claims in retained docs and refresh Key docs — [a4b21a8](https://github.com/becked/per-ankh/commit/a4b21a8613c5bd25baa3e5931024461f3a1c36e5)
- remove public security/code review HTMLs — [067cbfe](https://github.com/becked/per-ankh/commit/067cbfe6d159f3cd4534a61d551360ea94c700d2)
- drop stale SECURITY_DB/KV provisioning comments — [0f7da77](https://github.com/becked/per-ankh/commit/0f7da775ae0ffdd398f1afcfc7a3ecc284bd9b95)
- add 2026-06-30 doc audit report — [05a5b6f](https://github.com/becked/per-ankh/commit/05a5b6f45b8ce8b36bd5b0d6a66ecc1daab90fc8)
- correct stale 'advisory' pairing/bye editing claim to match engine — [95ccccf](https://github.com/becked/per-ankh/commit/95ccccf27fd0eed1d3dfbcb005e14bb29885d37b)
- (military) address review feedback on matchup view — [de11ee9](https://github.com/becked/per-ankh/commit/de11ee9640037083bcbae538794fddd3e43a8c60)
- (military) position the event rail via convertToPixel — [52ed7fc](https://github.com/becked/per-ankh/commit/52ed7fc9c6d66eb94ccace977daad605d3429108)
- remove unused static/laws-icon.png — [cb49efa](https://github.com/becked/per-ankh/commit/cb49efa5d0cad7039255319c8753cfa907e8d2c1)

## [2026-06-28-e9925a3] - 2026-06-28

### Features

- (users) operator-set display alias overriding Discord name — [e9925a3](https://github.com/becked/per-ankh/commit/e9925a343aeb89f0b2e2bddf49f96cc2bb6e0a8c)

## [2026-06-27-987bab3] - 2026-06-27

### Features

- (users) make Overview calendar cells clickable — [f3c0922](https://github.com/becked/per-ankh/commit/f3c0922fa8e1838b3325202fe2e7faa87aee4dcb)
- (admin) add find-user subcommand to search users by handle/name/email — [8e4b718](https://github.com/becked/per-ankh/commit/8e4b718cb058fb0ae48f1204bc1efdbac2249560)
- (tournament) compact map-config labels across the map pool — [03e012c](https://github.com/becked/per-ankh/commit/03e012cfe1bd3ef5fb360980a338998da6938a19)
- (tournament) name the in-game Map Script in the options editor — [bed6cee](https://github.com/becked/per-ankh/commit/bed6cee3e04b570d961581295ec9cd3d35d24963)

### Fixes

- (tournament) make audit event writes durable (#75) — [a792279](https://github.com/becked/per-ankh/commit/a7922795332497121b53e248f7d7edf9517f62ec)

### Other

- add tournament rules reference, skill, and markdown soft-wrap rule — [ff1ca15](https://github.com/becked/per-ankh/commit/ff1ca15232a76164b1132f392f3d3ee095971d08)
- apply prettier formatting to tournament admin handlers — [987bab3](https://github.com/becked/per-ankh/commit/987bab3082afeba59aad3173e8488ccc3e3f9c6a)

## [2026-06-20-0791f86] - 2026-06-20

### Features

- (tournament) admin-initiated mid-tournament player withdrawal — [48a2026](https://github.com/becked/per-ankh/commit/48a20261e61993c9c038a974f06191f152efadf7)
- (account) reparse individual saves from Settings -> Maintenance — [f25ef68](https://github.com/becked/per-ankh/commit/f25ef6812ca22e5ff9f46b7064acb8711d13e15c)
- (game-detail) law table shows full adoption history; swap-aware tooltip — [b9c8f9a](https://github.com/becked/per-ankh/commit/b9c8f9af5817e84ce0b5124749e4998a6cfb2035)
- (deploy) assert frontend bundle API origin after build — [0791f86](https://github.com/becked/per-ankh/commit/0791f86c7517af2670335076e1366d96e6845159)

### Fixes

- (game-detail) correct overview metric bars for non-positive values — [f3a85b7](https://github.com/becked/per-ankh/commit/f3a85b79ea26134b60d8f0b4a011fef486072728)
- (parser) correct law-adoption history; exclude succession laws (2.9.1) — [7ef3539](https://github.com/becked/per-ankh/commit/7ef3539e8f0aab1eadae6650d4d3da9051de1ad3)
- (deps) resolve high-severity npm audit advisories — [1559152](https://github.com/becked/per-ankh/commit/1559152fd91fa35303127d5e392dac4d6874b3d4)

### Other

- apply prettier formatting — [39e8e4b](https://github.com/becked/per-ankh/commit/39e8e4bc18564df4d4e9674a10dc43770eb2010c)

## [2026-06-17-5d1eb22] - 2026-06-17

### Fixes

- (tournament) editing a slot's signup answer no longer unlinks the player — [ee8a8d6](https://github.com/becked/per-ankh/commit/ee8a8d6a4d156685649990001c1802ccc32dea75)

### Other

- (tournament) drop redundant parens in SlotUsernameCell per prettier — [5d1eb22](https://github.com/becked/per-ankh/commit/5d1eb2214e933ccd709e3dba00babed9feeb9503)

## [2026-06-16-bc18335] - 2026-06-16

### Features

- (parser) extract leader fields + ratings, bump PARSER_VERSION 2.8.0 — [2dcd04e](https://github.com/becked/per-ankh/commit/2dcd04e46c684ab122d3a16f46ae74a0e3e3e27f)
- (assets) bake leader-archetype, rating, and ambition icons — [ec96f63](https://github.com/becked/per-ankh/commit/ec96f632826605d629263004b9bcb1e80f2a9243)
- (game-detail) add Leaders tab; move legitimacy chart from Events — [77d4d30](https://github.com/becked/per-ankh/commit/77d4d30375d9582a6b369dac9f62f399e272e46a)
- (game-detail) leader portraits, ambition names, and detail-panel polish — [abdf977](https://github.com/becked/per-ankh/commit/abdf977ce3bbe5be986311eba0399a247b603e5a)
- (game-detail) replace succession ribbons with leader cards + detail popover — [eee1824](https://github.com/becked/per-ankh/commit/eee1824eccceafd31a94c54e08262f73153d56c3)
- (game-detail) show leader regnal numerals (e.g. "Meera II the Fountainhead") — [be830b9](https://github.com/becked/per-ankh/commit/be830b921ea6ee9a1c28b2b582ba97191d76d042)

### Other

- (game-detail) roomier leader card padding and inter-nation spacing — [77bb1df](https://github.com/becked/per-ankh/commit/77bb1dff41cc72b5a670538baf424d4730669fd5)
- (game-detail) refine leader popover layout and accent — [caf0a78](https://github.com/becked/per-ankh/commit/caf0a7875568f73ae332f7952767ef10b8da85cf)
- (game-detail) recolor leader popover frame and deepen shadow — [31404fd](https://github.com/becked/per-ankh/commit/31404fd72af8d49cdb92590a87d74dd6f698e242)
- (formatting) wrap ROMAN_HUNDREDS array per prettier — [bc18335](https://github.com/becked/per-ankh/commit/bc18335d730d44f4636bf6b22947ff593c45558c)

## [2026-06-15-bec2eb5] - 2026-06-15

### Features

- (game-detail) correct setting names and add a Map Settings panel — [00e6454](https://github.com/becked/per-ankh/commit/00e6454523c503668622962e20de807236a3c85a)
- (game-detail) add Specialists tab — [a3a7666](https://github.com/becked/per-ankh/commit/a3a7666a26e36f442586783573894a02ebf8fb66)

### Other

- (game-detail) restyle Specialists tab filter controls — [b43e995](https://github.com/becked/per-ankh/commit/b43e995ba41c0490dc3577a12ad804ac7185ce99)
- (tournament) label link fields and drop placeholders — [b0a92a7](https://github.com/becked/per-ankh/commit/b0a92a7636bc2c3966999dc50c8ca27a5930ea52)
- (deps) apply npm audit fixes for new advisories — [2caa77b](https://github.com/becked/per-ankh/commit/2caa77bd99b7030ffc14c5aec131f768d7668e2e)
- (deploy) allowlist dev-only ws DoS in preflight audit gate — [bec2eb5](https://github.com/becked/per-ankh/commit/bec2eb5fa607705d9aea0697618d0ab66cdb4676)

## [2026-06-15-8ec6898] - 2026-06-15

### Features

- (tournament) add admin-editable links with a Links menu — [3002d75](https://github.com/becked/per-ankh/commit/3002d754969690db1c236f814f912879ed599920)

### Fixes

- (build) stop esbuild lowering destructuring instead of bumping Safari — [8ec6898](https://github.com/becked/per-ankh/commit/8ec6898865dfa7577ab208456a1f0f60f7d62ce3)

### Other

- (tournament) prettier-format links files — [a5975fc](https://github.com/becked/per-ankh/commit/a5975fc0d10471811cc3b9712599beeb5623d0dc)
- (deps) pin esbuild to 0.28.1, raise Vite Safari target to 15 — [11f67ed](https://github.com/becked/per-ankh/commit/11f67ed25b61e093873cc91d58e1ca6f5153c6af)

## [2026-06-11-3bd87d0] - 2026-06-11

### Features

- (cloud) add nightly events retention cron — [43023d7](https://github.com/becked/per-ankh/commit/43023d7a33f2203ad4440f83ecc73d139c4f51f7)
- (cloud) emit security_events tee draining to Skiff (#71) — [6db5f4e](https://github.com/becked/per-ankh/commit/6db5f4e43ac48d449e7846f48c3a86781ccd5cfa)

### Other

- add performance architecture blog post — [7b1ad8b](https://github.com/becked/per-ankh/commit/7b1ad8b48e1d24704247955a6128813dd099f81f)
- (cloud) extract legacy share stack into share-legacy.ts — [a430c13](https://github.com/becked/per-ankh/commit/a430c1346b0c1629eac7bf63890bfa3eb4e759ae)
- drop stale invite-code references — [c4e18f0](https://github.com/becked/per-ankh/commit/c4e18f02be4559c049d9ea51e3bb52099186fa44)
- (cloud) set SECURITY_DB database ids — [3bd87d0](https://github.com/becked/per-ankh/commit/3bd87d074bed530f60e5b380f0766610911579c9)

## [2026-06-06-293a30b] - 2026-06-06

### Features

- (staging) add staging environment with deploy CLI and separate resources — [b6b07ca](https://github.com/becked/per-ankh/commit/b6b07ca943b0e5cca44accc280e92a854927be0b)
- (tournament) label players by display name everywhere — [6eb9259](https://github.com/becked/per-ankh/commit/6eb9259f533a21ac4cba0ab06149e7462ef605df)
- (staging) add prod → staging reclone command (D1 + R2) — [293a30b](https://github.com/becked/per-ankh/commit/293a30bc1c7cde4e046428dc24711905ca2a8630)

### Other

- (staging) close documentation gaps found during provisioning — [71e0d5b](https://github.com/becked/per-ankh/commit/71e0d5bf559b86a3479f715d791347dedb1d62ec)

## [2026-06-02-5e19cb4] - 2026-06-02

### Features

- (tournament) open tournament feature to the public — [5e19cb4](https://github.com/becked/per-ankh/commit/5e19cb49353bbfbacce0fae4453748fde99256d7)

## [2026-06-01-3667cdf] - 2026-06-01

### Fixes

- (scripts) read .dev.vars with fs.readFileSync instead of cat — [54626ab](https://github.com/becked/per-ankh/commit/54626abc3909d1378c9824912cf5d792de1e2608)
- (account) reparse the whole library, not just the first 50 games — [3667cdf](https://github.com/becked/per-ankh/commit/3667cdfc72d085190bbecfc067bc8294e33ee9e5)

## [2026-06-01-9243edd] - 2026-06-01

### Features

- (game-detail) add optional Founder column to cities table — [9243edd](https://github.com/becked/per-ankh/commit/9243edd66d5d16e9315ddb08d80b9b0388eaf337)

## [2026-06-01-4411084] - 2026-06-01

### Fixes

- (games) derive head/OG title from formatGameTitle — [8eb4851](https://github.com/becked/per-ankh/commit/8eb4851f5931c30fb7800a09be485450a24ef38f)
- (map) render city tiles in their founding nation's architecture — [4411084](https://github.com/becked/per-ankh/commit/4411084db503f6614e5e4098d26e5908fe677c39)

### Other

- add tournament beta-gate release plan — [af013aa](https://github.com/becked/per-ankh/commit/af013aaf2b87ea9b5709444fe898b8b878c191e4)

## [2026-06-01-dfdf8de] - 2026-06-01

### Features

- (map) render rivers on the hex map — [1b028d0](https://github.com/becked/per-ankh/commit/1b028d016b1129a4f1db1ef2b6fb1d2b34447819)
- (map) outline contested/unowned cities on the map — [dfdf8de](https://github.com/becked/per-ankh/commit/dfdf8de48b5dd2d20d02d6dd9e307df231a2ff79)

### Other

- (tournament) drop search placeholder on matches table filter — [6b7bdcf](https://github.com/becked/per-ankh/commit/6b7bdcf2dc7f474334ed483f8398081bf9393c9e)
- (tournament) cover PR#49 review coverage gaps (#54) — [f81b7dc](https://github.com/becked/per-ankh/commit/f81b7dc5c26fdccf7657917b06432eb66bf6b1bc)

## [2026-06-01-26b6c1b] - 2026-06-01

### Other

- tokenize UI colors and de-duplicate shared patterns — [26b6c1b](https://github.com/becked/per-ankh/commit/26b6c1b0c01248b9c5f60293a8ef9f4d4e45f80d)

## [2026-06-01-554621d] - 2026-06-01

### Features

- (tournament) simplify swiss standings columns — [554621d](https://github.com/becked/per-ankh/commit/554621d299b98de046a6b00f7281d66e51a25ee0)

## [2026-06-01-ce1f244] - 2026-06-01

### Features

- (tournament) add matches page with sortable table and calendar — [7036562](https://github.com/becked/per-ankh/commit/7036562cf34685fcf3fa00ba3bb2776317705ae0)
- (tournament) restyle match card caster/stream into a single link — [ce1f244](https://github.com/becked/per-ankh/commit/ce1f244d4444c8405cdfce4f29c370d4efe21c79)

## [2026-05-31-940f8ce] - 2026-05-31

### Features

- (tournament) let admins edit a player's signup answer on the slots panel — [1c1656a](https://github.com/becked/per-ankh/commit/1c1656ad0e219d9b82c3a67a4f61335b14561a13)
- (tournament) show match times in the viewer's local timezone — [b666d2c](https://github.com/becked/per-ankh/commit/b666d2cb8f88d17f8ed103f391fe0a7453c51c6e)

### Other

- refresh CLAUDE.md for tournaments, CLI surface, and Worker tests — [c4a0299](https://github.com/becked/per-ankh/commit/c4a0299450c70104e24faef4e3814bc3aaaed257)
- (assets) bake dedicated fort renders into improvements atlas — [e6a7298](https://github.com/becked/per-ankh/commit/e6a72984852dce13a438a4eb5a9f1041523ca93a)
- apply prettier to formatScheduledWithLocal — [940f8ce](https://github.com/becked/per-ankh/commit/940f8ce101eb3a7663cb45aa5b612987812e7dc4)

## [2026-05-30-6f5803f] - 2026-05-30

### Features

- (tournament) let admins self-sign-up and refresh signup UI — [1a82abc](https://github.com/becked/per-ankh/commit/1a82abc5c5c245d1424bce1ced1763671d6ed00d)

### Other

- (tournament) tidy signup config help text — [6f5803f](https://github.com/becked/per-ankh/commit/6f5803f0838109380530fd2f4fcd9d7814d8f0f4)

## [2026-05-30-bed2e4b] - 2026-05-30

### Features

- (tournament) add local fixture seeder CLI — [72536f2](https://github.com/becked/per-ankh/commit/72536f2d60a3ed81476241803b3b9cbc2b6ed8e4)
- (tournament) schedule matches with time, stream, and caster — [bed2e4b](https://github.com/becked/per-ankh/commit/bed2e4bc6ea92521041bbfac8dc347c90da2e7db)

## [2026-05-30-1f8634e] - 2026-05-30

### Fixes

- (tournament) correct bye-match presentation in championship bracket — [1f8634e](https://github.com/becked/per-ankh/commit/1f8634ee557671da8aa3e6406ea87159a4d5dcbe)

## [2026-05-30-c4d4b75] - 2026-05-30

### Features

- (tournament) rework match popover and add nation crests — [c7a3a88](https://github.com/becked/per-ankh/commit/c7a3a88c933104c7c1414ae3918a3548a49a7fc8)
- (tournament) refine match popover map control and layout — [c4d4b75](https://github.com/becked/per-ankh/commit/c4d4b757da96f9fc29e56dfc7816d6da144e9e21)

## [2026-05-30-a01c3ab] - 2026-05-30

### Features

- (tournament) widen swiss round columns and center the bracket — [a01c3ab](https://github.com/becked/per-ankh/commit/a01c3ab5f7fb3e15ff660ef1216414cdbf0ec2ff)

## [2026-05-30-232aaf2] - 2026-05-30

### Features

- (cli) add `./per-ankh backup` to snapshot D1 to a SQLite file — [65d3f0f](https://github.com/becked/per-ankh/commit/65d3f0f10b0c9289853357abfe1bd80f6477f4de)
- (tournament) add admin CSV export of standings + matches — [0f35534](https://github.com/becked/per-ankh/commit/0f35534c516081745b62d02948f323ac475b00cc)
- (tournament) tighten swiss bracket columns and add hover path-trace — [65c5544](https://github.com/becked/per-ankh/commit/65c5544b6b0f10ed1ecef104f0113007c250062f)
- (tournament) trace a player's path through the swiss bracket on hover — [e0c1974](https://github.com/becked/per-ankh/commit/e0c1974891784ba8d5f9ec63b52e15e32a2f5b63)

### Other

- add owreference extraction reference + entity-popup data approaches — [17a7f78](https://github.com/becked/per-ankh/commit/17a7f789217df70fa642249ed8cd07e41ad71792)
- (tournament) label phase toggles Bracket/Rounds instead of Diagram — [d3e2f74](https://github.com/becked/per-ankh/commit/d3e2f740dfedd2deeeca25a48c3aafe7ec1f3649)
- prettier-format reference extraction tables — [35686a0](https://github.com/becked/per-ankh/commit/35686a040b3a34bf63b07971dc43fbbd00ea62aa)
- stop running prettier on markdown — [232aaf2](https://github.com/becked/per-ankh/commit/232aaf27c146b82c2b191dbfe2a08d02f1e31d3a)

## [2026-05-30-d0b2c64] - 2026-05-30

### Features

- (tournament) highlight champion/runner-up names and brighten completed header — [d0b2c64](https://github.com/becked/per-ankh/commit/d0b2c64f26efc5c8d61234f0312c411b89f1db56)

## [2026-05-29-867d604] - 2026-05-29

### Features

- (tournament) rework championship standings to seed/player/round — [867d604](https://github.com/becked/per-ankh/commit/867d6046a034d81732092123e7d059cb83ce75e6)

## [2026-05-29-6869c42] - 2026-05-29

### Features

- (tournament) animate the diagram/standings switch and panel swap — [3e5e376](https://github.com/becked/per-ankh/commit/3e5e376d92e2a2ae3e0b561d094844c247539fbd)

### Other

- add C4 architecture model (HTML) — [68e1364](https://github.com/becked/per-ankh/commit/68e1364e4df058b450d68c8224b9972a6890a510)
- apply prettier formatting to c4-model.html — [6869c42](https://github.com/becked/per-ankh/commit/6869c427e1369f1329e7c6ec7bae7449e7a84191)

## [2026-05-29-2a13ace] - 2026-05-29

### Features

- (tournament) default Swiss groups to standings during championship — [2a13ace](https://github.com/becked/per-ankh/commit/2a13ace18bc0df66dba4d032096f3594a990da84)

## [2026-05-29-b255700] - 2026-05-29

### Features

- (tournament) toggle bracket diagram and standings within a card — [b255700](https://github.com/becked/per-ankh/commit/b255700918a2801856ba33b0f6852e721494e84a)

## [2026-05-29-f288bbf] - 2026-05-29

### Features

- (tournament) link substituted players to accounts and auto-claim slots — [f288bbf](https://github.com/becked/per-ankh/commit/f288bbfd3a704dda42eea9d7af0220e0ad7ca4a3)

## [2026-05-29-c098632] - 2026-05-29

### Features

- (tournament) snapshot slot occupant at report time, surface substitution in bracket — [b73da27](https://github.com/becked/per-ankh/commit/b73da2778eb881c196bf56a3b412636a190078f2)

### Fixes

- (tournament) let an admin replace the save for their own match — [c098632](https://github.com/becked/per-ankh/commit/c098632758a0d547f97da0bffaad46db0fd379b6)

## [2026-05-27-2183412] - 2026-05-27

### Features

- (tournament) in-app admin management, delete, signup question, themed date picker — [f96b04b](https://github.com/becked/per-ankh/commit/f96b04b1503b119c85ce928a04175a8abd46b47d)

### Fixes

- (auth) return users to their origin page after login + redirect_uri allowlist — [88f3bfe](https://github.com/becked/per-ankh/commit/88f3bfe6d4f21483e29062f82608a8c94c64b0da)
- (meta) standardize page titles and unify on meta system — [237fba5](https://github.com/becked/per-ankh/commit/237fba578e8800f6ba8df318ab69942666edd5d3)

### Other

- (tournament) fix stale map_pool lock assertion — [9143919](https://github.com/becked/per-ankh/commit/9143919299ec33f003c0926810d7f9541ea05ff8)
- (tournament) rename FirstPickNote to PickPreferenceNote — [2183412](https://github.com/becked/per-ankh/commit/218341278cc6789f67ea305672ed3d69f7238ac4)

## [2026-05-27-b6d49a5] - 2026-05-27

### Features

- (improvements) bake real in-game improvement names from XML — [b6d49a5](https://github.com/becked/per-ankh/commit/b6d49a53684dd08ca704aa5ea36b6d9661c6b03d)

## [2026-05-27-df29275] - 2026-05-27

### Features

- (home) link game card uploader to their profile — [df29275](https://github.com/becked/per-ankh/commit/df292758803def3c13726d593b93c86ad70ddf4e)

## [2026-05-26-3e2c04d] - 2026-05-26

### Fixes

- (game-detail) support same-nation (mirror match) players — [b56711d](https://github.com/becked/per-ankh/commit/b56711d26726c1d4c17b41da2dd9186e0211cb18)

### Other

- apply prettier formatting to game-detail files — [3e2c04d](https://github.com/becked/per-ankh/commit/3e2c04d4367b8aa4a0ca6d35c094dd87d87eef0c)

## [2026-05-26-ae354f8] - 2026-05-26

### Fixes

- (parser) resolve legacy <WinnerVictory> against global victory ordering — [ae354f8](https://github.com/becked/per-ankh/commit/ae354f88ec48f8cf27d7b74f3b8d7fd3bbbd5c88)

## [2026-05-25-e2cb64d] - 2026-05-25

### Fixes

- (game-detail) prefer in-game leader name on the winner card — [e2cb64d](https://github.com/becked/per-ankh/commit/e2cb64d5fe6abf2087d8a9ef55cca0d74e7944a5)

## [2026-05-25-cc20834] - 2026-05-25

### Features

- (home) order recent saves by save date instead of upload date — [45609ef](https://github.com/becked/per-ankh/commit/45609ef37c60702d730aba25ec9a1c880c16bb2e)

### Other

- format +page.svelte — [cc20834](https://github.com/becked/per-ankh/commit/cc208341166fe46a8090e1bd332527ea0650ba08)

## [2026-05-25-cbb4ebd] - 2026-05-25

### Features

- (games) plot victory points in card sparklines, add admin reindex — [3356fb7](https://github.com/becked/per-ankh/commit/3356fb783512614ebf89b017da44202784b3cdd4)
- (admin) add delete-game and purge-games commands — [cbb4ebd](https://github.com/becked/per-ankh/commit/cbb4ebda8efa5f2da20a629898d5192590061cfe)

## [2026-05-25-609062e] - 2026-05-25

### Features

- (users) user profile with scoped library + aggregate stats — [cc9fcd0](https://github.com/becked/per-ankh/commit/cc9fcd0bd268be9009e9f1bb8a76d7467c2e8a43)
- (home) link profile card to library, add stat boxes and dark-theme panels — [9e79aff](https://github.com/becked/per-ankh/commit/9e79aff33795e807f69b00e0de7c79ac5f26ac7b)
- (game-detail) restyle tabs and tables to the games-table theme — [1cc6661](https://github.com/becked/per-ankh/commit/1cc6661228e82e7476d23779babb59090f4c9624)
- (scripts) anonymous UX-review screenshot walkthrough — [e71c974](https://github.com/becked/per-ankh/commit/e71c9744aa8159bceda6c32a9fedbe67642ef063)
- (game-detail) label the visibility toggle Public/Private — [c425c74](https://github.com/becked/per-ankh/commit/c425c74cfe813f6e41a548e85ff0d0c5a3be0de8)
- (account) public-by-default uploads with per-user override — [3fce53e](https://github.com/becked/per-ankh/commit/3fce53e4c7b6c6a67e794469bc02efa4bccabf01)
- (home) rework header and home page for signed-out discovery — [d0b7234](https://github.com/becked/per-ankh/commit/d0b7234fbf7928ff6bf728fa7146e1fc036882d1)
- (nav) add breadcrumb trail to game, tournament, and user pages — [4f12f25](https://github.com/becked/per-ankh/commit/4f12f25d2b9071df262e0b9c7892f1177a923535)
- (scripts) UX review as navigable folder bundle with auth + responsive passes — [68a2fe8](https://github.com/becked/per-ankh/commit/68a2fe886eff084600e4abeea1d922ce96ba9203)
- (settings) match overview card styling and add nation/religion icons — [e12e39f](https://github.com/becked/per-ankh/commit/e12e39f152154d76e642912cbe1cb255c28b9093)
- (game-detail) drop red from upload date, Turn label, and map status — [2639620](https://github.com/becked/per-ankh/commit/2639620dead4131afcd5f115e35625c4bdff056e)
- (users) replace native date filter with styled bits-ui date picker — [5048571](https://github.com/becked/per-ankh/commit/504857183f71b83a1b92f4d280041fb667281488)
- (ui) add shared styled UI primitives (select, checkbox, radio, toast, confirm) — [d3787d2](https://github.com/becked/per-ankh/commit/d3787d2a78d55854b0f6a97770ec1b4530823120)
- (home) add Discord sign-in CTA and saves heading to anon hero — [546d2e3](https://github.com/becked/per-ankh/commit/546d2e32f4871d58fdf9b4762caf1f1eb45a8ceb)
- (header) left-align wordmark, move menu right, collapse search to icon — [52a69b4](https://github.com/becked/per-ankh/commit/52a69b491f5b38fb1f466d278f0a398b9c31f11e)
- (upload) redesign nation picker as cards in the dark UI scheme — [c7609f9](https://github.com/becked/per-ankh/commit/c7609f96b26885e37f0c74ba66700f96b022653c)
- (upload) return to the originating page after upload — [3ca856c](https://github.com/becked/per-ankh/commit/3ca856c4b3a748b646d2a74bcbe2fd0e62122e75)
- (tournament) surface Mirror as a per-script map option — [4f99b98](https://github.com/becked/per-ankh/commit/4f99b9815d0fcbac02cadf6e92c293e1dea7fbe2)
- (tournament) model the map pool as instances with per-map options — [a5b2e7b](https://github.com/becked/per-ankh/commit/a5b2e7b9446d080bf44d43e45012103fbfc60d46)
- (tournament) rebuild bracket-seeding cascade as 6 tiers — [6d28aff](https://github.com/becked/per-ankh/commit/6d28aff3bef0c344d0239630422ce22069d04b65)
- (tournament) seed round-1 Swiss pairing by swiss seed — [87fc065](https://github.com/becked/per-ankh/commit/87fc06597e0d021821c6de20e55ae875e15845c4)
- (tournament) always-available guide and header cleanup — [0fab4d1](https://github.com/becked/per-ankh/commit/0fab4d109a580ea3dd61504edd38793b5b6bb40c)
- (tournament) drop the per-division help icons — [75ed878](https://github.com/becked/per-ankh/commit/75ed878f4020d6f9377df742e231feb461988b97)
- (auth) remove invite-code gate, open sign-up to all — [54b55e2](https://github.com/becked/per-ankh/commit/54b55e2280b09a0d73e3408a1d52cb1cd1c0353d)
- (tournament) redesign match modal, bracket map labels, and settings maps panel — [a84b51e](https://github.com/becked/per-ankh/commit/a84b51e4683db08a5cb2bf2f93d95673a98f48a7)
- (tournament) align championship bracket UI with Swiss redesign — [cfa2163](https://github.com/becked/per-ankh/commit/cfa2163be70fe6528ca3dcf9245620cccf5a816f)
- (tournament) move status chip below the nav trail, label it — [f1c2252](https://github.com/becked/per-ankh/commit/f1c2252ffc43e14b99f0d167174ad1a3fbecc63f)
- (tournament) redesign detail header with per-status hero strips — [a248b02](https://github.com/becked/per-ankh/commit/a248b028aff7d41ac1851fd08e710ff0f0240ecd)
- (tournament) render full championship bracket with TBD placeholders — [522ddf1](https://github.com/becked/per-ankh/commit/522ddf15236156faa089910220c24945729af98a)
- (tournament) anti-repeat maps by base script, not pool instance — [d4015d1](https://github.com/becked/per-ankh/commit/d4015d10fac11212d3d4bfad89b1c3146804104e)
- (tournament) move the guide from a modal into a paneled page — [cf4d0c0](https://github.com/becked/per-ankh/commit/cf4d0c007035c019c395126b29bbda1886419dde)
- (tournament) show player avatars in front of names — [7d18417](https://github.com/becked/per-ankh/commit/7d184172dd82bed28b6ca2dbb791f4ec1d2036eb)
- (tournament) replace modals with bits-ui popovers — [eb057e5](https://github.com/becked/per-ankh/commit/eb057e5fecb2cc374e5f42787e7250d6f56cd237)
- (tournament) lead map names with aspect ratio before size — [861a095](https://github.com/becked/per-ankh/commit/861a095ef86e3aa03208c35e40d7516df95e515c)
- (tournament) let admins add maps to a running tournament — [7a67145](https://github.com/becked/per-ankh/commit/7a671454de0f5be33658ba90e156ca87aa9a31b1)

### Fixes

- (about-modal) neutral Close button and close-on-outside-click — [605abf2](https://github.com/becked/per-ankh/commit/605abf22eb5d77f4bf513b9b3c0b64f806fbf989)

### Other

- (tournament) propose losses-asc as seeding tier 1 — [3de6aaa](https://github.com/becked/per-ankh/commit/3de6aaac7a1145b26750c0237ea7615f5717bbdc)
- (stats) consolidate aggregate-stats session docs into one — [8b5b7d0](https://github.com/becked/per-ankh/commit/8b5b7d0c9299750fe90200697ba2cdf2328d2db3)
- point historical parser-status doc at aggregate-statistics.md — [520a006](https://github.com/becked/per-ankh/commit/520a00644a6567b45c91fad0092f18fbc2e4bc8b)
- (ux-review) add 10-expert panel findings artifact — [55aee7c](https://github.com/becked/per-ankh/commit/55aee7c764904f0b581d0a361ff70b5e08f8eb19)
- replace native browser chrome with styled ui primitives — [8463400](https://github.com/becked/per-ankh/commit/8463400a8cacc5ab6d8ddd1c9f82d7e3b2eeb8a2)
- (tournament) align pages with dark-theme UX conventions — [30d309a](https://github.com/becked/per-ankh/commit/30d309af7bda16afe07f18932e6e35b68a931851)
- (ux-review) regenerate UX review report (2026-05-25) — [fdf3c0a](https://github.com/becked/per-ankh/commit/fdf3c0a1b77874a1c00508c66e05c5d1e25ad8ec)
- reformat aggregate-statistics.md — [94dc83c](https://github.com/becked/per-ankh/commit/94dc83c00a809753085b2bc5cd0e261f94621824)
- revise per-ankh home redesign spec — [5c4092a](https://github.com/becked/per-ankh/commit/5c4092a9d0bc34b1060e90ad6763e3ef77ca2423)
- add local tournament data investigation recipe to CLAUDE.md — [7189d9f](https://github.com/becked/per-ankh/commit/7189d9f441bc04e39b8239a3a221926d4444a69c)
- (tournament) apply prettier formatting to guide page — [775b3dd](https://github.com/becked/per-ankh/commit/775b3dd39db7cecdfee7c60fb8d9f129b10c8d9f)
- (deps) bump @sveltejs/kit to 2.61.1 — [609062e](https://github.com/becked/per-ankh/commit/609062e850fad6bfa4c4863fe6fbaded7085291b)

## [2026-05-20-77b55a4] - 2026-05-20

### Features

- (dashboard) server-paginated sidebar with URL-driven filters — [77b55a4](https://github.com/becked/per-ankh/commit/77b55a430cf2ae05f59720e01386f21c0753cb08)

### Other

- (claude) codify "optimize for the app, not dev time" principle — [e0b8c7f](https://github.com/becked/per-ankh/commit/e0b8c7f9a8c258b75a3b320cf35838cfef00ad6d)

## [2026-05-19-0d6f73b] - 2026-05-19

### Features

- (home) include AI players in recent-game card sparklines — [a1b1f31](https://github.com/becked/per-ankh/commit/a1b1f31f8d5a0e17cf3a60d5a4b48e2ef8dc953e)
- (home) add game title to recent-save cards and fix MP detection — [0d6f73b](https://github.com/becked/per-ankh/commit/0d6f73bb3cc1da452d3d13a9668faa276413f3c6)

### Other

- (home) remove Discord login blurb from sign-in card — [6955e14](https://github.com/becked/per-ankh/commit/6955e14a0f23e179b1aa8354fa1d39450f779710)
- (modal) swap red bulk-reparse/reimport border for black to match other modals — [ac11b67](https://github.com/becked/per-ankh/commit/ac11b67e331d8d7263461dca2670505324767c10)

## [2026-05-19-f89faa7] - 2026-05-19

### Features

- (home) replace prose hero with bulleted feature list — [5a0e946](https://github.com/becked/per-ankh/commit/5a0e94681e13f732085a13c28db6765791964657)
- (home) add Difficulty to recent-game cards — [af7a312](https://github.com/becked/per-ankh/commit/af7a31296aceffc6c528ed1b5cd4c581d1d85284)
- (account) add Reparse-all button to user settings — [2a5551f](https://github.com/becked/per-ankh/commit/2a5551f5ce199dcc660be53961a8b52c13f151cb)
- (admin) /admin/reparse page for global parser sweeps — [9e36e4d](https://github.com/becked/per-ankh/commit/9e36e4dde984321e4ec0e9e50dd778a49825d083)
- (home) show Multiplayer label on MP game cards — [e6fca12](https://github.com/becked/per-ankh/commit/e6fca121d0f5f91f9a0979ac375a6cb6a2e0431c)

### Fixes

- (parser) source difficulty from root XML attribute — [c955f2b](https://github.com/becked/per-ankh/commit/c955f2b28bd95bad8c30db8264113e71598d7d76)
- (reimport) give the reparse modal a border like other popups — [6f722a9](https://github.com/becked/per-ankh/commit/6f722a99430d5566e4485f866b811e951dd28afe)
- (reimport) preserve tournament link and lock uploader on reparse — [c2f3c8c](https://github.com/becked/per-ankh/commit/c2f3c8c5f968ff4c0f9171300f9c7aac09d40389)
- (parser) source difficulty from per-player <Difficulty> array — [9970489](https://github.com/becked/per-ankh/commit/99704897ec69eee36853dcb7fb05db88691b0992)

### Other

- (format) apply prettier — [f89faa7](https://github.com/becked/per-ankh/commit/f89faa79f8a36193aced6b3648f17182cc0a6d6c)

## [2026-05-19-136db32] - 2026-05-19

### Features

- (prod) auto-generate changelog entries and deploy/\* tags on deploy — [05b8f81](https://github.com/becked/per-ankh/commit/05b8f817f1b5c4b03e59b189658572b536df152e)
- (games) owner-editable save titles + server-side nation fallback — [136db32](https://github.com/becked/per-ankh/commit/136db32cd75138bd0a41fa57232014644a3453cb)

## [2026-05-19-512851d] - 2026-05-19

### Features

- (scripts) support PINACOTHECA_DIR/OLD_WORLD_REFERENCE_DIR + bake:sprites — [e07d2d9](https://github.com/becked/per-ankh/commit/e07d2d94878b99d65a671186ce638733bccea15f)
- (parity) add Rust↔TS parser parity test harness — [f59291c](https://github.com/becked/per-ankh/commit/f59291c57fcb14387ce94407989692fe7800ecda)
- (parser) port families to TS, stand up parser foundations — [eab7417](https://github.com/becked/per-ankh/commit/eab7417be2a96c1baf411be7702ce0b81a6e01c6)
- (parser) port tribes to TS — [2c04e13](https://github.com/becked/per-ankh/commit/2c04e131ab2afddbac791184310082fec28abdd0)
- (parser) port religions to TS — [7147bee](https://github.com/becked/per-ankh/commit/7147bee0c6b9d0696ad78ae8e125a4f66e823769)
- (parser) port players to TS — [22b78c2](https://github.com/becked/per-ankh/commit/22b78c257d1db0743067499a64cab68070fe3385)
- (parser) port characters to TS — [288e20e](https://github.com/becked/per-ankh/commit/288e20efd44897ef9f6af671246e63682ac2e939)
- (parser) port cities + 8 sub-entities to TS — [838c153](https://github.com/becked/per-ankh/commit/838c153b6517aef67ce97f4a64002c254d75fd57)
- (parser) port tiles + tile_visibility + tile_changes to TS — [ded2807](https://github.com/becked/per-ankh/commit/ded28075d8b3ddb4a9630157897307dcccac86bc)
- (parser) port units + 5 sub-entities to TS — [e14faac](https://github.com/becked/per-ankh/commit/e14faac85cc7712d2e1f0de41eb007a5c772d467)
- (parser) port character_data to TS — [1d2962b](https://github.com/becked/per-ankh/commit/1d2962b6d00a6e63de09021443438625aa4d11fd)
- (parser) port player_data to TS — [8d1522a](https://github.com/becked/per-ankh/commit/8d1522ae8e281c7bbb2e077092a3b7e2051c6bdc)
- (parser) port diplomacy_relations to TS — [aed1c82](https://github.com/becked/per-ankh/commit/aed1c828d2253ce13745f39759dd82f875aecdbf)
- (parser) port timeseries to TS — [4d6d997](https://github.com/becked/per-ankh/commit/4d6d997864f58513cc0c6b04ed5ebfe2eff5b233)
- (parser) port events to TS — final entities, 46/46 done — [4dd2cdf](https://github.com/becked/per-ankh/commit/4dd2cdfefe188c6fe6ad78ea338e03eefcc4fb7f)
- (parser) add cloud orchestrator + Web Worker entry — [33fb5be](https://github.com/becked/per-ankh/commit/33fb5be5c270bf7fe40e43cdc3b6eb7b88c65244)
- (parity) cover match_metadata + tile_ownership_history — [653d068](https://github.com/becked/per-ankh/commit/653d0687318ac50d97de820e18125554299799c4)
- (parity,parser) share-parity harness + CityTerritory extraction — [400b130](https://github.com/becked/per-ankh/commit/400b130cc1b0776c619c44adc9c89752803e380c)
- (parser,dev) browser parser MVP page + map turn slider parity — [9b34cd4](https://github.com/becked/per-ankh/commit/9b34cd4ddee59a67adce28a3e01fff82cb99cdb1)
- (cloud) D1 schema + Discord auth + games upload/library — [a6d637a](https://github.com/becked/per-ankh/commit/a6d637ab9a6731db902079884814fb98292f8ea8)
- (cloud) observer mode + single-pick player picker — [41da010](https://github.com/becked/per-ankh/commit/41da0106b223ff823583bf9ac3ef89e5c7024efc)
- (cloud) /v1/stats + dashboard + player_summaries backfill — [2e2dd46](https://github.com/becked/per-ankh/commit/2e2dd464f07d11955fc3b6f3fead910dda619e25)
- (cloud) public game sharing + adapter-cloudflare SSR — [00e33ea](https://github.com/becked/per-ankh/commit/00e33eaee5a0ac251bcc376538f41e27d6ce35ec)
- (cloud) raw save download — GET /v1/games/:id/download — [783781e](https://github.com/becked/per-ankh/commit/783781e1f720f093cefdde01ee49f9939b8ff451)
- (cloud) re-import on parser version bump — [3b272f2](https://github.com/becked/per-ankh/commit/3b272f2a8c6157b5a05fb0c2f536509b598fdc71)
- (cloud) persistent header for cloud routes — [4ed0c95](https://github.com/becked/per-ankh/commit/4ed0c951b827c43d91d738c68ece6b18bc2eeafb)
- (cloud) /account page — Discord identity, OnlineIDs, sign out — [297eadd](https://github.com/becked/per-ankh/commit/297eaddde3d0cfbeb4ed229827dfb63490692c2f)
- (cloud) marketing landing at root on cloud build — [960806b](https://github.com/becked/per-ankh/commit/960806bf8090895258f366f460ac700f09cd5e56)
- (cloud) rename Re-import to Reparse — [dde3815](https://github.com/becked/per-ankh/commit/dde3815f73b5e5409460157b608c30d945af1f0a)
- (cloud) bulk upload up to 25 saves at once — [64f86dd](https://github.com/becked/per-ankh/commit/64f86ddea23297e6069aaa53549ba4381e9fa446)
- (cloud) per-ankh CLI for local dev (worker + sveltekit) — [efd22d1](https://github.com/becked/per-ankh/commit/efd22d17bfea3aff1ad6749c8529f6944c5dfaf7)
- (cloud) gate login to a single Discord ID for initial release — [ba6cbe2](https://github.com/becked/per-ankh/commit/ba6cbe2ec9953837eb1d374963343b9a3f2e26e3)
- (cloud) move anon-read rate limit from Cache API to D1 — [cb8cb0e](https://github.com/becked/per-ankh/commit/cb8cb0ec6e41ded4763b663f0c00d594c8c285b1)
- (games) bulk reparse for games on older parser versions — [60aee1c](https://github.com/becked/per-ankh/commit/60aee1c95743274be3718de5ffc130b2573b9d2f)
- (cloud) port game sidebar + collections to /dashboard — [0f71782](https://github.com/becked/per-ankh/commit/0f71782fc5e72cea52970bfda4da0f8242c21814)
- (cloud) resizable sidebar + auto-hiding thin scrollbars — [93780c3](https://github.com/becked/per-ankh/commit/93780c376e87e88ac808262e314e80a7130435a0)
- (cloud) structured JSON logging + CSP report endpoint — [06e88b6](https://github.com/becked/per-ankh/commit/06e88b613b84dcdcc2491ac651c4a5dd838e52ee)
- (cloud) close audit-log gap on auth + online-id endpoints — [0dd72f5](https://github.com/becked/per-ankh/commit/0dd72f50b2bb1b4298c64714d65115f084a09b8d)
- (cloud) remove Tauri runtime — [f97c09a](https://github.com/becked/per-ankh/commit/f97c09ae51acac4408259edf3c281ea168845f94)
- (cloud) rebuild app header and inline game-detail actions — [280f4e0](https://github.com/becked/per-ankh/commit/280f4e0621ed75f424c1d40e2937cd68047b103f)
- (cloud) restyle auth surface and unify login terminology — [e5b2098](https://github.com/becked/per-ankh/commit/e5b2098f50e25482a3aefe3498654059e337a200)
- (cloud) hide sidebar and search on non-owner game pages — [f657f60](https://github.com/becked/per-ankh/commit/f657f60b4dc3357be7acb7adb7f5e10fd0c1524a)
- (cloud) restyle game-detail summary strip to match overview cards — [cd1cc90](https://github.com/becked/per-ankh/commit/cd1cc905525c4ea7ff447ae29227e2a333767878)
- (cloud) cross-filter sidebar from dashboard nation and calendar charts — [a129416](https://github.com/becked/per-ankh/commit/a1294161999c38a018bb7eb3a68e23f55a4478d6)
- brand favicon, OG card, and unfurl metadata — [4afb177](https://github.com/becked/per-ankh/commit/4afb1778ca26119eed73a12d39ae267dd88dd482)
- (cloud) restyle dashboard to match game-detail charts — [d49f4ab](https://github.com/becked/per-ankh/commit/d49f4ab5917646b2316e9faffa90c053ad30da9c)
- (cloud) gate login on Discord username allowlist — [7541f07](https://github.com/becked/per-ankh/commit/7541f070c2f7a38dffd28807ce4746e47d2b0ae2)
- (cloud) restyle upload flow to match card pattern — [dba7dd5](https://github.com/becked/per-ankh/commit/dba7dd5ef0cb1022c863784ee0580183b4c16b07)
- (cloud) tighten header menu and clarify Upload label — [7aeb9a8](https://github.com/becked/per-ankh/commit/7aeb9a844da13438fd05f4dcffa15c7f2c736804)
- (cloud) hieroglyph parade band on upload surfaces — [198f5ff](https://github.com/becked/per-ankh/commit/198f5ff15e3286884ec515dad70d286436edd8f8)
- content-hash atlas and sprite assets for immutable caching — [373ce65](https://github.com/becked/per-ankh/commit/373ce65de7693a37f7c2806a3b4d3f6a19536795)
- (cloud) redirect /share/\* to legacy.per-ankh.app — [b49400d](https://github.com/becked/per-ankh/commit/b49400d863f3731a70ad4c091c041a846cf54246)
- (cloud) redirect signed-in visitors at / to /dashboard — [dedeef1](https://github.com/becked/per-ankh/commit/dedeef17e4d653f51cd9954bdbc3ce6dcee48aaf)
- (prod) add ./per-ankh prod deploy & preflight CLI — [25bec18](https://github.com/becked/per-ankh/commit/25bec1883ba6fa2138881f319e1c06bed0a85a18)
- (ui) add collection button to game detail actions — [e4a2b97](https://github.com/becked/per-ankh/commit/e4a2b97c40c783ac2d022bdb17afe0e760cffcce)
- (techs) use OW XML display names for tech labels (closes #32) — [8e26cd6](https://github.com/becked/per-ankh/commit/8e26cd6c299298326637880cb49f186e5e3fdad8)
- (tournament) full first pass — schema, worker, frontend, CLI — [8de96ff](https://github.com/becked/per-ankh/commit/8de96ffd31598693b42df6e3b3470f2223339aff)
- (auth) gate Discord login on OW guild membership — [6b6b891](https://github.com/becked/per-ankh/commit/6b6b891bd32d5ce2fcceb074b686e84a63b6ae98)
- (tournament) enforce swiss_seed NOT NULL for swiss-phase slots (#22) — [aeaea48](https://github.com/becked/per-ankh/commit/aeaea48e9404d3f9c1a1ff00010f54e620f7b007)
- (auth) replace Discord-guild gate with invite-code passphrase — [a12d6cd](https://github.com/becked/per-ankh/commit/a12d6cd7f5fa164d9fb7020fa3381de40099fa96)
- (header) list user's tournaments and admin tournaments in the menu — [ba62f9a](https://github.com/becked/per-ankh/commit/ba62f9ad1dec1211d4e2d3e752312f9f6d6eca8c)
- (tournament) replace stacked tables with W-L flow and SVG bracket — [336c5af](https://github.com/becked/per-ankh/commit/336c5af61fe5f6dddd3aaceaea1b368470b99241)
- (header) add upload icon, sync search width to sidebar, balance vertical padding — [482c0cd](https://github.com/becked/per-ankh/commit/482c0cddda19245304bb12ceb8fc87011f1894e2)
- (tournament) auto-advance rounds, collapse admin lifecycle to two gates — [ad25f08](https://github.com/becked/per-ankh/commit/ad25f08a11c370c3be1e683b6c9cf98a7a5f0a93)
- (tournament) collapse admin/match routes into modal-driven public page — [5972110](https://github.com/becked/per-ankh/commit/59721104f857ecb8db52d58569005e3349bab5f5)
- (tournament) let admins set match results without a save upload — [c1d9baf](https://github.com/becked/per-ankh/commit/c1d9baf3658a16f76e8be303d63ffe46d1299577)
- (tournament) show first pick and map name in swiss bracket cells — [19d7bf9](https://github.com/becked/per-ankh/commit/19d7bf93a03347354924eff2279a53dc0312620e)
- (tournament) create tournaments from the UI — [ddfb3d0](https://github.com/becked/per-ankh/commit/ddfb3d0d1ecd1a49152c01000444e719fc68daa0)
- (game-detail) show uploader nation in title and add Winner panel — [673329c](https://github.com/becked/per-ankh/commit/673329c030b69773793249d508ee1a19a3f990fb)
- (tournament) drag-and-drop reorder of swiss-phase slots — [c04ae02](https://github.com/becked/per-ankh/commit/c04ae0261023c10b7e8b5559501b095bd22ac286)
- (tournament) admin-only setup phase with inline auto-save panels — [5542c07](https://github.com/becked/per-ankh/commit/5542c07d54aef228bb448df96519999e55884c63)
- (tournament) admin-configurable per-script map options — [535cf38](https://github.com/becked/per-ankh/commit/535cf38d66b3066ddef67037a976f12fdd6e50f7)
- (tournament) private-beta allowlist gates every tournament surface — [457e406](https://github.com/becked/per-ankh/commit/457e4062d594f085e91ebd4ca31cd9528fbccac9)
- (tournament) expose map size and aspect ratio per script — [aaada5e](https://github.com/becked/per-ankh/commit/aaada5e60952d5812a07085d00b30379e03635bd)
- (tournament) show championship bracket above swiss brackets in championship phase — [bdbbdf5](https://github.com/becked/per-ankh/commit/bdbbdf5977d64a29700881aceba10fbcb69886cf)
- (tournament) drop cutoff, everyone with N wins qualifies for bracket — [bc4ad57](https://github.com/becked/per-ankh/commit/bc4ad57d9c71d25f5fdbbe546d2c963595a3769a)
- (map) add overlay zoom/fit controls to SpriteMap — [37d0884](https://github.com/becked/per-ankh/commit/37d088469ed0659ba366cf9fab8be79bc5818f0d)
- (admin) dev-login CLI for local 2nd-user testing — [183a66f](https://github.com/becked/per-ankh/commit/183a66f34ca691cdbd4a87d167ba96385c6fbc92)
- (tournament) self-signup + slot autocomplete — [3e17654](https://github.com/becked/per-ankh/commit/3e176547f1bd450b345fb8e6b7a388a02debe1f7)
- (ui) styled error page matching app chrome — [1bbc449](https://github.com/becked/per-ankh/commit/1bbc4498e8b9ababc5ace6092a8b6cdd76234fa1)
- (home) rebuild home as public discovery feed — [966eda8](https://github.com/becked/per-ankh/commit/966eda84117e7a20b3c8bd0d454dcf653464aac9)
- (dashboard) remove My Tournaments section — [fb36e86](https://github.com/becked/per-ankh/commit/fb36e864fdd490bbc547101f0119deed81311874)
- (header) label the upload button "Upload" alongside its icon — [6181b1f](https://github.com/becked/per-ankh/commit/6181b1f829c447255244443447116da622bf8527)
- (game-detail) surface uploader identity when save has no leader name — [6bfe91b](https://github.com/becked/per-ankh/commit/6bfe91b301d306d006895f31bd62c7b1366c0553)
- (tournaments) rebuild listing with RecentSaveCard-style row cards — [64b8d95](https://github.com/becked/per-ankh/commit/64b8d95231260dd3f639490ea6c1ff84b02d28d9)
- (tournaments) simplify create modal to name + description — [d5df9bc](https://github.com/becked/per-ankh/commit/d5df9bc0a914ab3d8ebda3d6ad164ea4d72e4065)
- (home) replace generic player icon with uploader's Discord avatar — [512851d](https://github.com/becked/per-ankh/commit/512851d1845ca284eb8a428fe718651c33db2d8b)

### Fixes

- (bake) run sprites before crests in bake:all — [9b49f6e](https://github.com/becked/per-ankh/commit/9b49f6ec7e42ac7554be3c54abd6c3c059b8f4b9)
- (cloud) drop owner Cache-Control to no-store — [466e062](https://github.com/becked/per-ankh/commit/466e062d5347a26f673de7feac45f0bc33ba3ece)
- (cloud) assert CF-RAY on rate-limit paths, document CSRF stance — [42623ee](https://github.com/becked/per-ankh/commit/42623ee297ea416db2768c696ea334294b7fcbbe)
- (cloud) deep-walk OnlineID strip; document OAuth callback race — [f6c551f](https://github.com/becked/per-ankh/commit/f6c551f23458f88b8e5a62954f7062c57bb88826)
- clear pre-existing lint errors — [2fafe9c](https://github.com/becked/per-ankh/commit/2fafe9c235643c13ca260f3901d9b27c0d1bcb74)
- (cloud) drop public-read s-maxage from 1h to 60s — [4c7f829](https://github.com/becked/per-ankh/commit/4c7f829f2bbaf2d62237b1fb79420c8e7827c971)
- (parser) detect legacy winner XML formats + accept GameOver-only saves — [b59452b](https://github.com/becked/per-ankh/commit/b59452bb347824c433a731950a6f5cfef81059e2)
- pin SvelteKit dev server back to port 1420 — [a86a246](https://github.com/becked/per-ankh/commit/a86a246cef3cc7a3779f2fa92276b1b3b47a6342)
- (cloud) skip Discord consent screen for returning users — [f6b67c3](https://github.com/becked/per-ankh/commit/f6b67c301d781f9892891d4c79fda1a14fdddbae)
- capitalize Save Analytics in default page title — [f6fc674](https://github.com/becked/per-ankh/commit/f6fc6749c957b1adec1b5567fdbcb8d4d5a87650)
- (cloud) parade borders and static row span full band width — [f6ff7dd](https://github.com/becked/per-ankh/commit/f6ff7dd927210e4d6d631e3252c954755af44a20)
- (cloud) share session cookie across per-ankh.app subdomains — [f25db39](https://github.com/becked/per-ankh/commit/f25db39261654e7753a235812a6e62149ab5bdd2)
- (cloud) read meta from merged page data, not layout data — [674a4aa](https://github.com/becked/per-ankh/commit/674a4aac0549da5a0c6fddf311b3cfa7342a4d95)
- (csp) allow Cloudflare Web Analytics beacon — [698fd78](https://github.com/becked/per-ankh/commit/698fd78f6267705950882a9901917cb58dcc5601)
- (cloud) hide download action for anonymous viewers — [14c1bb3](https://github.com/becked/per-ankh/commit/14c1bb374cc5bd3a8b1973bfefee57381cecd1ce)
- (web) default missing array fields in older share blobs — [00e83d3](https://github.com/becked/per-ankh/commit/00e83d34d4c820e810899a3508227e36fb4f3d1d)
- (cloud) bump upload rate limits and promote to wrangler vars — [b19004e](https://github.com/becked/per-ankh/commit/b19004e6391552be271864aba0e9a6f202817edf)
- (cloud) point legacy CORS at legacy.per-ankh.app + Vary: Origin — [161d91c](https://github.com/becked/per-ankh/commit/161d91cccefa63da366f4e8cf7861682e99fc6c1)
- (cloud) point header wordmark to / for anonymous viewers — [c7389c2](https://github.com/becked/per-ankh/commit/c7389c2af71e082644bc0189e9ed58e4e5996a12)
- (cloud) hard-reload on logout to avoid stuck state — [f295d20](https://github.com/becked/per-ankh/commit/f295d200bfa67ac3fa9559cc8ce97c5582220317)
- (ui) rename ReimportButton state → status to unblock svelte-check — [616832c](https://github.com/becked/per-ankh/commit/616832ced680349184c1570b1b410637c467f290)
- (csp) detect dev via argv, not NODE_ENV — [5e5e47f](https://github.com/becked/per-ankh/commit/5e5e47f4d015650aba3f0961b446bad1caaea19c)
- (cloud) gate session cookie Domain on HTTPS, not request URL host — [3a166ed](https://github.com/becked/per-ankh/commit/3a166ed4d2407453f17d8c82052f6bb3f57c8c2a)
- (ui) collapse /login into /, refresh layout after OAuth callback — [9215618](https://github.com/becked/per-ankh/commit/92156189c808ec920b0fe2290ab6b00550df4f9f)
- (lint) drop unused svelte-ignore rule from GameActions popover — [5b7bdf9](https://github.com/becked/per-ankh/commit/5b7bdf9050f87ff74a7fe87f21d2bc1b02758da5)
- (tournament) authz + data-integrity bundle (#1, #2, #3, #4, #5, #7, #8, #10) — [56923f4](https://github.com/becked/per-ankh/commit/56923f47c1de3a853a9a4cae958a435c519ef376)
- (tournament) worker invariants + error shape (#6, #9, #14, #21, #23, #24, #25, #26) — [2303253](https://github.com/becked/per-ankh/commit/230325364a6d62138b1fab341d08ed5cff57cfab)
- (tournament) UI bugs in admin + components (#13, #14 UI, #15, #16, #18, #19, #31, #32) — [dab2251](https://github.com/becked/per-ankh/commit/dab2251735acc7a59a089e3e76503c12b336a85a)
- (tournament) bulk upload observer mode for 3+ humans (#17) — [cf3d8c1](https://github.com/becked/per-ankh/commit/cf3d8c1b6e6a34fb814fa386506315a420435f99)
- (api-cloud) tighten tournament client types + cloud typecheck (#11, #12, #30) — [5c73729](https://github.com/becked/per-ankh/commit/5c73729352936096d731491e585374a36992156e)
- (admin-cli) tournament command polish (#27, #28, #29) — [150b6eb](https://github.com/becked/per-ankh/commit/150b6eb296abdb52aca9cf2339f13d021b3ae604)
- (admin) validate map_script values when creating tournaments — [a36d10e](https://github.com/becked/per-ankh/commit/a36d10ef790a1367e3647ea1b8e1c1895e7a5a81)
- (games) lock out delete of tournament-linked saves — [13b3f08](https://github.com/becked/per-ankh/commit/13b3f081f9480a99ac49ce76e29a04df8aa03e13)
- (deps) bump svelte to 5.55.7 and devalue to 5.8.1 — [d9559cc](https://github.com/becked/per-ankh/commit/d9559cc875ff1b97a11683337841d56ee9c70456)
- (csp) detect dev via PER_ANKH_DEV env var, not process.argv — [3a706f2](https://github.com/becked/per-ankh/commit/3a706f2432d4bfbe899fe2b5e05456b68e34414b)
- (tournaments) redirect anonymous visitors to login — [b2e6edd](https://github.com/becked/per-ankh/commit/b2e6edd2d6d57d14d8ff96552d10a086b0f91593)
- (auth) default post-login redirect to / and refresh redirect call sites — [0f852e6](https://github.com/becked/per-ankh/commit/0f852e668533140e750dd7fdb35004048229af77)
- (game-detail) show winner in header when name is empty — [d05be0b](https://github.com/becked/per-ankh/commit/d05be0b38909754c75b10694f28559a60810399c)
- (csp) patch dev CSP at SSR time instead of in svelte.config.js — [04b117b](https://github.com/becked/per-ankh/commit/04b117b1f79778769ff9c4a96e3dab2795f8a898)
- (error-page) point home link at / and add a Go back option — [e72104a](https://github.com/becked/per-ankh/commit/e72104a8d01fbc1d9cc9820aae74cfae7224a6e5)

### Other

- remove unused theology and 3D unit sprite assets — [5ef7252](https://github.com/becked/per-ankh/commit/5ef725294f85a3df105c41d952fc5cb366989acb)
- clarify license boundary between code and game assets — [b409345](https://github.com/becked/per-ankh/commit/b409345a43375670280cb5995d1b206675f14547)
- refresh atlas manifests for pinacotheca 2.3.0 — [f09cefa](https://github.com/becked/per-ankh/commit/f09cefacedfd983e8aca493e328bb8a01107dc5c)
- gitignore baked assets and remove from tracking — [6ea5dce](https://github.com/becked/per-ankh/commit/6ea5dce6c302e4c5b6eda74e37c47bd1822ced60)
- gitignore assets/atlas-sources/ (duplicate bake output) — [9995825](https://github.com/becked/per-ankh/commit/9995825f87745da4b10143892cdeb2d2a7d64c9a)
- switch cloud auth to Discord OAuth and add tournament spec — [ab6653d](https://github.com/becked/per-ankh/commit/ab6653dae227b2d13c491bd6f87cf5adc948ba98)
- revise cloud-rewrite spec with v1 design decisions — [3190952](https://github.com/becked/per-ankh/commit/3190952253dad601886998a063a556226f71526e)
- drop replay stripping, add test corpus, clarify in-place layout — [1fc69bd](https://github.com/becked/per-ankh/commit/1fc69bd02a8bc0cf4157b774acd426ac17e9eaa2)
- add prospector tournament saves to test corpus — [ab79710](https://github.com/becked/per-ankh/commit/ab7971026bd5072a47276a8fc170ba46d848ef81)
- pin parser-rewrite details (parity harness, XML quirks, uploader picker) — [a93a127](https://github.com/becked/per-ankh/commit/a93a1273419824db5ffd05f8aa0ec9036da82886)
- drop fault-tolerant principle (no v1 backing, redundant with browser-first) — [d5c544a](https://github.com/becked/per-ankh/commit/d5c544a85a260221b3be2d7f8edd44a1caea4c7f)
- tighten cloud-rewrite code examples for SvelteKit best practices — [48ef4f3](https://github.com/becked/per-ankh/commit/48ef4f3980a5900c043003c91c2c99e2dd702dd4)
- (csp) allow localhost worker in dev — [6b9478f](https://github.com/becked/per-ankh/commit/6b9478f5e4510bb154feced7a8a3b7f9ed0df6c7)
- cloud productionization plan — merge, cutover, bake, Tauri sweep — [9d31889](https://github.com/becked/per-ankh/commit/9d3188999c5c0a9174e167c549db313021d7015d)
- add observability requirements + Logpush decision flag to cutover plan — [86570df](https://github.com/becked/per-ankh/commit/86570dfd5edd94720b3274855ce2199dffc1c7a5)
- rename per-ankh.sh → tauri.sh — [e2ac2ed](https://github.com/becked/per-ankh/commit/e2ac2eda7a685640ba505b5efdd6942e53fba6a8)
- (cloud) split bake into two stages around login allowlist — [805e61c](https://github.com/becked/per-ankh/commit/805e61c2603bd238771fa0ed2aa4eb1e85eb724f)
- drop parity harness and Tauri dev scripts — [27427db](https://github.com/becked/per-ankh/commit/27427dbeaa67e8f22d7ba0e7d2806065362ed08d)
- drop Tauri release workflow — [b4f279b](https://github.com/becked/per-ankh/commit/b4f279bc6ccc322dc67713dc77cb122c6ec9f5fd)
- rewrite project docs for cloud-only — [3de946c](https://github.com/becked/per-ankh/commit/3de946c2f8be90ba48fc999da931ed6813a1d249)
- add forward-only cloud deploy plan — [c9c68fd](https://github.com/becked/per-ankh/commit/c9c68fd7787551198b6141959057e2260ae04c8e)
- note Discord OAuth redirects are already configured — [266bab0](https://github.com/becked/per-ankh/commit/266bab0d563678460cee9c03ca44a475b136ed1e)
- tighten deploy plan after verification pass — [eb9e34a](https://github.com/becked/per-ankh/commit/eb9e34a2a61a887dea980e59b667d28566735acc)
- add design language audit reference — [e7ced01](https://github.com/becked/per-ankh/commit/e7ced01d8f23f47e955fc5bc5b3eed152061c055)
- apply prettier formatting across repo — [3719a0d](https://github.com/becked/per-ankh/commit/3719a0dffd464af41319549ab17e883b323cb1d7)
- (cloud) wire real SESSIONS_KV namespace IDs — [735e15f](https://github.com/becked/per-ankh/commit/735e15f76646aa0fc73adb3a6c1fcabd00a5d86b)
- (cloud) add root wrangler.toml for SSR Worker — [4894b35](https://github.com/becked/per-ankh/commit/4894b3511d4158fa177eb05f398fa28d87b3f88a)
- prod-safe defaults for frontend env vars — [85e21ba](https://github.com/becked/per-ankh/commit/85e21ba52df289418de5c00f5bf9d18680993187)
- (deploy) correct §3.7 to match actual Cloudflare notification catalog — [88ea930](https://github.com/becked/per-ankh/commit/88ea930725764c3f35cd84b877a050314f66d082)
- tighten about disclaimer and add takedown contact — [7f97fa3](https://github.com/becked/per-ankh/commit/7f97fa3e3f5f4eeb65f3306cfe6c90885e78b76f)
- (admin) replace cloud/admin.sh with ./per-ankh admin — [b8282ed](https://github.com/becked/per-ankh/commit/b8282ed32a39be0786c2a5295f1d1aac1d814bd4)
- add security review and action-flow walkthrough — [e07fcfa](https://github.com/becked/per-ankh/commit/e07fcfad050b0d51e039baae6330380dcf0a3d61)
- (deps) bump fast-xml-parser 5.7.2 → 5.7.3 — [c6e1ca2](https://github.com/becked/per-ankh/commit/c6e1ca2ee7271935e32064c58d2087465b05a063)
- prettier format — [8cd900b](https://github.com/becked/per-ankh/commit/8cd900bbe2925ced39bd1b1ab9dbc878842132ab)
- format generated manifests via prettier — [3ee85f9](https://github.com/becked/per-ankh/commit/3ee85f9dc4006fde080367425df3f4553f280cb9)
- correct stale "no individual units in saves" claim — [b10d5cb](https://github.com/becked/per-ankh/commit/b10d5cbf9e38d15c80279a4111025a3e0b9c19e6)
- cull stale Tauri/Rust/DuckDB references, consolidate save-format knowledge — [7b2cd87](https://github.com/becked/per-ankh/commit/7b2cd878cfc7b55c775cc6db24f60f5ac0fb1f2f)
- prettier format docs — [0899bf0](https://github.com/becked/per-ankh/commit/0899bf004deea219c96d741c03d7ab04cfb59447)
- (game-detail) use stable identity for each-block keys (closes #33) — [ce76ea5](https://github.com/becked/per-ankh/commit/ce76ea507e69048c8b1b8e480b5ef6f3942fceef)
- (tournament) self-review of first-pass tournament implementation — [4a867ed](https://github.com/becked/per-ankh/commit/4a867ed9bdaa79989d0abc4b2a7d37f6fae3ad75)
- (cloud) integration test harness for tournament handlers — [f6e4ecc](https://github.com/becked/per-ankh/commit/f6e4ecc50e86e77952b1079a4a673b1941bf9c05)
- (tournament) mark closed items in code-review punch list — [c47c8c5](https://github.com/becked/per-ankh/commit/c47c8c5734e518aa735e4b15ee35304914dbe69b)
- (tournament) exercise the rematch-swap branch in pairing (#20) — [400a603](https://github.com/becked/per-ankh/commit/400a60361bd3ca6051463550e4ef30ae36d7da7f)
- (tournament) add per-item status lines for closed punch-list items — [526e5f0](https://github.com/becked/per-ankh/commit/526e5f068c36b76d74a511f7e302c74509d4e3b7)
- (og) replace default share image with header wordmark — [062a2ee](https://github.com/becked/per-ankh/commit/062a2ee5c1314e0cf47ebfb9499f9ca5ce9300b7)
- (tournament) retire code-review punch list, refresh post-ship status — [d9faf8e](https://github.com/becked/per-ankh/commit/d9faf8ee58d726b3391efcd74da5d8f7c6ed6f44)
- (tournament) harden admin surface + backfill integration coverage — [901276e](https://github.com/becked/per-ankh/commit/901276edbda5f98f2b293fb45c42c7d00ebb113f)
- (tournament) retire closed open-work items, refresh post-hardening status — [1d4da8a](https://github.com/becked/per-ankh/commit/1d4da8afc7ef9c6d08ed3dbe888e1be16407a235)
- (tournament) rewrite workflow-shape note for auto-advance lifecycle — [17a125d](https://github.com/becked/per-ankh/commit/17a125d23b09ca2e8ff023a908ffada708ace956)
- (tournament) rename match status 'reported' to 'complete' — [0ec0c75](https://github.com/becked/per-ankh/commit/0ec0c75fba4a5a15ffbb751b968a220ce68d5ecd)
- temper atomic-commits rule with a pragmatism note — [239b6bf](https://github.com/becked/per-ankh/commit/239b6bfa1e1304751e658731437678158e1e6b3e)
- (tournament) tighten swiss flow bracket round column min-width — [a242f8a](https://github.com/becked/per-ankh/commit/a242f8af79944441f381266d0eb24565a001bae1)
- (tournament) refresh implementation notes against current code — [3bf83f2](https://github.com/becked/per-ankh/commit/3bf83f29eda93c6913363f4ea73dfc092c42ceba)
- (tournament) tweak swiss bracket map label placement and widen detail page — [8144797](https://github.com/becked/per-ankh/commit/8144797f552a682929e68619f14dbdb45b3e6140)
- (tournament) correct admin-write-path comments — [a7ea30d](https://github.com/becked/per-ankh/commit/a7ea30dc0c1dec96cd70c89419f1ca4cb4c36e3e)
- (claude) add prod-targeting command guardrail — [7a41e71](https://github.com/becked/per-ankh/commit/7a41e714bd80081d27c5b8f232778662ed10aca2)
- (security) add ASVS 5.0 Level 2 coverage review — [8395e7c](https://github.com/becked/per-ankh/commit/8395e7c229f5f38ec3ca2663d7a8343aeda10396)
- (tournament) add PR #49 code review — [a833245](https://github.com/becked/per-ankh/commit/a8332459a317713b3bc5f8bc2d7a260189c3832e)
- (tournament) add tournament-branch security review — [32f5d1f](https://github.com/becked/per-ankh/commit/32f5d1f35c07983a35bc9588bdd8e268bb27a73c)
- apply prettier formatting — [4e073f5](https://github.com/becked/per-ankh/commit/4e073f5ddc760450242194935fb9fd6b037c1894)
- drop the dismissible "you're signed up" tournament banner — [61310bf](https://github.com/becked/per-ankh/commit/61310bf67c3a0033b427d0188ce05f4830c167f9)
- prettier pass — [cbb4080](https://github.com/becked/per-ankh/commit/cbb408032269f3e69e27ec458ab28e13fe84ed3e)

## [0.3.0] - 2026-05-01

### Added

- Sprite-based map view replacing the legacy hex map — terrain rendered as 3D per-(biome, height) sprites with nation-specific urban and capital tiles, resources, and improvements composited per tile
- Political and religion overlays on the map with smoothed boundaries
- Hover and right-click-pinned tooltips on map tiles, including terrain height and tile coordinates
- Turn slider and play/pause controls for stepping through the game on the map
- Fullscreen toggle for the map tab
- Shared games render the new sprite map in the web viewer; older shares without map data show an explanatory message
- Atlas bake pipeline: `npm run bake:terrain-3d`, `bake:improvements`, `bake:resources`, `bake:crests` (or `bake:all`) regenerate runtime atlases from pinacotheca renders and OW Reference XML
- Map Atlas Pipeline section in `CLAUDE.md` documenting cell geometry, hex masking, and per-script bake responsibilities

### Changed

- Map sprites rendered via deck.gl `IconLayer` instead of bitmap composite, lifting prior `GL_MAX_TEXTURE_SIZE` cap on large maps
- Improvement atlas now driven by XML `zType` → `zIconName` mapping (including DLC `improvement-add`/`improvement-change` mods)
- Hex grid aligned to game-accurate 1.225 aspect ratio at 45° camera tilt
- Resource sprites toned down: SOLO variants render at 0.30 scale and 70% opacity to reduce visual noise

### Fixed

- DLC nations and tribes now render with correct colors (off-by-one tribe color palette corrected)

## [0.2.0] - 2026-03-27

### Added

- Share game feature with cloud infrastructure and web viewer — upload game analytics to Cloudflare and share a public link at per-ankh.app/share/{id} with the full tab experience in a browser
- Virtual "Shared" filter in sidebar collection dropdown to find all shared games
- Overview tab with nation profile cards, army composition bars, key metrics comparison, wonders, and sprite icons
- Timeline tab with multi-column table showing techs, laws, cities, battles, and religions per turn
- Cumulative/per-turn toggle for all yield charts
- Sticky table headers in game detail tabs
- Cloud admin CLI (`cloud/admin.sh`) for managing shared games, blocking keys/IPs, and viewing audit logs
- Auto-updater UX improvements: modal dialog with progress, cancellation, and timeout
- ESLint and Prettier for frontend linting and formatting
- Three-tier database query tests (67 tests across 6 modules)
- Content Security Policy enabled in Tauri config

### Changed

- UI refresh across all game detail tabs: borderless panels, consistent dark theme, system font stack for charts
- Extracted shared game detail components from desktop and web pages into reusable `src/lib/game-detail/` module (47% code reduction)
- Extracted query logic from `lib.rs` into `db/queries/` modules
- Consolidated game detail page state into typed objects
- Military tab now includes army composition pie charts per nation
- Replaced hardcoded hex colors with CSS variables
- Replaced `as any` and broad types with strict `EChartsOption` typing
- Removed redundant section headings from Yields, Military, Cities, and Map tabs

### Fixed

- Sidebar trophy now uses `primary_user_online_id` instead of save file creator
- Victory points panel hidden when not applicable instead of showing disabled message
- XML parser memory leak — parser memory now properly reclaimed
- Glob command injection vulnerability resolved
- All Tauri command error conversions now use `.context()` for proper error messages
- Accessibility warnings resolved in GameSidebar and HexMap
- Deprecated `<slot>` replaced with `{@render children()}` in layout
- `set_default_collection` wrapped in transaction for atomicity
- `match_id` query error now propagated instead of silent fallback
- Appender errors surfaced via explicit `app.flush()` instead of `drop(app)`

### Security

- Updated wrangler to v4 to resolve OS command injection vulnerability (GHSA-wqxr-x6cw-wg6g)
- Updated npm dependencies to resolve security vulnerabilities
- Updated bytes and time crates to patch security vulnerabilities
- Cloud share API hardened with rate limiting, blocklists, timing-safe token comparison, and error sanitization

## [0.1.10] - 2026-02-02

### Added

- Military tab with Military Power chart and Units Produced pivot table
- Techs tab with tech discovery chart and completed techs pivot table
- Separate Laws tab with law adoption chart and current laws pivot table
- 8 additional yield charts: Orders, Food, Money, Discontent, Iron, Stone, Wood, Maintenance
- Automatic update functionality with Tauri updater plugin
- Incremental schema migration system for non-breaking database updates
- Nation filter dropdown for Cities table
- Nation filter dropdown for Improvements table

### Changed

- Renamed "Economics" tab to "Yields" (now displays 16 charts total)
- Split "Laws & Technology" tab into separate Laws and Techs tabs
- Converted Laws, Techs, Units, and Improvements tables to pivot format (rows=items, columns=nations)
- Removed chart series filter buttons (nation colors are self-explanatory)
- Removed duplicate section headers in Laws and Techs tabs

### Fixed

- EventLog data1/data2/data3 fields now parsed as strings instead of integers
- Missing migration entries added to schema.sql

## [0.1.9] - 2026-01-31

### Added

- Support for new Old World save file format (game version 1.0.77+)
- Auto-detection of save owner in multiplayer games
- YieldTotalHistory data extraction for comprehensive yield tracking

### Fixed

- Winner determination in multiplayer games now correctly identifies the victor
- Comprehensive validation of save file references against actual data

## [0.1.8] - 2025-12-05

### Added

- Map tab with interactive hex visualization
  - Two modes: Political, Religion
  - Historical playback with turn-by-turn replay and fast-forward controls
  - Map markers for cities and improvements
  - Pan and zoom controls
  - Fullscreen mode with animated dialog
  - Rich tooltips showing tile details
- Improvements tab showing all tile improvements with sortable columns
- Unit data ingestion (units, promotions, effects, family associations)
- Expanded city data coverage with additional fields and tables
- Sortable columns in Cities and Event Logs tables
- Overview statistics now filter by selected collection

### Changed

- Enum display formatting now strips trailing numbers for cleaner output

### Fixed

- Page state now resets properly when navigating between games
- Cities tab culture level and units produced display correctly
- Database reset no longer fails with "sequence already exists" error
- Road data parsing corrected

## [0.1.7] - 2025-12-01

### Added

- Collections feature for organizing matches into custom groups
  - Create, rename, and delete collections via "Manage Collections" menu
  - Filter game list by collection in sidebar
  - Right-click context menu to move games between collections

### Changed

- Removed foreign key constraints from database schema for improved performance

### Fixed

- Collections context menu UX and styling improvements
- Prevent crash on schema upgrade with version file check

## [0.1.6] - 2025-11-24

### Added

- Release notes template with auto-versioning

### Changed

- Event Logs table and filters updated to dark theme

### Fixed

- CSS isolation to prevent chart overlap on Linux
- Games by Nation chart now counts only save owner's nation

## [0.1.5] - 2025-11-24

### Added

- Linux build targets (DEB and RPM packages)

## [0.1.4] - 2025-11-24

### Added

- Calendar chart on overview page showing play activity
- Egyptian hieroglyph parade animation during file import
- Primary user settings and save owner tracking
- Database corruption recovery with user dialog
- Player difficulty parsing and display from save files
- Mods and DLC parsing separated from save files
- Nation badge on sidebar game cards
- Win indicator trophy badge on sidebar game cards
- Series filter for all game details charts
- Fullscreen chart toggle with open/close animations
- Skeleton loading states for smoother page transitions
- Monthly separators in game sidebar
- Edge fade effect on hieroglyph parade
- Decorative hieroglyph borders on parade animation

### Fixed

- DuckDB WAL corruption on Windows
- Search filtering race condition
- Properly integrate search store with Svelte 5 runes
- Catch up on missed parade spawns when window returns to screen
- Import progress bar no longer jumps backwards
- Transparent icon margins filled to prevent light border

## [0.1.3] - 2025-11-20

### Added

- Law adoption history chart with nation filter and markers
- Fullscreen toggle for charts on game details page
- Event logs table with filtering, deduplication, and player extraction
- Victory type and conditions extraction and display
- Winner extraction from save file XML
- Map type display in game summary
- Nation names in chart legends and tooltips
- Reusable SearchInput component

### Changed

- Military power and legitimacy charts moved to Economics tab
- Chart styling: removed legends, improved typography
- Game details summary layout redesigned
- Game settings sections have light gray background

### Fixed

- Handle both MAPCLASS\_ prefix formats in map name display
- Display victory type as separate metric in game summary

### Performance

- Added index on players(match_id, player_id) for winner JOIN optimization

## [0.1.2] - 2025-11-11

### Added

- Apple notarization for macOS releases

### Performance

- Parallel parsing with rayon (Phase 4 optimization)
- Benchmark binary for parser performance testing

## [0.1.1] - 2025-11-11

### Changed

- UI layout reorganized: sidebar on right, header elements swapped
- Logo updated from ankh symbol to Egyptian hieroglyph
- Search box moved from sidebar to header
- Various styling refinements (game sidebar, detail page)

### Fixed

- macOS code signing with Developer ID Application certificate
- Window dragging restored with missing permission
- Chart container null check added

## [0.1.0] - 2025-11-08

### Added

- Initial release
- Save file parsing for Old World game saves
- DuckDB database storage for game data
- File import UI with progress modal
- Overview page with aggregate statistics
- Game details page with multiple tabs:
  - Summary with victory conditions and winner
  - Economics tab with yield charts (food, wood, stone, iron, training, civics, money)
  - Science production chart
  - Military power and legitimacy charts
- Game sidebar with search functionality
- Nation-specific colors in all charts
- Real-time import progress events
- GitHub Actions release workflow

[Unreleased]: https://github.com/becked/per-ankh/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/becked/per-ankh/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/becked/per-ankh/compare/v0.1.10...v0.2.0
[0.1.10]: https://github.com/becked/per-ankh/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/becked/per-ankh/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/becked/per-ankh/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/becked/per-ankh/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/becked/per-ankh/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/becked/per-ankh/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/becked/per-ankh/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/becked/per-ankh/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/becked/per-ankh/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/becked/per-ankh/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/becked/per-ankh/releases/tag/v0.1.0
