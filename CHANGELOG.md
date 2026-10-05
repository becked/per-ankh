# Changelog

## [2026-10-05-ddc6c73] - 2026-10-05

### Features

- (stats) a recency window on the global corpus — [a49cc0a](https://github.com/becked/per-ankh/commit/a49cc0a3d9ae178cf5dd460584e9367a29eb78a1)
- (stats) GDP as a first-class series — [96303b8](https://github.com/becked/per-ankh/commit/96303b82cc8ed9d2db2427144fed01c94717e82c)
- (parser) 2.20.0 — what a challenge scorer needs from a save — [9688d16](https://github.com/becked/per-ankh/commit/9688d16a157ff118c2d242f3f1c6d08d11ec7583)
- (bake) dynasty traits, theology tiers, and unit nations for the scorer — [3573639](https://github.com/becked/per-ankh/commit/357363917c57e88b41471d5e66595f5d1e4eb1cb)
- (challenges) the rules vocabulary, the scorer, and its Worker mirror — [98aeae1](https://github.com/becked/per-ankh/commit/98aeae179cfa72aa4b7f300de286ca99f355ea67)
- (challenges) Worker endpoints, migration 0049, and the challenge upload lane — [52db021](https://github.com/becked/per-ankh/commit/52db021434ccfbefe97ee0dab4f08215378684bf)
- (challenges) the challenge pages, run submission, and the profile scope — [546bacf](https://github.com/becked/per-ankh/commit/546bacfb90d85f3bbd44d18e44191a2b4a0c8fae)
- (video) carry each video's runtime on every video payload — [8574165](https://github.com/becked/per-ankh/commit/8574165da9e1d1fd659593d20b0ba535489f47ba)
- (tournament) group and attribute a tournament's videos — [27f1ad7](https://github.com/becked/per-ankh/commit/27f1ad7a106388d6c52501c63530a7ef3d567697)
- (tournament) serve the video archive — [b3fc42f](https://github.com/becked/per-ankh/commit/b3fc42fbbee6fd2ef99d3e36644554dcc0d632f1)
- (tournament) browse tournament videos by match, part and angle — [4520465](https://github.com/becked/per-ankh/commit/452046522ed7cf045437e253ea8348e2d2424aa5)
- (tournament) the videos tab names each match's bracket — [41afa7a](https://github.com/becked/per-ankh/commit/41afa7a081a68a24afba239c5690256c150c150c)
- (opponents) twelve names on every page, and the floor is the count — [6dc7c94](https://github.com/becked/per-ankh/commit/6dc7c9433043e4b87bfbd00e8d3235fd39c5ef29)

### Fixes

- (stats) address the recency-window self-review — [ba4e68b](https://github.com/becked/per-ankh/commit/ba4e68b7eb0b0607e6c539ee4239c87e0ef660aa)
- (home) the summary reads the window-keyed global entry — [d8ac2eb](https://github.com/becked/per-ankh/commit/d8ac2eb137a4a3975a8c5769af8a7799df7651ee)
- (stats) the Records tab reads the recency window too — [4693844](https://github.com/becked/per-ankh/commit/4693844b447335edd41c39947f0d925fb60ad639)
- (stats) address the GDP self-review — [f88394d](https://github.com/becked/per-ankh/commit/f88394d626a978f97a758c68966008fa89c04c1d)
- (stats) a reindex drops every corpus's cached bundle — [fb9a7a1](https://github.com/becked/per-ankh/commit/fb9a7a1b98ac6b13da7cb6fb380f306052023d6b)
- (challenges) offer Delete only where the Worker will allow it — [e398eba](https://github.com/becked/per-ankh/commit/e398eba2d994d70c5a66c95cf3b416c8d93a6c70)
- (challenges) the setup line reads the game's names, not the zTypes — [cc62b10](https://github.com/becked/per-ankh/commit/cc62b104640a970b3e13b8aec41660cb587a4e8b)
- (upload) name the page by its mode, and give it a trail back — [6c74585](https://github.com/becked/per-ankh/commit/6c745859ffe740631f75e7d20bae0038fd918823)
- carry the query string through the login bounce — [a29e715](https://github.com/becked/per-ankh/commit/a29e715cd737d92f7ab761d1b6f3f8aa0b15c987)
- (challenges) tier improvements by the game's upgrade chain, not the zType suffix — [156434d](https://github.com/becked/per-ankh/commit/156434d10174937da4e0ccf52f8e7a72a5a520db)
- (challenges) the seat strip reads the game's nation names — [c5b17de](https://github.com/becked/per-ankh/commit/c5b17de859906cf6d5e6f1d7cbfe98c1381b84ae)
- (upload) don't promise a load that already failed — [03bafb1](https://github.com/becked/per-ankh/commit/03bafb1203624236e0c9de28eee0afb140ec126a)
- (challenges) the published map keeps no seat name — [94f2169](https://github.com/becked/per-ankh/commit/94f2169c9214a71b256718dd4a6f5f62870001ab)
- (challenges) keep runs out of the home page's feed — [ce02b86](https://github.com/becked/per-ankh/commit/ce02b8603ca5b23dc460fd0f81645411d9f78c90)
- (challenges) keep runs off the played-games board and the profile header — [7daaaf6](https://github.com/becked/per-ankh/commit/7daaaf6158fd37ab9c6d6c69f13a74e4fb168b4e)
- (bake) run unit-stats in bake:all — [faa1eed](https://github.com/becked/per-ankh/commit/faa1eed840b52bad3c4111591e2a58696ac24dcf)
- (tournament) attribute by the versus, not by the first two names — [2509c33](https://github.com/becked/per-ankh/commit/2509c33ef67b0d958e75914610b7d3ae9aee7d1d)
- (tournament) the archive lists live broadcasts and says where it read from — [5f33f9d](https://github.com/becked/per-ankh/commit/5f33f9d8f8b88f76be66d9bad9a04051f3aad0f1)
- (tournament) the archive trusts recorded casters, and its keyless test controls the key — [4917828](https://github.com/becked/per-ankh/commit/4917828209765503c2b2fbd120fc9e730c4946d9)
- (tournament) videos tab follows the archive's source, and its buttons work — [cb34ebf](https://github.com/becked/per-ankh/commit/cb34ebfc9965d20bb6a79be862dc214c7c270d28)
- (tournament) videos tab reads matches through the accessors — [ead16a9](https://github.com/becked/per-ankh/commit/ead16a91ad785902aab3f02b9e6b5fd28aea9cd6)
- (tournament) videos tab filters and match rows match the app — [0d09a44](https://github.com/becked/per-ankh/commit/0d09a4444cf3bee84240f9e52adcca672558fd26)
- (tournament) the videos tab's match row reads like every other match surface — [58521b2](https://github.com/becked/per-ankh/commit/58521b20361100c071242d2896954e7b1778957e)
- (opponents) the card wraps instead of crushing the name — [107a048](https://github.com/becked/per-ankh/commit/107a048a693ce1b49b1e893041aa59bb368ca014)
- (opponents) the twelve-name page meets the map suggestion — [70cfa6d](https://github.com/becked/per-ankh/commit/70cfa6db0e168494963d7506553be7b987f4c9f1)

### Other

- (stats) the window is an argument buildGlobalSelection requires — [fd5721f](https://github.com/becked/per-ankh/commit/fd5721fa67b866025f746ed7e0e1e88e83d47e14)
- (stats) date the window fixtures in days, not months — [fd2cd56](https://github.com/becked/per-ankh/commit/fd2cd564bd04ffbf6f29f2177a29d4bf3551ac1f)
- (stats) the facet row is three controls, not two — [86b60da](https://github.com/becked/per-ankh/commit/86b60dacb30b967a6d0b44bb496d9c823448373a)
- (stats) the window reaches both of /stats' payloads — [af3c5dd](https://github.com/becked/per-ankh/commit/af3c5dd6e80c7a0f0fbc6e2d0a1e7ceb0de70e14)
- (stats) count what the window's string comparison rests on — [f10147c](https://github.com/becked/per-ankh/commit/f10147c882d42e2e8c49fd5d61641a30a7bcaff0)
- (stats) a cache precondition the case establishes, not inherits — [7fe4b72](https://github.com/becked/per-ankh/commit/7fe4b722b35288415459bd4a8bb36f25d0c4fef8)
- (stats) the series count the GDP entry moved, and the rule behind the basket — [30c200e](https://github.com/becked/per-ankh/commit/30c200e56376e74ade0d7304a5d6d6fda4f46672)
- (game-detail) centre the Analysis/Map toggle in the header — [f40fe2b](https://github.com/becked/per-ankh/commit/f40fe2bebbb8af4719759b3685c81784f6cf5c79)
- one saveBlobAs for every authenticated download — [66d2d39](https://github.com/becked/per-ankh/commit/66d2d39ba35d00685e95132f6c2e35b21dd35738)
- (challenges) the challenge maps design doc, as built — [f1d17f1](https://github.com/becked/per-ankh/commit/f1d17f1df77424452111d3bc9700c68d38ca739f)
- (ui) share the destructive button and the rules editor's input class — [482a86b](https://github.com/becked/per-ankh/commit/482a86bc868fe3b667259bc31d72444fd085622b)
- (cloud) put staleParserResponse's comment back on it — [9b1ad77](https://github.com/becked/per-ankh/commit/9b1ad777063bc88bc8592407704350ec0d9f27a6)
- (bake) record the three new bakers in the skill — [73a4daf](https://github.com/becked/per-ankh/commit/73a4dafa7756a2c5418936538cedf9e95bceaaa5)
- (challenges) the design doc matches what shipped — [e63732d](https://github.com/becked/per-ankh/commit/e63732d4d4d6d01206b514e8b6865ecf81a066a7)
- (challenges) count what the scorer's optional fields rest on — [ecf3d25](https://github.com/becked/per-ankh/commit/ecf3d25c482aa2ee95bb3b7bb2fb626f64bf6bd0)
- (tournament) cover the archive endpoint; document it — [d8b71df](https://github.com/becked/per-ankh/commit/d8b71df0a13b1efc8b8c3bc7a67cdd8f49b9b9c2)
- (tournament) record how a video finds its match — [9ca7936](https://github.com/becked/per-ankh/commit/9ca79362f8a41795b05675497b1354e4734309e2)

## [2026-10-04-21ae85d] - 2026-10-04

### Features

- (games) the map moves to its own view at /games/[id]/map — [6057275](https://github.com/becked/per-ankh/commit/60572753ce630d8758ff8371019bf92d6fe8d82a)
- (parser) yield_history says which quantity its cumulative holds — [b0b84e4](https://github.com/becked/per-ankh/commit/b0b84e4c3ae5cd67f4bbdecaa2b96e953661ec87)
- (games) Yields and Techs say "Total" when cumulative is the game's total — [023b277](https://github.com/becked/per-ankh/commit/023b277fc62a6511de11ab84ed307c0e74800268)
- (games) the map view gets its chrome — [22c4c2a](https://github.com/becked/per-ankh/commit/22c4c2a4086b22ce0efceecd5a75a546b3d8041c)
- (games) the map chrome opens the game's tabs in lightboxes — [3ef171f](https://github.com/becked/per-ankh/commit/3ef171f6b0cbcddb213beb26d18a624400b28d18)
- (games) the map view gets city banners and the city popover — [ad36689](https://github.com/becked/per-ankh/commit/ad36689230f7baac97ade0b798ffd42104dc56d2)
- (games) the map chrome reads at the scale of the game's own screen — [c9a47a3](https://github.com/becked/per-ankh/commit/c9a47a3e12be7d3ff9ad71367f52ced24d269176)
- (games) the map chrome's leader panel carries the player's whole view — [42772b9](https://github.com/becked/per-ankh/commit/42772b9ef14841fd1b7a34d0b76b13cd829b36c2)
- (games) every city centre draws the nation's own city tile — [74b6a8c](https://github.com/becked/per-ankh/commit/74b6a8c9d1198834c6166354a74e39afdfabeb3c)
- (opponents) suggest a map, and a message to send — [2a7da57](https://github.com/becked/per-ankh/commit/2a7da57dd6392227702bcbb0f372d2ce7a4a7484)
- (stats) which families players refuse to field — [15dbef4](https://github.com/becked/per-ankh/commit/15dbef42b17462432591236a967a2e01700e06a1)
- (stats) show what players keep, filterable by nation — [1827771](https://github.com/becked/per-ankh/commit/182777159634883172153f8b56dc5711c5a331f7)
- (stats) label the columns and say what each one measures — [c9f7093](https://github.com/becked/per-ankh/commit/c9f7093f7065ca72eebd23f9be8de3329e37e59f)
- (stats) the record boards, on their own endpoint and cache key — [7981b4b](https://github.com/becked/per-ankh/commit/7981b4b9d22c312f9b550bd30b7c1d9bd5e5cc3b)
- (stats) a Records tab on every stats surface — [d040b08](https://github.com/becked/per-ankh/commit/d040b089c721ea0a4c07440d576669ab2462ea24)

### Fixes

- (games) the leader panel's border follows the portrait art, not the id — [14364f9](https://github.com/becked/per-ankh/commit/14364f99d22144c0f8b71cf38e00b6e3559ba658)
- (games) the portrait bake covers every id a save can emit — [229a54d](https://github.com/becked/per-ankh/commit/229a54db33b37631194f930f92c15e3fa72456a3)
- (games) portrait art resolves from both dirs, and the slot follows the art — [e1c7d4a](https://github.com/becked/per-ankh/commit/e1c7d4a67deff68328e6bb1a7de052a740926da8)
- (games) the leader panel's rails keep both slots, filled or not — [fc2be0f](https://github.com/becked/per-ankh/commit/fc2be0f0589da80b41df263934395e22300e3dab)
- (games) the leader panel's rail plates fit what they hold — [2ea39f5](https://github.com/becked/per-ankh/commit/2ea39f544f3c75a9656b82f4b82da134a26ed709)
- (games) tile ownership reads the turn it changed, not the turn after — [ceb188a](https://github.com/becked/per-ankh/commit/ceb188a26ff8e7bfe44f8cdf04fabb91b7627e1a)
- (games) the map's top-bar panels carry the chrome's own tooltip — [7cc41c6](https://github.com/becked/per-ankh/commit/7cc41c63b2748d2ad13eb0781c5bb321607bfb68)
- (games) the map's overlays project into the canvas, not the container — [210a6f5](https://github.com/becked/per-ankh/commit/210a6f5c2b76506d198bf5213cf6de58a49f8e64)
- (games) the map's yield strip drops when the save recorded no rates — [4ea9690](https://github.com/becked/per-ankh/commit/4ea96904f51911e61ab17d0ac15f3f8403edff60)
- (opponents) say which DOTA — [22549ec](https://github.com/becked/per-ankh/commit/22549ec26c4fe69c371cc0eed7a21c8508354af1)
- (bake) bake:all was leaving the Worker's atlas pool stale — [526ab9d](https://github.com/becked/per-ankh/commit/526ab9db680c32dea5c9b65813b1c421789915f7)
- (opponents) act on the self-review — [5f248b8](https://github.com/becked/per-ankh/commit/5f248b8056474ee4a7cc41de25d1916b2d8a2e65)
- (stats) the bar was making a claim the number declined to make — [fac4686](https://github.com/becked/per-ankh/commit/fac46864eeed5247e5a6ef2d47f013d959ab3457)
- (stats) the chance tick draws above the bars, and the note says what colour means — [f91e0e1](https://github.com/becked/per-ankh/commit/f91e0e19a289f6a6c76d9e7522a2789a35ab41d1)
- (stats) families fielded was a second nation control on /stats — [f8b445c](https://github.com/becked/per-ankh/commit/f8b445c77145cc958f8f2f2c5822fd1c71d026b1)
- (stats) the families-fielded headings sit over the columns they name — [ca038f0](https://github.com/becked/per-ankh/commit/ca038f06aac1148b8b4772847084bfcbebe9325c)
- (stats) an empty record board keeps its toolbar — [5d64e47](https://github.com/becked/per-ankh/commit/5d64e47609e82e463a0503def9053bfa14692619)
- (stats) records rank deterministically, over slot-indexed accumulators — [ee2ffe2](https://github.com/becked/per-ankh/commit/ee2ffe26d618ed1b904453ed8ed3580d39a3bb60)
- (stats) a record board's turns and values read as columns — [e567af7](https://github.com/becked/per-ankh/commit/e567af7b0084368974451fc53e6b604f7d701e4b)
- (deps) override undici in cloud to clear the last 6 Dependabot alerts — [fd83679](https://github.com/becked/per-ankh/commit/fd8367936239d845fc3672e4f94aa43fffece201)
- (tournament) bracket turn counts chunk under D1's param cap — [5b179a3](https://github.com/becked/per-ankh/commit/5b179a3e3d810f1c9d994fc93b05ce4d3bc49d40)
- (deploy) unblock the staging preflight's format and audit gates — [21ae85d](https://github.com/becked/per-ankh/commit/21ae85d4f90c80fd79853b283a05780b4f0003d3)

### Other

- (test-data) say what the save corpus is for — [f25cab3](https://github.com/becked/per-ankh/commit/f25cab3c22bf5facc6df8c10d85d310693c16a40)
- the guardrails the merge queue keeps re-teaching — [e544680](https://github.com/becked/per-ankh/commit/e544680a4e10e1af02e0db332511608d630e380d)
- correct the guardrail claims a grep doesn't support — [e23a617](https://github.com/becked/per-ankh/commit/e23a617329e6a360c8eb2c6e6ef9d92c0afe2bba)
- correct the claims the new guardrails make — [363f86d](https://github.com/becked/per-ankh/commit/363f86d351ae074046782c96d3a3d63bbd08370b)
- give the design-system guidance checks a reviewer can run — [64ecfe3](https://github.com/becked/per-ankh/commit/64ecfe3f8c0756399e60dc55b5e6b4b8dcaaaee2)
- the guardrails answer a reader who doesn't have the machine — [a36470a](https://github.com/becked/per-ankh/commit/a36470adabc56271ef0624d24a354b2d03a7b94c)
- (cloud) sync the lock file with package.json — [b54de71](https://github.com/becked/per-ankh/commit/b54de71d485f8d7348f01fed6bda7d15b2854f71)
- (games) the analyst view renders its tabs through a shared GameTab — [971a1ab](https://github.com/becked/per-ankh/commit/971a1ab2ebdf253b52be19a1ecdfc255b33d5e47)
- (ui) ChartContainer's fullscreen dialog becomes FullscreenDialog — [3758e7a](https://github.com/becked/per-ankh/commit/3758e7ad535c8879607f2b2824382bb4304b7cf3)
- (ui) the view switcher and the chrome's rows get one definition each — [67d9114](https://github.com/becked/per-ankh/commit/67d9114abe606a5d253722123f89bfbee9a78c81)
- (bake) read the atlas pool once, for two bakers — [e68eaa9](https://github.com/becked/per-ankh/commit/e68eaa99e5917db482d44b6f38f032ed70bfd87e)
- (opponents) one atlas pool module, one copy glyph, one setting trim — [056850c](https://github.com/becked/per-ankh/commit/056850cc4dbc01e194eed148c4360fef5197c827)
- (stats) families kept gets its own tab — [0a7266f](https://github.com/becked/per-ankh/commit/0a7266f5d4ae37c3e361e60e11ac2c051f99f253)
- (stats) families kept renders as a chart like its neighbours — [011b981](https://github.com/becked/per-ankh/commit/011b981ae34dd169ce310a5ca641dccbada69193)
- (stats) the tab says fielded, which is what the game calls it — [5793b2c](https://github.com/becked/per-ankh/commit/5793b2c97110b91e0e52349de68692b6d5c53366)
- (stats) thread familyKeeps through the two bundle fixtures — [eab7a35](https://github.com/becked/per-ankh/commit/eab7a350889c4cd504129d839d256c34cb6d8333)
- (stats) one spelling of a stats selection per corpus — [e98061a](https://github.com/becked/per-ankh/commit/e98061a66662dfe9a4521d2196cebeb2f9f2bfa6)
- (stats) what the record boards cost, where the costs are pinned — [7b02f54](https://github.com/becked/per-ankh/commit/7b02f542301b520713ac6049d1b1704d7ce2b58b)
- (deps) clear 16 of 22 Dependabot alerts via lockfile bumps — [916984f](https://github.com/becked/per-ankh/commit/916984f3fa5be47ebffda39bb5e489a9c8cd923e)
- (deps) take all in-range updates in both lockfiles — [772f85d](https://github.com/becked/per-ankh/commit/772f85d042becd7387370867741d6772530c6fc2)

## [2026-09-20-bd4f40e] - 2026-09-20

### Other

- (profile) the Opponents tab is the Suggested tab — [bd4f40e](https://github.com/becked/per-ankh/commit/bd4f40ec3539022fcc97c008324984d14e8f0a2d)

## [2026-09-20-8892f51] - 2026-09-20

### Features

- (ratings) a Glicko-2 model over the duels D1 can reconstruct — [7592080](https://github.com/becked/per-ankh/commit/759208079aefc6a2fe85dd6e8ade0417f46a9370)
- (opponents) suggest ten players you'd get a close game against — [5eeba76](https://github.com/becked/per-ankh/commit/5eeba766a69ab4912ab6bf1cceb5bdfc0651ae3f)
- (opponents) a DM button, and less copy around the list — [badb315](https://github.com/becked/per-ankh/commit/badb315ae3e3ecb263c9101a3cb17809e1fa1398)
- (techs) a One-off science table under the rate breakdown — [d14bb9f](https://github.com/becked/per-ankh/commit/d14bb9f8c29940f8998439ed9fdef16df4f78eb1)

### Fixes

- (opponents) nobody gets a one-name page — [334353d](https://github.com/becked/per-ankh/commit/334353df3a95c54694163a8e8c0c90b638d637d3)
- (ratings) a rebuild that fails halfway leaves every list full — [eee660e](https://github.com/becked/per-ankh/commit/eee660e3d6c78d0308f21a2052b42278564c5805)
- (ratings) sweep only older runs, stamp rows the way the column does — [a973dc3](https://github.com/becked/per-ankh/commit/a973dc38b84d2ace336743e4d726d4c04aeb2132)
- (maps) store the zType Old World declares, not the C# filename — [0c88551](https://github.com/becked/per-ankh/commit/0c885518aaa1174a2a5b344f805f70a70ecde2f8)
- (opponents) rate the games this repo calls duels, badge only what shows — [4a4b302](https://github.com/becked/per-ankh/commit/4a4b3023aed726a77c0996dcb8686fd643d36229)
- (opponents) drop the padlock, answer the question under the list — [31e9e35](https://github.com/becked/per-ankh/commit/31e9e359edad2704da83fdcbf253b586e5e4e530)
- (opponents) label the Discord link, link only the identity — [24d04c3](https://github.com/becked/per-ankh/commit/24d04c3f107384d6c45f1e87157699041eda26b5)
- (techs) the Archive ladder, Gnosticism's temples, and the Sages label — [23eb244](https://github.com/becked/per-ankh/commit/23eb2447f501f270b695f14c4988e0dbe743297d)
- (bake) drop the duplicate typePairs the rebase left behind — [7dfdf6f](https://github.com/becked/per-ankh/commit/7dfdf6f1f4f396a2fbe0764f28ec134d4ab5f051)
- (techs) one-off science becomes a section of the rate breakdown — [00aa84c](https://github.com/becked/per-ankh/commit/00aa84cbf573e8a87de4c7ddf27113be58b72260)
- (techs) the science breakdown's two icon-less rows — [0152c55](https://github.com/becked/per-ankh/commit/0152c559191ea58b53b3c6f8e4a94ac987aa9424)
- (bake) declare the theology fields, repair a duplicated header line — [5e171a9](https://github.com/becked/per-ankh/commit/5e171a9e38607b4858ba6f4f088625bc47758900)
- (techs) a city that changed hands gets its own uncertain row — [6874582](https://github.com/becked/per-ankh/commit/6874582ccc580a92847544372f165dec66e57acb)
- (maps) an alias resolves the same on both sides, and a test says so — [de65ca6](https://github.com/becked/per-ankh/commit/de65ca658038a87988bdbb99bea26867dca79f54)

### Other

- (opponents) the list is a locked tab on your own profile — [cc48df8](https://github.com/becked/per-ankh/commit/cc48df8a22409791e419c83d6868a626b511a191)
- (opponents) score on closeness, predicted from conservative ratings — [bc8b262](https://github.com/becked/per-ankh/commit/bc8b2629c17a53f7766e95b970756e792b794eff)
- (opponents) predict with an undamped logistic, and narrow the types — [a5bac8d](https://github.com/becked/per-ankh/commit/a5bac8d221a0072352951b174e3097b131aa3867)
- (techs) drop the dead band values, rank culture with the helper — [15f6e71](https://github.com/becked/per-ankh/commit/15f6e719dc49b187a06d147c1d9df16d29ccefa1)
- (techs) the one-off row union stops picking a best row — [eb5c895](https://github.com/becked/per-ankh/commit/eb5c8952a3e0b5ec6f74f5cfea82e9e22f78e994)

## [2026-09-19-1a174f1] - 2026-09-19

### Features

- (techs) show the hand each tech was picked from — [f5787a4](https://github.com/becked/per-ankh/commit/f5787a4e20b2aaa7aa0381701bb34b0bd3675ee9)
- (techs) name the free tech instead of guessing at it — [1e884df](https://github.com/becked/per-ankh/commit/1e884dfe4a3cf8b2b304c1fc54b175a3a0352cae)
- (bake) bake what a tile's neighbours add to its science — [76002c5](https://github.com/becked/per-ankh/commit/76002c5b0dd29f62907630a149efec91d447bce7)
- (techs) Science Sources itemizes what a tile's neighbours add — [332c169](https://github.com/becked/per-ankh/commit/332c16928a208a3842478df78b84bb9084169f4f)
- (bake) bake the city half of the tile modifier too — [48a1609](https://github.com/becked/per-ankh/commit/48a160941e6ef1cea7d14fc0caeca687f99b730a)
- (techs) Science Sources itemizes the city's half of the tile modifier — [50bbd14](https://github.com/becked/per-ankh/commit/50bbd14a85e03016922e175e1e078fc0738c8d8d)
- (techs) price the conditional wonder modifiers too — [ec8d0e3](https://github.com/becked/per-ankh/commit/ec8d0e3c192b3bbcf580b982feac5da9aa67e531)
- (techs) give every name in a breakdown row its icon — [c3b29a9](https://github.com/becked/per-ankh/commit/c3b29a969550264c5e838ee166aab8acd9d1ac7f)

### Fixes

- (techs) align the Tech draws heading and origin labels — [e7810a4](https://github.com/becked/per-ankh/commit/e7810a4322117d648f6d89cbbdd13e1179b9006e)
- (bake) guard the assumption the tile modifiers rest on — [b5fd104](https://github.com/becked/per-ankh/commit/b5fd1047b3dadfd84d1bd0cd9ecd440dc13daa34)
- (parser) a tile's pillage and build-turns flags read the real tags — [15765f8](https://github.com/becked/per-ankh/commit/15765f86c4c9e2164510fa5f915982be35b2f896)
- (techs) an unfinished improvement is as inactive as a pillaged one — [9f5c5c7](https://github.com/becked/per-ankh/commit/9f5c5c79fead7a89d6ef7fbf4494dc3928451ef1)

### Other

- (home) one Global Stats panel, three insets — [11cec8b](https://github.com/becked/per-ankh/commit/11cec8bf4818635cf09f792c3d8ddfaa48147e5c)
- (ui) extract PanelInset, drop Panel's orphaned icon slot — [0cc62e7](https://github.com/becked/per-ankh/commit/0cc62e78e948d73ba395fb59a093127c7745c649)
- (techs) drop an exported type nothing consumes — [eb4486b](https://github.com/becked/per-ankh/commit/eb4486b862030de9f911ce4f8bafdf327640a771)
- (map) hex adjacency moves out of SpriteMap into a shared helper — [476d0b6](https://github.com/becked/per-ankh/commit/476d0b604717c89020db5a0c4b98af775e1a1d21)
- (techs) drop a single-use label indirection, guard the pro-rata split — [fa3f71f](https://github.com/becked/per-ankh/commit/fa3f71f6c9842a2c9093a85e9f42054c69e6d0ee)

## [2026-09-09-dbea57c] - 2026-09-09

### Features

- (home) live tournament, season and stats panels — [4dbbe20](https://github.com/becked/per-ankh/commit/4dbbe2096f8828427eeb10252f44d0e9dbf1f452)
- (home) stats panels as ranked lists — [2dbe275](https://github.com/becked/per-ankh/commit/2dbe27573a03c7446d0d1b9aae71ef0a9cd7271c)
- (home) tournament art as panel backdrop, community tools panel — [a92ce01](https://github.com/becked/per-ankh/commit/a92ce01418f4f2c931f0dc330f8ed574bce1a540)
- (home) identity card in the Your season panel — [337391b](https://github.com/becked/per-ankh/commit/337391b7cbc2687507c10f8ad650596910d2b363)
- (home) panel header icons on the stats and tools panels — [9e72bfd](https://github.com/becked/per-ankh/commit/9e72bfd4d2d39d7e308a15ec700122cf98718a6f)
- (home) drop the Manual link from the community tools panel — [864ab5d](https://github.com/becked/per-ankh/commit/864ab5d71a2f61c1bb75dbebcf114c6922bb3085)

### Fixes

- (home) consistent stat columns, stale-tolerant summary, narrower schedule read — [50ef773](https://github.com/becked/per-ankh/commit/50ef773e5aaf73463402d243324f5a194ed7817a)
- (home) pinned tournament insets, server-fresh clock, 2h live window — [8f5fad3](https://github.com/becked/per-ankh/commit/8f5fad3fd6980b0b4b6221192f6646444e76d267)
- (deps) override sharp to 0.35.4 to clear the libheif advisory — [dbea57c](https://github.com/becked/per-ankh/commit/dbea57c679a45a0747c33730336f5dd49d3460b4)

### Other

- (home) italicise the cognomen in the Your season progress line — [59b2724](https://github.com/becked/per-ankh/commit/59b272419f96ae509059261a8afc186eef36a268)
- refresh drifted goal names table — [0ad5056](https://github.com/becked/per-ankh/commit/0ad505689c26f5f742ba13b075b55358e8ed64bf)
- (home) fixed-width tabular number columns in the stats panels — [80fb325](https://github.com/becked/per-ankh/commit/80fb3258a3a9b3d28424028ece711005c78691ee)
- (players) the game says cognomen, so we do too — [e560329](https://github.com/becked/per-ankh/commit/e560329ff2f48f913ad5de5f184f4530480bb2e5)
- (cognomens) rebake to today's patch, and the comments with it — [599b0e7](https://github.com/becked/per-ankh/commit/599b0e7ea281691e2372e6d39fc03303b6d345fa)

## [2026-09-07-ade2721] - 2026-09-07

### Features

- (stats) public uploads leaderboard at /stats, linked from the header — [91e35c2](https://github.com/becked/per-ankh/commit/91e35c2a98e34ad7e603b00bc4c75fdd6d793db3)
- (stats) season view, culture-level tiers, and the viewer's own card — [c7c7e34](https://github.com/becked/per-ankh/commit/c7c7e34d095e1d803144de2a739ba96ab6317c1d)
- (stats) games PLAYED, cognomen epithets, dynasty seasons — [e225407](https://github.com/becked/per-ankh/commit/e2254075ff762d897648ab75e2bdeb0354596967)
- (season) the page becomes Season — real seasons, the user's ladder, format kings — [23b1d13](https://github.com/becked/per-ankh/commit/23b1d139e3c33dc80af1647cff50216d57d86802)
- (season) season archive, until-window API, prod-calibrated ladder, Crowns — [68a4936](https://github.com/becked/per-ankh/commit/68a4936a27e6e0c1beaec9df0fffaf06e6bb7af8)
- (season) triangular ladder — each epithet costs one game more than the last — [615009b](https://github.com/becked/per-ankh/commit/615009b482648dcdc4127c3f5512d2699e7b695c)
- (season) cap the ladder at the Magnificent — the Great stays unclaimed — [b45a252](https://github.com/becked/per-ankh/commit/b45a25215bb181e756e605250de6e52ea4d6ae6a)
- (season) give the season read its own per-IP budget — [4b79cf9](https://github.com/becked/per-ankh/commit/4b79cf922e739872c9060547a2f6829bb5e92eba)
- (players) move the season board to /players, board in the URL — [e44f078](https://github.com/becked/per-ankh/commit/e44f0780285cf56dc1e770544e7c44b1dcb0d0ec)
- (players) route into /players from the home page and the menu — [0f5122e](https://github.com/becked/per-ankh/commit/0f5122e84e12b30a09ddc70f5ceb25678de814aa)
- (players) Discord avatars on the board, and sortable columns — [082a820](https://github.com/becked/per-ankh/commit/082a82008f5e81ea9be8a6952b92e28240562685)
- (players) crowns in fixed cells, and on both boards — [3270d0d](https://github.com/becked/per-ankh/commit/3270d0d5d5122eb59cd548cf5a02d9bbea417833)
- (players) crowns as a titled panel, and rows link to the profile — [160dc80](https://github.com/becked/per-ankh/commit/160dc807cb9a9cbf4980cd02f6731eac9b74444c)
- (players) the crowns title reads as a label, and the columns lead with the format — [24ed365](https://github.com/becked/per-ankh/commit/24ed3658ba05912b8a42f6e21fa85bb045ae47e0)
- (players) one player wears each crown, and the board ranks by who got there first — [dca45cc](https://github.com/becked/per-ankh/commit/dca45ccbff3ba849dc3f237c15b02f0451d0f6b2)
- (players) the crowns panel explains the rules it ranks by — [fba026f](https://github.com/becked/per-ankh/commit/fba026f4091b559dc44284c5732c31f131a5f40d)

### Fixes

- (deps) lift undici to 7.29.0 and retire the audit exception — [c2bef7d](https://github.com/becked/per-ankh/commit/c2bef7d396785f204fbf729454d0eeb364e35bd9)
- (stats) the played-games board counts public games only — [0a27609](https://github.com/becked/per-ankh/commit/0a276090f47f7d4a4d2a0a74064d8f515d4d9f9d)
- (players) a season with no games still has a page — [d03d9b6](https://github.com/becked/per-ankh/commit/d03d9b686cf023a5c050a5957c9414a13094b20e)
- (players) keep the season when the board switches, and fit the page to the app — [18b79d3](https://github.com/becked/per-ankh/commit/18b79d34ed57c107498324cab4ddb5e475140b70)
- (header) the menu offers Players to signed-out viewers — [0141a32](https://github.com/becked/per-ankh/commit/0141a32a146a137194f1dfbf5671f89147b60866)
- (players) the current season's crowns are titled like any other — [6da4f43](https://github.com/becked/per-ankh/commit/6da4f43bbedfe0ad0eb78a4c5ad6e788149c40c2)
- (players) an online id two people have linked credits neither — [9ddf87a](https://github.com/becked/per-ankh/commit/9ddf87a5685d58fc339b32b04b92c0cf672adabf)
- (players) counts that can't come back null, and a board that can change — [fce10df](https://github.com/becked/per-ankh/commit/fce10dfb00eeac206b7ab119e0204720b1422c9f)
- (players) the twelve the review found — [16e6517](https://github.com/becked/per-ankh/commit/16e651730e7456f4bc351035f66d9d272b936a16)
- (players) the rank breaks a head-to-head the way the crown does — [db15910](https://github.com/becked/per-ankh/commit/db1591029ef14930ee1a6480ee2e9836d9aeb867)
- (deps) clear the browserslist advisories blocking preflight — [ade2721](https://github.com/becked/per-ankh/commit/ade2721c7719611349310009b61fabdf00bf78d5)

### Other

- (stats) cover /v1/stats/players; adopt displayNameSql and sibling idioms — [614bc3e](https://github.com/becked/per-ankh/commit/614bc3e19c07047ff38c54a9f7cf4acb542b4e8d)
- (stats) renumber the online_id migration to 0044 — [06b235b](https://github.com/becked/per-ankh/commit/06b235b881e7eff5817197f0df91e6c457cc7633)
- (cognomens) one bake owns cognomen.xml, and rulers get the game's epithet — [d364322](https://github.com/becked/per-ankh/commit/d364322022776c3770078738f3a36eaf9b41481b)
- the momentum model, as built — [e1284eb](https://github.com/becked/per-ankh/commit/e1284eb50910e81c910dcbf1d3bb0fa496c1110c)

## [2026-08-31-5edcf08] - 2026-08-31

### Features

- (scripts) capture the home page's cold-start states — [3adac10](https://github.com/becked/per-ankh/commit/3adac10c777a18128810f54dd7defc347b32a353)
- (scripts) sign the UX-review pass in as the local admin — [06e1409](https://github.com/becked/per-ankh/commit/06e14099a224c75d931434bf34d3ba1599e7091b)
- (bake) military power tiers from power.xml — [2bce4ca](https://github.com/becked/per-ankh/commit/2bce4ca78a3f218909c58a92b43fce5708d833cb)
- (military) power-standing shift chips on the rail — [c426181](https://github.com/becked/per-ankh/commit/c426181ca76dee56a7a7b0d1385f79cf58250f63)
- momentum — a per-turn win-probability curve for duels — [3d5f449](https://github.com/becked/per-ankh/commit/3d5f449569e924cb31073fe282a6a65aed90d10e)
- momentum gains the growth dimension (spec update) — [7fc248e](https://github.com/becked/per-ankh/commit/7fc248e4646826c23aeb4d68607f7c4b5f0fc377)
- (game-detail) momentum gets the owglick viewer's presentation — [3a16c16](https://github.com/becked/per-ankh/commit/3a16c16201e4c3e26781433bdb949171fadf45d8)
- (game-detail) derive battle events for the momentum window — [57724da](https://github.com/becked/per-ankh/commit/57724dac33a9df4665da34f290a98facda19cba5)
- (momentum) record the model version beside every momentum score — [392cbd7](https://github.com/becked/per-ankh/commit/392cbd7cb8d9d797b9ca1f6a3755d65494094fd3)
- (momentum) model v2 — interpolated weights, exact deltas, no cities — [e8e24a6](https://github.com/becked/per-ankh/commit/e8e24a6ebde7aeefc3082fc5482c1114ae0d0663)
- (momentum) the panel admits the early game is uncertain — [83102dc](https://github.com/becked/per-ankh/commit/83102dc55cbbdf9615ea0289865911c14823f47a)
- (momentum) an info side that explains every number in the panel — [ea038fe](https://github.com/becked/per-ankh/commit/ea038fe10d0f129846a864a9250626d2558ff02a)

### Fixes

- (scripts) keep hand-authored files when regenerating the UX review — [75be563](https://github.com/becked/per-ankh/commit/75be5632947f9013b4a7902d05764bc40c368a4d)
- (scripts) settle before the cold-state navigation — [b8353f8](https://github.com/becked/per-ankh/commit/b8353f89ddd85a8fa39da9979b88ce7297e29a54)
- (ui) stop popover close from scrolling its trigger back into view — [0ca6b32](https://github.com/becked/per-ankh/commit/0ca6b32586a1e35bc0bf9ab43789ec62c22d725a)
- (scripts) walk the game-detail tabs the app actually renders — [c4881e3](https://github.com/becked/per-ankh/commit/c4881e38a1a46221cfa1a6a344633da40623ae52)
- (game-detail) confine the momentum tooltip to the chart — [e402c19](https://github.com/becked/per-ankh/commit/e402c1943ed7d775aaea07b64700beda73e5c3d5)
- (momentum) fit on a deduped corpus with wider SD smoothing — [d47aedc](https://github.com/becked/per-ankh/commit/d47aedc4993960343fdfc43138de22b61ca9c64e)
- (momentum) drop the early-game fade, and bars that can't contradict the header — [c748e6c](https://github.com/becked/per-ankh/commit/c748e6c113176cafa83b6990bd654bc1cbd2319a)
- (momentum) a solid 50% midline — [0ee8a7d](https://github.com/becked/per-ankh/commit/0ee8a7d82451f2bf2850149e59b17afa1379aae2)
- (momentum) the hover marks the turn, and nothing else — [45ead09](https://github.com/becked/per-ankh/commit/45ead091b23f63585aff9bee83e3b06399a263f8)
- (momentum) the events heading names its own turns — [2a8f83a](https://github.com/becked/per-ankh/commit/2a8f83a3b876bcf7d6ec50ba067fcf7a01e979ce)
- (momentum) a turn summary of its own, at a height that holds still — [4364217](https://github.com/becked/per-ankh/commit/4364217b52fd03d1dcea9a7625e09ffb1ca4108f)

### Other

- add a home page design brief — [4f0e730](https://github.com/becked/per-ankh/commit/4f0e7300988b669b411e10bd7e94f896be92d7b4)
- (ux-review) regenerate the bundle against a game that renders — [49d6987](https://github.com/becked/per-ankh/commit/49d6987035843b01778f4ee535f8c8384d39e615)
- collect the home redesign package — [61bbdef](https://github.com/becked/per-ankh/commit/61bbdeff41fc1c582f98d8366492b68fed8388f7)
- name the right chart-color helper in the home brief — [33fde94](https://github.com/becked/per-ankh/commit/33fde94f3e8b8fdb9037564fc16ab1962e0ff5e4)
- (scripts) move the UX-review capture into the per-ankh CLI — [68bf767](https://github.com/becked/per-ankh/commit/68bf767fe0459b89736564c872c4fc75635ac7c5)
- point the home-redesign package at the ux-review shots — [483069e](https://github.com/becked/per-ankh/commit/483069e892c61c82efdf2d242fe47db6db454117)
- (momentum) drop the unused momentumDrama export — [5a9394b](https://github.com/becked/per-ankh/commit/5a9394b3e12a4ad154061fab3461fbcb822aac1a)
- share the chart midline colour, refresh panel-era comments — [f5be89b](https://github.com/becked/per-ankh/commit/f5be89b39d7bd0c4e1b5c35d98f79d75462f3b90)
- (momentum) renumber the momentum migration to 0041 — [431b581](https://github.com/becked/per-ankh/commit/431b5811c395c7dbbabd7aba6cd8e1af134a3f2d)
- (momentum) renumber the momentum migration to 0043 — [43dbbee](https://github.com/becked/per-ankh/commit/43dbbeeded39d568232945bab788316ab496284c)
- (momentum) generate the Worker mirror from the frontend scorer — [311da81](https://github.com/becked/per-ankh/commit/311da811c6696dd5c5bb4994a616c106c0e7a0ad)
- (momentum) CLAUDE.md notes for the generated mirror and refit policy — [e7be0c8](https://github.com/becked/per-ankh/commit/e7be0c8af3b5dc534c39adac6c89692ecf7bb92d)
- prettier pass over the momentum sources and mirror — [5edcf08](https://github.com/becked/per-ankh/commit/5edcf08f76b29b7ca5be152b9f5435ee55caa784)

## [2026-08-30-76a439c] - 2026-08-30

### Features

- (stats) share the composition predicates the global slices select on — [f7e7d34](https://github.com/becked/per-ankh/commit/f7e7d3467601f8aeacefc2f352566106b6ea82c7)
- (stats) resolve the global corpus, games and focal seats alike — [36e7d69](https://github.com/becked/per-ankh/commit/36e7d69be6785d1c738482a14739fe0f59a19fee)
- (stats) precompute the global bundles nightly, a cron per slice — [1abe1b5](https://github.com/becked/per-ankh/commit/1abe1b507a3382c79026ee2b416d00e77bed4227)
- (stats) serve the global bundle, on its own read budget — [db78a36](https://github.com/becked/per-ankh/commit/db78a36b1ca4ae9f3491078881eac8d2f41a7e7c)
- (stats) the /stats route, on a slice and a nation facet — [4c4a622](https://github.com/becked/per-ankh/commit/4c4a62264189bbb333cfa6fd703357b10ee23503)
- (stats) route into /stats from the home page and the menu — [a0945f3](https://github.com/becked/per-ankh/commit/a0945f3eee1457dc1a2fafb4a2b2a76e3168dd07)
- (stats) colour yield charts from the game's own palette — [cadf9a6](https://github.com/becked/per-ankh/commit/cadf9a60be4cd5b6f447c64765b74ccc899b10b7)
- (stats) colour the remaining charts from the yield palette — [68dbacc](https://github.com/becked/per-ankh/commit/68dbacc36cb633f4df1f9271aa5063d4296edab0)
- (stats) recolour the outcome charts and the nation points bar — [20ad68b](https://github.com/becked/per-ankh/commit/20ad68b8448df975e016aafdb652fcb560826b71)
- (stats) slim the bars to 65% of their band — [44331c3](https://github.com/becked/per-ankh/commit/44331c33d524a25ceab25b195ff59f7dd3b2a462)
- (stats) require a session for global stats — [515a8a4](https://github.com/becked/per-ankh/commit/515a8a4bc473220a924ea39144fe269b6d711554)
- (stats) warm the four unfaceted bundles on an hourly cron — [ce78547](https://github.com/becked/per-ankh/commit/ce7854740148072ec1528e76744e3531bab97237)
- (stats) color the wonder bars in the app's win/loss pair — [38756c4](https://github.com/becked/per-ankh/commit/38756c44617ca8cee2db5d4cad37f49ae42a066c)

### Fixes

- (stats) scope a wonder's builds to the games that supplied its denominator — [5e0a104](https://github.com/becked/per-ankh/commit/5e0a10459181e7ebc5b9e59df66d7991162cce4f)
- (stats) keep law and tech timing on the focal seats — [a8546d7](https://github.com/becked/per-ankh/commit/a8546d7ebaeba92ba78c9d044cfd6c9793b0b643)
- (stats) make the sticky bars' outdent opt-in — [d019a4b](https://github.com/becked/per-ankh/commit/d019a4bb49759c6ad1a8d8d57d0cd3c02ab91cca)
- (stats) denominate the yields overlay in the bundle's focal unit — [7f7e0ce](https://github.com/becked/per-ankh/commit/7f7e0ceaacf727db245a3451042ac04fca99fec4)
- (stats) stop the panels titling a nation they don't own — [fbb650f](https://github.com/becked/per-ankh/commit/fbb650f30273e6582cf07b61317ced7c2541d78e)
- (stats) give /stats a stable title and drop the game count — [5a92aa1](https://github.com/becked/per-ankh/commit/5a92aa17c5fadbbd6246b2bf039e74d586ee4de3)
- (stats) steady the facet triggers and soften the bundle swap — [b016ae7](https://github.com/becked/per-ankh/commit/b016ae72de6da3969a9c54e3005e975606353679)

### Performance

- (stats) accumulate yield cohorts disjointly — [dda0d4c](https://github.com/becked/per-ankh/commit/dda0d4cd9d143019fc2769ba80dd5e9578e2444e)
- (stats) bound openingLaws to what the chart can show — [7e866d5](https://github.com/becked/per-ankh/commit/7e866d558559ab5d942330950abd9322e071bd56)
- (stats) move save_dates to the user bundle, drop favorite_day_of_week — [de9587e](https://github.com/becked/per-ankh/commit/de9587e35a5f86aca2288714dddf42dbf5982369)

### Other

- (stats) plan a public /stats over the whole public corpus — [5f786fb](https://github.com/becked/per-ankh/commit/5f786fb79419e812ae4e7dc20ebc8792617cc9ca)
- (stats) size the global corpus and the cost of one aggregation — [e4b8b5b](https://github.com/becked/per-ankh/commit/e4b8b5bcbd92dad32f4fc573f7dcabfea0afeef6)
- (stats) settle the field dispositions and the cache-miss rule — [fa531dd](https://github.com/becked/per-ankh/commit/fa531dd5428e89e6cd10cfd1e9a8098db5180e04)
- (stats) one cache tier, and warming as the herd control — [9748589](https://github.com/becked/per-ankh/commit/974858937f72685af24f37a2a0c8072b3b63fd3a)
- (stats) one nation facet, precomputed whole — [33f02de](https://github.com/becked/per-ankh/commit/33f02deb6683321520f71659d4683207829357c6)
- (stats) specify the round-trip test, and defer the reparse sweep — [47269dd](https://github.com/becked/per-ankh/commit/47269ddd6e75459bd10b1a44a61f3e1144ac3b96)
- (stats) pin the chart bundle with a fixture round-trip — [a6c2c6b](https://github.com/becked/per-ankh/commit/a6c2c6be1121b8a659cf78623917463cabee87cf)
- (stats) branch the bundle call, not its argument — [e29d291](https://github.com/becked/per-ankh/commit/e29d291afe974e766bb578cd7b2bdd3b75d5d338)
- (stats) type the chart registry at the bundle core — [33d5afa](https://github.com/becked/per-ankh/commit/33d5afa9a1f3265f83c5a8e5985a611a3818aa79)
- (stats) record the global-stats build against its plan — [21daab2](https://github.com/becked/per-ankh/commit/21daab24c07d9d5faa6cbea3da59adf05106910f)
- anchor the Reference gitignore rule to the repo root — [eaddf96](https://github.com/becked/per-ankh/commit/eaddf9672892a071bc2620b2d744281fc17e05af)
- point the colour guidance at getSeriesColor — [aeefd24](https://github.com/becked/per-ankh/commit/aeefd248d4df4d1bee955d83afea7d1c97e7b38e)
- (cloud) narrow ReadBudget to the read event types — [11fd7fc](https://github.com/becked/per-ankh/commit/11fd7fc6c7a19cf4e5e10bc9855d120114db9dbf)
- (deploy) correct the /v1/stats health checks — [72d0297](https://github.com/becked/per-ankh/commit/72d0297ccc5eed2370ecb0850cf8e3ccaeeb8f82)
- (stats) stop asserting a warm step that was never built — [1980eea](https://github.com/becked/per-ankh/commit/1980eea0d8041a99e809bda72bd0ef35a9aedc47)

## [2026-08-29-ea24eb6] - 2026-08-29

### Features

- (admin) duel-event-titles sweeps raw saves for fired events — [28a987c](https://github.com/becked/per-ankh/commit/28a987c12062190ba37c8a3a0495d0363c88d16a)
- (admin) duel-event-titles counts each event and writes CSV — [6ee057d](https://github.com/becked/per-ankh/commit/6ee057d8dad0d6e090f961b430390ff2135eaac0)
- (tournament) a 12/24-hour clock toggle beside the UTC/local one — [d26f3f3](https://github.com/becked/per-ankh/commit/d26f3f37689cd2fb1a7029b20b8783de7dfa1262)

### Fixes

- (tournament) show the clock-face toggle wherever the face applies — [fc34c56](https://github.com/becked/per-ankh/commit/fc34c56cef4e884d4150d81fcd92271aac2afccd)
- (tournament) match the active view on route id, not pathname — [095da74](https://github.com/becked/per-ankh/commit/095da7446ab4c4c1013f4c1a9024b7770a8f2659)

### Other

- (tournament) read the view labels from one source — [c249cec](https://github.com/becked/per-ankh/commit/c249cec74ceb2561b0094cdeeaebf3c6bcfb78d7)
- (tournament) index the view labels instead of calling for them — [ea24eb6](https://github.com/becked/per-ankh/commit/ea24eb61978ee4786ffb35fcd52be414e807e8fb)

## [2026-08-26-27fd762] - 2026-08-26

### Features

- (tournament) local match times follow the viewer's clock face — [4ef3f1e](https://github.com/becked/per-ankh/commit/4ef3f1e27b3a220431a73b917560b0617053ec2d)
- (tournament) the header's date says whether the tournament has started — [27fd762](https://github.com/becked/per-ankh/commit/27fd76248c5b473d8af1ec7b5e592039991a6746)

### Fixes

- (tournament) dates and times read on the clock they were written on — [efbabfc](https://github.com/becked/per-ankh/commit/efbabfcbe29a5de851d0d92c82dc76bf0fe43b89)

## [2026-08-25-dafb60f] - 2026-08-25

### Other

- (tournament) the overview header says who and when, not what format — [dafb60f](https://github.com/becked/per-ankh/commit/dafb60ff48f6638441b13240ee58d3fff415a344)

## [2026-08-25-5a7fcc6] - 2026-08-25

### Features

- (tournament) the progress strip draws one mark per match — [62ee081](https://github.com/becked/per-ankh/commit/62ee0817f4467b97a6adb1b2c0f18baca5b235dc)

### Fixes

- (tournament) the strip's marks and its tally are the same number — [c23f341](https://github.com/becked/per-ankh/commit/c23f341ffe233f23fa6c217cee633eaf6104f091)
- (tournament) name the Swiss phase once and tick the rest — [c233362](https://github.com/becked/per-ankh/commit/c2333624353c43e7965f759b50804f66a86e300f)
- (tournament) the championship bar draws its floor too — [9f14695](https://github.com/becked/per-ankh/commit/9f1469574b6ee7cf89b441accf5c360250eeeaa8)

### Other

- (tournament) the strip's comments say what the strip does — [5a7fcc6](https://github.com/becked/per-ankh/commit/5a7fcc6d096113c8af2a2366e2199d8c0bc390ca)

## [2026-08-23-8855eef] - 2026-08-23

### Features

- (tournament) project the whole tournament's eventual match count — [ee3c49d](https://github.com/becked/per-ankh/commit/ee3c49d55606a9c85bbcaf20e9426d95f82be835)
- (tournament) per-division progress lanes in the overview hero — [a9384db](https://github.com/becked/per-ankh/commit/a9384db595d647f2aeec33f3955f36f20bde5fef)
- (tournament) the progress strip draws one dot scale, solid once closed — [81399a0](https://github.com/becked/per-ankh/commit/81399a012653d186b06f7b516f4cb7e2a6528d14)
- (tournament) the championship row counts its matches — [49841fd](https://github.com/becked/per-ankh/commit/49841fdef9aa04c71379295a438f7646efd6074d)
- (parser) city religions, project counts, governor id, theologies — 2.15.0 — [2938b9a](https://github.com/becked/per-ankh/commit/2938b9aa16f2eea0b903d8fe715bf8ca4a6c8a2a)
- (bake) governor, family, nation, theology, project science + knowledge tiers — [90614ee](https://github.com/becked/per-ankh/commit/90614eee1ed3b7fb88bd596b521f921742d2a7ac)
- (techs) itemize governors, Sages, Babylonia, Dualism, Archives; mark leader changes and knowledge flips — [705eb39](https://github.com/becked/per-ankh/commit/705eb39686c476c5d38b00b5131bf516f9ae40ed)
- (techs) price city discontent in the science breakdown — [7930aab](https://github.com/becked/per-ankh/commit/7930aab3cdac1b615166b4b3e42712a3570903c5)
- (techs) knowledge shifts as tier-initial chips — [37bd375](https://github.com/becked/per-ankh/commit/37bd37524319aec36bdcf1e7c233cdc63b8eb1c5)
- (techs) full ruler lines on the leader-change tooltip — [04a8061](https://github.com/becked/per-ankh/commit/04a80610705860b969db2e44562fda871cf48a81)
- (bake) PROJECT_NAMES, the names the game gives its city projects — [4cfb331](https://github.com/becked/per-ankh/commit/4cfb331243c32dcaf515b50bdc9ed57d84ccf88a)
- (bake) event-project science, and the grants a law or archetype pays per city — [be17b6c](https://github.com/becked/per-ankh/commit/be17b6c9767f6d1fc5bd5e2a3183bc7c10bb0d03)
- (techs) price Philosophy's Forums and a Scholar's Archives — [fe3dcfd](https://github.com/becked/per-ankh/commit/fe3dcfded54e264c1312783ee07f1197543d5fed)
- (parser) city damage and assimilation turns — 2.15.0 — [01e37eb](https://github.com/becked/per-ankh/commit/01e37eb3f9fbf08a3f1e2fd1c2967ce77b138041)
- (techs) price city damage and assimilation in the science breakdown — [6d83db8](https://github.com/becked/per-ankh/commit/6d83db8889211da8da5ec664dc710ae63af4db3a)

### Fixes

- (display) characters and nations take the names the game gives them — [3326a74](https://github.com/becked/per-ankh/commit/3326a7431bbf774315bfebfc8624bea7cf9af7dc)
- (cities) search and sort follow the name the column shows — [184a7b3](https://github.com/becked/per-ankh/commit/184a7b3662b7ad184249051e0c82a1f6fab42571)
- (search) a game search matches the nation's in-game name — [98ef986](https://github.com/becked/per-ankh/commit/98ef98620866ecbcff0b78f3a018d1e1fc0b17eb)
- (tournament) the census walk survives a pending pair it can't place — [f771c9b](https://github.com/becked/per-ankh/commit/f771c9bdc0d56265dad91ea10b49ea9e4aafd5bb)
- (tournament) the progress hero's each blocks bind the value they render — [ba0fa60](https://github.com/becked/per-ankh/commit/ba0fa606512df4777a01d0b67a720ca8f4c82efb)
- (tournament) the census walk plays out a lone survivor's byes — [304bc8f](https://github.com/becked/per-ankh/commit/304bc8fb701c0b5d778fd9c2cb62470d432bc699)
- (tournament) the projected match total reads from the envelope's midpoint — [ad40be8](https://github.com/becked/per-ankh/commit/ad40be8ce042c364d6ff2033bfffa454d2e7933e)

### Performance

- (tournament) the census walk collapses duplicate pending-pair futures — [72cf697](https://github.com/becked/per-ankh/commit/72cf6977b3535dddf0476e78dc687430b707c893)

### Other

- (games) cover the nation-name search clause — [e3911bd](https://github.com/becked/per-ankh/commit/e3911bdc5352ee2a8673ff0ca7d6f7a4ae6f4c17)
- (tournament) cross-check the match projection against the pairing engine — [8c76126](https://github.com/becked/per-ankh/commit/8c7612646ac51845b9d2162cdb6ae520c309f9aa)
- (git) ignore Claude Code worktree checkouts — [5d83302](https://github.com/becked/per-ankh/commit/5d83302da20ee3727550f0af5fcf8b5a15a6b6a5)
- (tournament) the progress hero names the stage, not the round — [b451750](https://github.com/becked/per-ankh/commit/b4517508fe0db69ef87f2a91c4d52063d5a0f812)
- (tournament) the header's type scale reads the same in every state — [40b7382](https://github.com/becked/per-ankh/commit/40b738268bc5d71e47e7fe1669b4e77d51f23ff5)
- (tournament) drop the unused in-progress phase label — [1041282](https://github.com/becked/per-ankh/commit/10412823b860be5dea76c58d4bc0574795538288)
- (techs) leader-change tooltip adopts the Military rail's ruler style — [2e182cc](https://github.com/becked/per-ankh/commit/2e182cc5c328e2361fb34c1af82e1ca406a9d62f)
- (game-detail) city projects take the name the game gives them — [90f53a9](https://github.com/becked/per-ankh/commit/90f53a9f34631f0dd5ac3ca5526e4a0a0103c4fc)

## [2026-08-18-392cd92] - 2026-08-18

### Features

- (game-detail) Orders tab — orders and legitimacy, charted and itemized — [9223678](https://github.com/becked/per-ankh/commit/922367861e1b88113de3b553679d81ac0cfaa929)
- (game-detail) Orders tab v2 — duel tables face off, legitimacy names its events — [18bb988](https://github.com/becked/per-ankh/commit/18bb98875aaa4a0819ddaacf9174fefe264b9a1f)
- (parser) story_events span the whole game and name their player — [43b2e75](https://github.com/becked/per-ankh/commit/43b2e75dc4ca2665afa19f34dec4fe0162f5989a)

### Fixes

- (game-detail) a ruler carries their regnal numeral into the itemization — [9398d35](https://github.com/becked/per-ankh/commit/9398d3569837fcfb700c807caeeb52256e772da6)
- (game-detail) a repeat event gets one legitimacy row, not a duplicate key — [bf4ead1](https://github.com/becked/per-ankh/commit/bf4ead145fcb09bb2467a1328a3c4b6a14ae237c)
- (game-detail) the Orders tab reads the resolved player — [b6491bb](https://github.com/becked/per-ankh/commit/b6491bbf3834952c2e38d566f3d1cf0e27441177)
- (game-detail) a contribution row renders its own sign — [808bf54](https://github.com/becked/per-ankh/commit/808bf549aca7c2f6b838c7f45cf58a4385e14aba)
- (bake) orders sources bake only the granters the tab can price — [f877e6f](https://github.com/becked/per-ankh/commit/f877e6ff3d4139a2e30c39858e137afc4ae7f447)
- (game-detail) the Orders tab draws the page's charts, not its own — [78e2587](https://github.com/becked/per-ankh/commit/78e25878f24a7639c06018491f2cd4fd3ecb559f)
- (game-detail) difficulty by its in-game name, and no guards that can't fire — [0190b04](https://github.com/becked/per-ankh/commit/0190b0458cdd75f026840882c2aa7a791d81d076)
- (game-detail) an eliminated realm doesn't itemize its ending orders — [595fd6f](https://github.com/becked/per-ankh/commit/595fd6fb00ef6187e41efaad95c70b55e777dbaa)
- (game-detail) a nameless player matches no story rows — [6a820fa](https://github.com/becked/per-ankh/commit/6a820fa42b5f6e9ea191aec8c10632c2d37c7bc6)
- (parser) story_events read oldest turn first — [2e94dbf](https://github.com/becked/per-ankh/commit/2e94dbfb97facff55535dccc515104e6876a74cb)
- (cloud) 2.13.1 never shipped, so the Worker stops claiming it — [8630779](https://github.com/becked/per-ankh/commit/8630779265164cf74ee5881a17217c800eb26d65)
- (parser) character and city story events read Player, not player — [f0ab8e6](https://github.com/becked/per-ankh/commit/f0ab8e6eb617615c020a35e40fbeab57b26854ac)
- (parser) event_logs rows carry their group's owner set — [9e13431](https://github.com/becked/per-ankh/commit/9e13431b47e182c666b6e19c5b7693db2c3b4950)
- (events) the Events tab filters and labels by player id — [758bb40](https://github.com/becked/per-ankh/commit/758bb40f1d81a07f371bca58bd3c2e64150e24e1)
- (tournament) the casting panel lists a pending match's upcoming sittings — [9b7debe](https://github.com/becked/per-ankh/commit/9b7debe6aee065e0a3ed955d4f7f2172775fcd3c)
- (tournament) only a scheduled sitting advertises its casting seat — [25a7127](https://github.com/becked/per-ankh/commit/25a71279d00ff50827dd3125897fad51665fd860)

### Other

- merge-safe ambition rows, unshadow Pick, honest footnotes — [fd993c5](https://github.com/becked/per-ankh/commit/fd993c524db99473772e5be9c71e74ceb10bb64c)
- (game-detail) the Orders tab itemizes in nation panels — [a1be7c9](https://github.com/becked/per-ankh/commit/a1be7c98d1629729262339ce960d538da09bd81a)
- (game-detail) the dynasty walk and the ruler's name are shared — [d5ecb4d](https://github.com/becked/per-ankh/commit/d5ecb4da9882b111bd20a60435ac8b11bbeab51d)
- (parser) the story_events header states what the corpus measures — [f556638](https://github.com/becked/per-ankh/commit/f5566385ee3bfdd6067ffa4bfd73736ae7c544e6)
- (game-detail) TimelineTab takes the resolved players, not its own — [3cccc70](https://github.com/becked/per-ankh/commit/3cccc70bd1adbddbb38bcc8339e11eb26b167741)
- (tournament) the casting panel reads the shared cast window — [456a84b](https://github.com/becked/per-ankh/commit/456a84b01dc6bb62edc054a325abad40c4330367)

## [2026-08-14-aa79556] - 2026-08-14

### Features

- (bake) family colours from the game's palette chain — [4b5c94c](https://github.com/becked/per-ankh/commit/4b5c94c721f8b54133dd721cc2d6b1eeaa4d74d2)
- (families) opinion lines and names in the game's family colours — [c374a15](https://github.com/becked/per-ankh/commit/c374a15ffa75d4cd7ae7d60269a7ad32adc2c9c6)
- (economy) city markers wear their family crest, tooltip counts ordinals — [a28c66a](https://github.com/becked/per-ankh/commit/a28c66a8b58eaf140497ad70738bba8099ade422)
- (tournament) resolve each side's starting-ruler archetype onto the match payload — [488df3e](https://github.com/becked/per-ankh/commit/488df3e5666ae575713bc008b17bc4cb1f050e8d)
- (tournament) Matches tab on the stats page — sortable match list with game links — [2216d31](https://github.com/becked/per-ankh/commit/2216d311df19cab66c41a1ac10444a41d5b3bb71)
- (tournament) status facet chips on the stats match list — completed by default — [400d8d3](https://github.com/becked/per-ankh/commit/400d8d3a8d5a1f6a759d8df05e0f746247afe8db)
- (tournament) archetype glyph on every surface that shows a crest — [44065a7](https://github.com/becked/per-ankh/commit/44065a7d0fb9aa94517cb6c9e7ce9e4bda64174a)
- (tournament) one-at-a-time status switch on the stats match list — [ff216c5](https://github.com/becked/per-ankh/commit/ff216c59ee87834602e4056087b36eb1ff504b02)
- (tournament) the game's replay glyph on the stats match list's game link — [318f204](https://github.com/becked/per-ankh/commit/318f204e01a1faf9a39dd77ac2528eb8d4bb17a3)

### Fixes

- (scripts) drop web/ output targets left over from the legacy viewer — [e224732](https://github.com/becked/per-ankh/commit/e224732177b6f69687f315912f5ca75fabcd0f67)
- (migrations) renumber the legacy-share drop to 0042 — [98fcd8a](https://github.com/becked/per-ankh/commit/98fcd8a61376e62a08489268746de0bdd76f5323)
- (map) family crest lookup double-prefixed FAMILY_, extract the rule — [de5b492](https://github.com/becked/per-ankh/commit/de5b49260415155a4b68f2b8f59cb55f069ebc01)
- (tournament) the stats match list follows the tournament clock — [b9d1f6c](https://github.com/becked/per-ankh/commit/b9d1f6ceeb5a58b8ee24de6427a01ca4599447e8)

### Other

- (legacy) decommission the desktop-era share feature — [568144d](https://github.com/becked/per-ankh/commit/568144d6b07919167c36fecdebf4f362474d7a99)
- (legacy) sweep stale references to the desktop share feature — [86b4650](https://github.com/becked/per-ankh/commit/86b46505a52a0949334b0aebf18bfb54227a52b1)
- (parser) drop dead src-tauri citations from parser comments — [29abd01](https://github.com/becked/per-ankh/commit/29abd018509bd65808b6c9376e6a70e9a7e53165)
- (parser) delete the last six dead src-tauri pointers — [359db9b](https://github.com/becked/per-ankh/commit/359db9b810fb1880e191e9163c37c202e2bc1d23)
- (legacy) add the legacy share decommission deploy procedure — [e5b0af3](https://github.com/becked/per-ankh/commit/e5b0af3916b2ae535401ee566e8f19dfb251a791)
- (legacy) sweep share-feature references that landed since the branch — [728ccbc](https://github.com/becked/per-ankh/commit/728ccbc5380d3410795b4c0b6c9b9509d8244129)
- (types) describe src/lib/types as hand-maintained — [0a81807](https://github.com/becked/per-ankh/commit/0a818073df3cb888ba4a0981be900fd64a36a233)
- (legacy) restructure the decommission plan as a checklist — [290870f](https://github.com/becked/per-ankh/commit/290870fd06e35679b984ddf85726de4e08cebc30)
- (families) resolve family colour through one config helper — [e8d4e1f](https://github.com/becked/per-ankh/commit/e8d4e1fd396629d9e197b146f1ec6c9c7991fd9e)
- (bake) order the family-colours baker with bake:all — [5899c1d](https://github.com/becked/per-ankh/commit/5899c1d1443ff85c8e036b6cdc564ab776b2ac2d)
- (game-detail) resolve a city's family and crest through shared helpers — [d2565a5](https://github.com/becked/per-ankh/commit/d2565a5bdbfe0702402ae3ea6e0fc9e8b5a96749)
- (tournament) use the real archetype enum shape in the linkGame fixture — [13c147e](https://github.com/becked/per-ankh/commit/13c147e95bf07d59a4211f29e15ae589cac9017c)
- (tournament) hoist the # column check out of the cell render — [bcd94cf](https://github.com/becked/per-ankh/commit/bcd94cfb7f2c0c005e830478b78d8ccdcd8ac284)
- (format) prettier the family-colours baker — [aa79556](https://github.com/becked/per-ankh/commit/aa795565cbb9de8919066eb822dd7d9f930a0ba7)

## [2026-08-08-a315818] - 2026-08-08

### Features

- (tournaments) make scheduling your own match reachable — [be23372](https://github.com/becked/per-ankh/commit/be23372ae0feebf42900222ae20ee219b514cbf0)
- (tournaments) split the actions column on schedule state, not on who you are — [c2f5b53](https://github.com/becked/per-ankh/commit/c2f5b539b2d28f33948379a90a3415e37dbe59e6)
- (tournament) a match that outlived its sitting owes the sesh post its next part — [7cda80e](https://github.com/becked/per-ankh/commit/7cda80ec118f23cfe4acb16cbddfd76456ec39cb)
- (admin) store and serve a curated featured-video set — [4713973](https://github.com/becked/per-ankh/commit/47139739abc37f4a26e9dd34b42058fbd5523607)
- (admin) star any video card to feature it — [20ee1e1](https://github.com/becked/per-ankh/commit/20ee1e183350841905bd23da874f8ee520da0fb7)
- (api) serve the featured-video set publicly — [2639fee](https://github.com/becked/per-ankh/commit/2639fee7e97a9104c6bcf30759a8a45bacf9c601)
- (home) rebuild the signed-out hero around the tournament and a video — [aa11272](https://github.com/becked/per-ankh/commit/aa11272ec6596e1aba9830f88d66f77fccaa813d)
- (home) serve one home page to signed-in and signed-out viewers — [93532ce](https://github.com/becked/per-ankh/commit/93532ce4e8d34d2665956866abc38f37a51097b2)
- (home) frame the home page sections in titled panels — [0da1ce9](https://github.com/becked/per-ankh/commit/0da1ce9ab919fedc34c4337d9de37e4cbab1b772)

### Fixes

- (dev) point VITE_PUBLIC_ORIGIN at the dev server's actual port — [b26500a](https://github.com/becked/per-ankh/commit/b26500a881c329dedf52d4c7f0eeae370ac6551b)
- (tournaments) scroll a deep-linked match into view before opening its card — [b236a87](https://github.com/becked/per-ankh/commit/b236a87ec59bb587e18053452eea13593c89776a)
- (tournament) collapse played sessions so the next one stays above the fold — [8764619](https://github.com/becked/per-ankh/commit/876461901c8de6d634d8b3461f9d459ab96111bb)
- (tournament) an unparseable part time reads as an open part in the sesh export — [2daa8f2](https://github.com/becked/per-ankh/commit/2daa8f2c9149e8a52b96456adfcf72203990ae09)
- (deps) bump nanoid and kit to unblock the preflight audit gate — [2b2702f](https://github.com/becked/per-ankh/commit/2b2702fc5939583477684bee2c44fd165865effa)
- (video) attribute the profile videos feed to its owner — [a315818](https://github.com/becked/per-ankh/commit/a3158180ea1a332e59403ab83d0c5a22fb7bacf2)

### Other

- (tournaments) use MatchDetailPopover on the matches page — [7d65a25](https://github.com/becked/per-ankh/commit/7d65a252a7781c011d1a9c986f6a61c47ca2cd93)
- (ui) give the popover virtual-anchor shape one name — [05cbc2f](https://github.com/becked/per-ankh/commit/05cbc2f95d6302f276ad526d960b96988963af8b)
- (tournaments) stop the row click on the actions wrapper — [9d82712](https://github.com/becked/per-ankh/commit/9d8271217cad19be2701d8ab33c4b394e0e9bd65)
- (tournaments) make the caster participant refusal unconditional — [5cf7485](https://github.com/becked/per-ankh/commit/5cf748540360fdba08aa3e57f5c8b4b2b57cb58e)
- (tournament) fold the schedule collapse into one partition — [4f7f552](https://github.com/becked/per-ankh/commit/4f7f5522012718bf4ce77931702dc533412fc6cc)
- (tournament) say "parts", not "sessions", and share the played boundary — [0326a14](https://github.com/becked/per-ankh/commit/0326a14febf4196a9f714af3a0e32a71505c826e)
- reunite upcomingScheduledParts with its doc comment — [1d91fe6](https://github.com/becked/per-ankh/commit/1d91fe614286d6606bd7a168b61a9bdddfd1c0e3)
- (tournament) read part times through partInstant in owesNextSitting — [05ea8a9](https://github.com/becked/per-ankh/commit/05ea8a99c3e93998563fc8da56cb16e8b225b1c2)
- (tournament) read the aged-out boundary through partPlayed — [0508892](https://github.com/becked/per-ankh/commit/0508892b1c1cd745468f0248983bb024ad65685f)
- (tournament) bind the match once in the sesh to-be-scheduled block — [a2056de](https://github.com/becked/per-ankh/commit/a2056de49b2f4ef7fafd36bc605d92b76c465266)
- (tournament) name the owed-part helper for what it returns — [d93de7d](https://github.com/becked/per-ankh/commit/d93de7dae37e288dda06efea39f91cc6ad567e33)
- (tournament) delete the orphaned TournamentCard — [b309c7c](https://github.com/becked/per-ankh/commit/b309c7c0fbefa3a965c078c85a422749f82f7d83)
- (home) clear the leftovers from the two-page merge — [59416e7](https://github.com/becked/per-ankh/commit/59416e750e2ba5800220f9ce9c4da76a1a3fbb92)
- (video) key every video grid through videoKey — [08758b4](https://github.com/becked/per-ankh/commit/08758b4fbec2465897e66abb2b1a8ebf073805d0)
- (video) drop setFeatured's unused return value — [49cfe02](https://github.com/becked/per-ankh/commit/49cfe02ace31984bfd3f4ab5dc8e6170050833d5)
- (ux-review) rename the admin capture to match its route — [bbde145](https://github.com/becked/per-ankh/commit/bbde14532429fc2413f8268085e90e5ce7deeb81)

## [2026-08-06-2d7a830] - 2026-08-06

### Features

- (home) merge tournament playlist videos into the video strip — [d22a305](https://github.com/becked/per-ankh/commit/d22a305800fc97a6b627ab67718a948d626a52bd)
- (cloud) retune the tournament-link ceiling without a redeploy — [7ea4900](https://github.com/becked/per-ankh/commit/7ea49006e588fde552798887490610658ae65623)
- (cloud) count server-rendered reads against the visitor — [abf0d67](https://github.com/becked/per-ankh/commit/abf0d67bc4bbe97c2c8fa3b4fb9a8af3a4e088a3)
- (scripts) preflight-check SSR_TRUSTED_KEY on both Workers — [c24e762](https://github.com/becked/per-ankh/commit/c24e76270f0dd58cd894a90092b6f5b8b16e1cd0)

### Fixes

- (tournaments) answer a spent read budget with 429, not 500 — [33f6784](https://github.com/becked/per-ankh/commit/33f6784fde449efb094e17cf0b28bbc3146cd67e)
- (cloud) give the tournament-link read its own rate-limit budget — [752ff79](https://github.com/becked/per-ankh/commit/752ff79752097246cde1a47c2f00ebd836519932)
- (tournaments) 429 the profile page when its read budget is spent — [2602699](https://github.com/becked/per-ankh/commit/26026998eda4a88486d9f3f68de78ddafdfb1bdd)
- (cloud) log read audit failures under the shared event name — [f6b3793](https://github.com/becked/per-ankh/commit/f6b3793bdc6e34fb100cec2c921048fb67aff3c8)
- (cloud) carry the visitor's User-Agent across the SSR hop — [b16943f](https://github.com/becked/per-ankh/commit/b16943fb98468c276e63224f87a587410d154347)
- (tournaments) require a read ceiling to be a whole number — [d42c5ca](https://github.com/becked/per-ankh/commit/d42c5cae41aa427aad150925e1ef6e93409f376c)
- (web) answer a spent read budget on the Videos tab with the 429 page — [c0bb50a](https://github.com/becked/per-ankh/commit/c0bb50a939d7266ab2b9ec9ba659d7cc0dc94636)
- (cloud) narrow SSR trust to the visitor's address, charge every read — [8dbec5c](https://github.com/becked/per-ankh/commit/8dbec5c9a8f43cf5e3d62b9b4722eac80daaf3e9)
- (web) answer a spent read budget on the home page with the 429 page — [6973c0c](https://github.com/becked/per-ankh/commit/6973c0c0dac6d0f267476058608a04f9fc4f0daf)

### Performance

- (tournaments) spend one view slot per server-rendered page load — [2c303b3](https://github.com/becked/per-ankh/commit/2c303b3626eed174c0c7d955e5b00ec3c7007e6d)

### Other

- add a Cloudflare WAF runbook for edge rate limiting — [14a8362](https://github.com/becked/per-ankh/commit/14a83622c0dbbcf9bfaf9f37b3750d06f3618027)
- bring the rate-limit docs in line with what shipped — [fd7c8e7](https://github.com/becked/per-ankh/commit/fd7c8e7d9d4123dd7818857de65f85589f185bcc)
- correct what the forwarding path actually guarantees — [95fa3d8](https://github.com/becked/per-ankh/commit/95fa3d825cd08548af31d0cbd34cc265b5d73f35)
- bring the rate-limit docs in line with what the budgets now do — [d49819a](https://github.com/becked/per-ankh/commit/d49819ac103f6bd9fc11be63c68d1ca7c3ba5c66)
- (web) drop the home page's unreachable 429 re-throws — [f861757](https://github.com/becked/per-ankh/commit/f8617579d59f1deb3d682e86cd8323a6c0392f83)
- add turn-save series ingestion & storage design — [2d7a830](https://github.com/becked/per-ankh/commit/2d7a830278bc0aafc26ebf6324ffe3b75e7d66c4)

## [2026-08-03-454ca5e] - 2026-08-03

### Features

- (military) give non-duel games per-nation build cards — [98f901c](https://github.com/becked/per-ankh/commit/98f901ce6eee607c7d612838c7cbc7ab4a364f12)
- (home) filter the creator video feed to Old World titles — [c6c57df](https://github.com/becked/per-ankh/commit/c6c57df802ee0c4acd500fcd16dc9c0eabf2b136)

### Other

- (military) split the build comparison into two titled panels — [1e67bc4](https://github.com/becked/per-ankh/commit/1e67bc4c3e5ea190d61a80f53301cee2afa77054)
- (channels) prettier-format the creator-feed filter tests — [454ca5e](https://github.com/becked/per-ankh/commit/454ca5e1f0c5a5c48ae17d9920f04f267c72eae7)

## [2026-08-03-33f6ac0] - 2026-08-03

### Features

- (tournament) add-match endpoint for open Swiss rounds (late pairing) — [63091c4](https://github.com/becked/per-ankh/commit/63091c4892ea4e3e2d48cc516c1359b3b15400ac)
- (tournament) Pair action on Swiss standings rows — [efc8186](https://github.com/becked/per-ankh/commit/efc8186a2b3a168d18ae4073cea29e6a65f563a7)
- (tournament) show each late-pairing candidate's Swiss record — [0c5f4a2](https://github.com/becked/per-ankh/commit/0c5f4a26b7e963a6754de0159c3a6eeb266d5ecd)

### Fixes

- (account) give the profile URL room and center the tab bar — [054b6bb](https://github.com/becked/per-ankh/commit/054b6bb45258e52a2c5add53374b9bab59ba3416)
- (tournament) guard the add-match INSERT against round-close and double-add races — [763f511](https://github.com/becked/per-ankh/commit/763f5111b6353a9731004903ec1601a91a6113a4)
- (tournament) say plainly that a late pairing can't be undone — [006a95d](https://github.com/becked/per-ankh/commit/006a95d2e801f2509de5e7c3bb2e26e8479838a3)
- (tournament) harden the add-match INSERT — [9bdc853](https://github.com/becked/per-ankh/commit/9bdc85331c9dae4087b4be0ec13d580716ed4cd7)
- (deps) bump brace-expansion to 5.0.9 for the DoS advisory — [d9b19a0](https://github.com/becked/per-ankh/commit/d9b19a05ef1f192ac02eb94a6c97d78467f9f433)

### Other

- (tournament) document late pairing (rules + API reference) — [886fd05](https://github.com/becked/per-ankh/commit/886fd053bdb9dfa92873bdfdd499c062d2a89b98)
- apply becked's findings on late pairing — [cf76893](https://github.com/becked/per-ankh/commit/cf7689382b8316bb54d78b71a045a87056f99ef1)
- (tournament) collapse the slot picker's eligibility props into one — [c822de2](https://github.com/becked/per-ankh/commit/c822de2f0bced166236367a065d78ae6a9df998d)
- (preflight) allowlist the undici cache-directive advisory — [33f6ac0](https://github.com/becked/per-ankh/commit/33f6ac05fcdb7883404ea3880d47b3a170ceac39)

## [2026-08-03-88707b2] - 2026-08-03

### Features

- (profile-links) route profile URLs through one helper — [d658834](https://github.com/becked/per-ankh/commit/d658834dbc2a0b7ef96853c6e62aca64af7b8f6f)
- (tournament) ship slot_user_ids on the user-tournaments payload — [da22a86](https://github.com/becked/per-ankh/commit/da22a8656852d8686ef35dc4706466d7214c7c71)
- (tournament) link every player surface to their profile — [605d66a](https://github.com/becked/per-ankh/commit/605d66a7baff32d6318c077cd4f05448a4571a6c)
- (header) add a labeled Profile item to the signed-in menu — [c1d7ec4](https://github.com/becked/per-ankh/commit/c1d7ec41ab525dcc845ac73820d0e0b9be395441)
- (users) add a public people-search endpoint — [b827d95](https://github.com/becked/per-ankh/commit/b827d95b7cc341a9b84205a5b15e067785325ac1)
- (search) add an opt-in clear button to SearchInput — [7c9790e](https://github.com/becked/per-ankh/commit/7c9790eefa9390c3d45e9cc2a33645d175de9cb4)
- (header) search players and games from one always-open box — [53dc28d](https://github.com/becked/per-ankh/commit/53dc28db5f3db1a38bec3b6d1fe2bdf5ecca21a0)
- (users) claim a profile slug and serve the profile by it — [892923d](https://github.com/becked/per-ankh/commit/892923d659cd5b3c900287fc8e90de3b73487612)
- (users) serve profiles at /u/<slug> behind a permanent id permalink — [890817b](https://github.com/becked/per-ankh/commit/890817b553b6e1dcbff81347aea70ae7082d55d6)
- (account) claim a profile URL from settings — [6e9019f](https://github.com/becked/per-ankh/commit/6e9019ffb92727086a77dba6a0b8f55d35744043)
- (admin) set and clear a user's profile URL — [65c93f6](https://github.com/becked/per-ankh/commit/65c93f6f6fcf84de5ecf41bb6f69f939faf268db)
- (home) ship the uploader's profile slug on the public-recent feed — [d66fe17](https://github.com/becked/per-ankh/commit/d66fe1791a5078ca448e96ec8fcf0b9417527ea6)
- (games) ship the uploader's profile slug on the game detail payload — [a55f32d](https://github.com/becked/per-ankh/commit/a55f32d9663d6927c4299057a43a780c923d2aca)
- (videos) ship the creator's profile slug on the cross-creator feed — [5cc2c2b](https://github.com/becked/per-ankh/commit/5cc2c2b90dcb8714a2ccf0e1ac36d9e638d8e055)
- (tournament) ship the uploader's profile slug on the playlist videos — [38cc466](https://github.com/becked/per-ankh/commit/38cc466c789d7ba0271f98da7d011421b19b38bc)
- (tournament) ship each slot occupant's profile slug on standings rows — [334c478](https://github.com/becked/per-ankh/commit/334c4780789e56757db1c37ea68d348f8ca96fd0)
- (tournament) ship each slot occupant's profile slug on bracket slots — [acdc85e](https://github.com/becked/per-ankh/commit/acdc85e0daba918a6c362416bbb9412d25bcec03)
- (tournament) ship profile slugs on matches and the per-user tournaments read — [8f294f5](https://github.com/becked/per-ankh/commit/8f294f5dc14acd7b4637246447a1cd2a0c9670ee)
- (search) make a claimed profile URL both findable and a search key — [99e7081](https://github.com/becked/per-ankh/commit/99e70811efaaeac02dfe3c93112d33e181f5ac54)
- (tournament) ship each admin's profile slug on the admin roster — [0dee916](https://github.com/becked/per-ankh/commit/0dee916b4e994432c4dc0839d44148d23fabae04)
- (users) open a games-less tournament player on their Tournaments tab — [56f674a](https://github.com/becked/per-ankh/commit/56f674ad5a775879c03e69b1ca57aa5f96c14cfd)
- (users) derive profile slugs from display names, and let users rename — [ddf98ae](https://github.com/becked/per-ankh/commit/ddf98aec6881863eb09a25a3da186d4212dd7b93)

### Fixes

- (users) escape LIKE wildcards and bound profile-URL claim attempts — [534274e](https://github.com/becked/per-ankh/commit/534274ede160139c2ff536a1e327b10eab1cb359)
- (users) redirect the profile permalink with 307, not 308 — [10c24d2](https://github.com/becked/per-ankh/commit/10c24d27e0f1aeb97a888d764d615625b7079f10)
- (users) give an empty profile one empty-state message, in one voice — [fdc8bda](https://github.com/becked/per-ankh/commit/fdc8bdac3c9303d3f3bf754f2bd9d6c2c39cecce)
- (users) refresh the header after a profile URL change — [6737061](https://github.com/becked/per-ankh/commit/6737061d63e714e92c5b2260164cd11b5c86bbfc)
- (admin) report what backfill-slugs assigned, not what it planned — [d26eacf](https://github.com/becked/per-ankh/commit/d26eacf533ef9fd42d3da0552399e09a2b181293)

### Other

- (home) drop the stale "Go to library" note from the load comment — [7a3857c](https://github.com/becked/per-ankh/commit/7a3857cbbbf9110c1e5b4c7f32e7a3e5584e4378)
- (users) pare the profile URL card down to link and form — [f8520c0](https://github.com/becked/per-ankh/commit/f8520c06b93b8fdb5100993d711522472e6e44ce)
- (header) drop the Profile item from the menu — [41efb4a](https://github.com/becked/per-ankh/commit/41efb4a5620dc6da9210e50ba74702dd160badc2)
- (users) a null slug is no longer "unclaimed" — [4f571b8](https://github.com/becked/per-ankh/commit/4f571b8650dd6e9342eb12bf8ec387d9865c2a6b)

## [2026-08-02-0725ea9] - 2026-08-02

### Features

- (game-detail) specialist coverage split by slot kind, and side-by-side — [01bdab1](https://github.com/becked/per-ankh/commit/01bdab174d21d0a8f0f2270b5eeb60f6dd052aff)
- (parser) projects_produced — PARSER_VERSION 2.13.0 — [5f2d5bb](https://github.com/becked/per-ankh/commit/5f2d5bbdf2dac4c24ec5cc3ee794290e411810a9)
- (game-detail) show projects per nation when the game isn't a duel — [b531efc](https://github.com/becked/per-ankh/commit/b531efcd9d88aa0d6bb92a8d7b2371c936bba5a0)
- (bake) bake project art, and the PROJECT_ICON name table — [a2124b6](https://github.com/becked/per-ankh/commit/a2124b6ec041960dfc42a7e506dd3ab75e462b11)
- (game-detail) draw project icons, and head the FFA ledger cards — [6bc2465](https://github.com/becked/per-ankh/commit/6bc2465155e37a86d9c8271dcf544a3cf1e12384)
- (game-detail) Wonders tab — the catalogue with this game painted on — [efd931b](https://github.com/becked/per-ankh/commit/efd931bf8506d93993b126a404b979cdee31293d)
- (game-detail) panel the wonder tiers, and crest the builder line — [14cb455](https://github.com/becked/per-ankh/commit/14cb455bb600c6b10ccda27a954d35d0fa812add)

### Fixes

- (game-detail) let the projects panel own its icons and row order — [3907b43](https://github.com/becked/per-ankh/commit/3907b431e2147ae06a63b9067d21f1cde78b961b)
- (game-detail) drop the FFA "needs two nations" note from Economy — [717d059](https://github.com/becked/per-ankh/commit/717d0596b70ece42732a49bec1b8cab5046eb1e5)
- (game-detail) reserve the wonder card's icon slot — [9c061d8](https://github.com/becked/per-ankh/commit/9c061d8ffbcaaa4777320262cf24cba56137d0df)
- (game-detail) size the wonder tier heading like every other h2 — [972c26c](https://github.com/becked/per-ankh/commit/972c26cfb4db41582430e93f6acfff37ec390db8)

### Other

- (game-detail) stop listing wonders among the Built panel kinds — [63369f5](https://github.com/becked/per-ankh/commit/63369f599491167b58eda1b76a0c6d1deb07abe3)
- (game-detail) match a wonder's builder by id directly — [90cc3aa](https://github.com/becked/per-ankh/commit/90cc3aa6f9eee26b0c1e0ba503e8ffcf2d8d47c6)
- (game-detail) correct why the wonder card wraps its icon — [c9b3c03](https://github.com/becked/per-ankh/commit/c9b3c03245aaf62c4b030a62c9f99c714abf88ba)

## [2026-08-01-536831e] - 2026-08-01

### Features

- (cloud) configure Workers Logs and an OTLP log export — [b05cb82](https://github.com/becked/per-ankh/commit/b05cb82dd0e3da62566ac21c85358a219421273e)
- (cloud) record the serving colo on the access log — [617b604](https://github.com/becked/per-ankh/commit/617b60459052be4cd7072bed1f62a8254d2f3834)
- (cloud) export traces to Honeycomb, tagged with the normalized route — [7676137](https://github.com/becked/per-ankh/commit/76761378ae4a55385cbc152eb99caa2b25b6e2d8)

### Fixes

- (cloud) require a blob_cache tag on every readBlob call — [dee2cef](https://github.com/becked/per-ankh/commit/dee2cef60a3f7a5f1c69f49d19e4483239fc75ed)
- (cloud) serve untraced when ctx.tracing is absent — [1079aa9](https://github.com/becked/per-ankh/commit/1079aa99297aa64fbf68f3039df4c71deda3334b)
- (cloud) address review findings on the D1/R2 instrumentation — [4391501](https://github.com/becked/per-ankh/commit/4391501d59a4712edb776c46dbdf45191b1bd1d4)
- (cloud) serve untraced when startActiveSpan itself throws — [99b71b7](https://github.com/becked/per-ankh/commit/99b71b7bd3c1876282c19197dfcf22527e628d3d)
- (video) date live content by when it aired, not when its VOD went up — [709285e](https://github.com/becked/per-ankh/commit/709285e009fca67604c6a6dbaf01756c5a6b5c91)
- (video) address review findings on the broadcast-date fix — [685f50e](https://github.com/becked/per-ankh/commit/685f50e5a55f2e31b2891b2734fa84d7f481843b)

### Performance

- (cloud) time and count every D1 round trip per request — [d7735b4](https://github.com/becked/per-ankh/commit/d7735b4f4afec0ae7d933feaa391b42f694961a3)
- (cloud) time R2 blob reads and label the blob-cache outcome — [e8f0d67](https://github.com/becked/per-ankh/commit/e8f0d672fd190044be48b2c867235597d68b5d73)

### Other

- (cloud) stop naming Logpush in comments about the log sinks — [e085b8d](https://github.com/becked/per-ankh/commit/e085b8da8ea3ec5dec1edd81ae50f27afc0ae205)
- (cloud) scope r2_ms to reads that finish inside the Worker — [35e214b](https://github.com/becked/per-ankh/commit/35e214bf8c10ac90eb4e870e1f7fb3ccc53690bc)
- (cloud) correct two cross-references in the instrumentation notes — [5fd77e9](https://github.com/becked/per-ankh/commit/5fd77e96e72d0adc7117bc36b1b0ba7ce00b323a)
- trim derivable content from root CLAUDE.md — [c2ac3ee](https://github.com/becked/per-ankh/commit/c2ac3eec35c0efe7c3990a0cdee243e1103ef533)

## [2026-07-29-beab8b4] - 2026-07-29

### Features

- (game-detail) Economy tab — [d49f4c8](https://github.com/becked/per-ankh/commit/d49f4c8d155ea5a2443d2fec967c622784580664)
- (game-detail) restore BuildComparison's ±N diff column — [1354b03](https://github.com/becked/per-ankh/commit/1354b03d225ec64018235709036d8f1ec6dcab9a)
- (game-detail) Families tab — [d526041](https://github.com/becked/per-ankh/commit/d5260415b0e2e3ea940545c6a57f2d94220cb74b)

### Fixes

- (game-detail) hide National wealth's heading with its body — [b8d3fed](https://github.com/becked/per-ankh/commit/b8d3fed1f107f224ca012b123655f0151391fb1f)
- (game-detail) keep the Economy view switch reachable when a view empties — [5eb18eb](https://github.com/becked/per-ankh/commit/5eb18eb78257833a9028261737837b1f125ee427)
- (deploy) carry open tabs onto the new build — [beab8b4](https://github.com/becked/per-ankh/commit/beab8b4dc66a290746f2fa1b06cb2d1ba794fe7a)

### Performance

- (games) parallelize the game and tournament-link page loads — [86f0489](https://github.com/becked/per-ankh/commit/86f04899006798392fca0163e817b2911ab9e45a)
- (auth) drop the redundant admin lookup and parallelize /v1/auth/me — [26772a6](https://github.com/becked/per-ankh/commit/26772a61c3ce89384ceb113a3a4d3f711904c627)
- (games) overlap the anon read-limit count with the games-row read — [57cc813](https://github.com/becked/per-ankh/commit/57cc813faf16981825134f52356b92c79af0bee8)

### Other

- (game-detail) make BuildComparison generic over its subject — [99429f6](https://github.com/becked/per-ankh/commit/99429f632a6842c34617fb8c8f8536c0c76a76f3)
- (game-detail) comment tracked the unitTypes→keys rename — [2e01d14](https://github.com/becked/per-ankh/commit/2e01d14e27321ebe76c61b795cece4f9562f1cf5)
- (game-detail) drop showDiff until its first caller — [3b7c416](https://github.com/becked/per-ankh/commit/3b7c416d8d3e8b762e342d39b19fd668f395a99d)
- (game-detail) share the panels' row order through helpers — [eb3aaa0](https://github.com/becked/per-ankh/commit/eb3aaa02c6f1b4e7d7de0003a891403a19c9a1bb)
- (games) extract the game seeder into a shared test helper — [7c10081](https://github.com/becked/per-ankh/commit/7c10081c2aaf7658b1f142cde8ce767a6611698e)
- (games) cover the anon-read gate order on GET /v1/games/:id — [9ebfb5c](https://github.com/becked/per-ankh/commit/9ebfb5c42d053244dbeaa8aa65392f607cb3847f)
- (game-detail) require comparisonRowKeys' comparator — [005a3a3](https://github.com/becked/per-ankh/commit/005a3a31a9e67eb474a2c28fc771579d980ccfa3)
- (game-detail) counts and worker-turns side by side — [291247d](https://github.com/becked/per-ankh/commit/291247d2123cc75dc989492e1dbd97a13c8264bb)
- (game-detail) adopt comparisonRowKeys in the Economy panels — [faec997](https://github.com/becked/per-ankh/commit/faec99739a0409904f28488fd0001b3ddcb34e45)
- (game-detail) correct the Economy tab's stale comments — [db243e8](https://github.com/becked/per-ankh/commit/db243e828912ef061dfe8564696e04ec5fbfdd19)
- (game-detail) drop the Economy tab's pointers to a note that isn't there — [04cb808](https://github.com/becked/per-ankh/commit/04cb80829b0a7f451e77912cf0e663c3ac014a93)
- (game-detail) one opinion chart per nation — [e5843eb](https://github.com/becked/per-ankh/commit/e5843eb3b44e9078a9fa978f71e146e4d1ffcc1c)
- (game-detail) crest and align the Families tab's axis labels — [f3b072f](https://github.com/becked/per-ankh/commit/f3b072fa35081a0810d58845c7d53c6ae0ca07fc)
- (scripts) apply prettier to bake-family-opinion — [8a3c2cf](https://github.com/becked/per-ankh/commit/8a3c2cfbf43755e1f42e67856730f0f3c29a8f23)

## [2026-07-26-9a6722b] - 2026-07-26

### Features

- (stats) starting-leader archetype and trait win rates — [03c123d](https://github.com/becked/per-ankh/commit/03c123d256a6aaaa8b136329f1cc43f10cec1530)
- (stats) wonders — when they land, how builders fare, how often they're taken — [adb08e3](https://github.com/becked/per-ankh/commit/adb08e3c36f62ced64356e453bdf419f3b878984)
- (tournament) emphasize the winner in the shared match table — [4b7966d](https://github.com/becked/per-ankh/commit/4b7966d2cc89cc68574dc54873d6b312d13c5e21)
- (tournament) add GET /v1/users/:user_id/tournaments — [bf14692](https://github.com/becked/per-ankh/commit/bf14692ed7417b881ba9fb7ca38f686dc73a249c)
- (users) add the Tournaments tab to the player profile — [230a487](https://github.com/becked/per-ankh/commit/230a4877e507a089d5e45d5f3d7fc43225da9e64)
- (admin) sweep reparse and reindex by user, tournament, or upload date — [3013fdf](https://github.com/becked/per-ankh/commit/3013fdf5e12bf143b6fb5560a76b162c796483e0)
- (stats) capital family class win rate — [13a1058](https://github.com/becked/per-ankh/commit/13a10580492b47fd99635a09b1a6f5edb23e14a6)
- (stats) family city footprint, and families on the tournament page — [0be8c60](https://github.com/becked/per-ankh/commit/0be8c60e66eaa8a0d78f65cd7adb7f9e11e43cc3)
- (admin) add `cache list` / `cache clear` for the KV caches — [26254d5](https://github.com/becked/per-ankh/commit/26254d55fb8708aca2e35912410db8c17f045c95)

### Fixes

- (stats) don't credit index 0 with wonders whose builder is unknown — [4abf681](https://github.com/becked/per-ankh/commit/4abf681877bec0101a17088178f7c199bfd10658)
- (admin) clear cast appearances before deleting a user — [5983d75](https://github.com/becked/per-ankh/commit/5983d75bfec99b5ed19426dbcad8eae7946154f6)
- (tournament) index and widen per-user match attribution — [0737a94](https://github.com/becked/per-ankh/commit/0737a94efa4c8317aa8b66dde70e880253d3b62c)
- (tournament) gate the profile tab on matches, not on holding a seat — [5f3256c](https://github.com/becked/per-ankh/commit/5f3256c249b4052cb0e49509a3b15589fb3e9950)
- (tournament) keep the admin slot handle fields required — [edffc8a](https://github.com/becked/per-ankh/commit/edffc8aa7ebc0c0042e5295613b1580fe254546f)
- (parser) credit a wonder to who held its tile when it completed — [1189243](https://github.com/becked/per-ankh/commit/1189243f29e5eb32eb57108a3cda4ec3805207ac)
- (stats) keep conquered players in the wonder-eligibility denominator — [3f2c1de](https://github.com/becked/per-ankh/commit/3f2c1dea1345f23f05ef9ade1d4ebca51a6ace89)
- (stats) tell an unknown wonder pool apart from an empty one — [39f0c9b](https://github.com/becked/per-ankh/commit/39f0c9b587febfb2439cdef6d90392d5519b5c4f)
- (schemas) raise the disabled-improvements cap — [f4f95a4](https://github.com/becked/per-ankh/commit/f4f95a476b777d394ffd910693d5213290b16b52)
- (parser) read the disabled-improvement list off <Game> — [b8c8434](https://github.com/becked/per-ankh/commit/b8c8434acce484d7b4ac5d894239cfbc35b4ff06)
- (stats) say what data is missing in the chart empty states — [d863ada](https://github.com/becked/per-ankh/commit/d863ada13d048901f633c89814adbba68ba935dd)
- (stats) rewrite the wonder chart's title and tooltip copy — [4720123](https://github.com/becked/per-ankh/commit/4720123f12f36cb61eddae89deca33f2620bf0e8)
- (admin) disambiguate the reindex table list — [a90e479](https://github.com/becked/per-ankh/commit/a90e4799982c8716a668045f785387c1181d18a5)
- (stats) keep the wonder turn axis on its tick interval — [4e42b59](https://github.com/becked/per-ankh/commit/4e42b59bfa363ebc51b6b38927e35b644a1600f4)
- (stats) name the missing domain in the leader empty states — [924523f](https://github.com/becked/per-ankh/commit/924523fdfc4dc2b7e8a95930cfcc882c43c6fa41)
- (deps) bump sharp to 0.35.3 for the libvips advisory — [3ab7037](https://github.com/becked/per-ankh/commit/3ab7037083186e7d9921940de85962ba1f6d9f43)
- (deps) clear the sharp advisory in cloud's wrangler toolchain — [f09d55a](https://github.com/becked/per-ankh/commit/f09d55aae4306c55097ee39130818646b96e1c3c)
- (stats) rank family founding order by the player's own foundings — [19f0f88](https://github.com/becked/per-ankh/commit/19f0f88570e0fc15940fcabaefa2ff4222cceb51)
- (stats) name the denominator in the family pick tooltip — [61157d0](https://github.com/becked/per-ankh/commit/61157d0e921522569b631438e5d234bc2ae56954)
- (stats) say games, not matches, in the wonder tooltip — [7e0f84b](https://github.com/becked/per-ankh/commit/7e0f84b8f8eb9d28503c6615c26ea41a26e17be6)
- (games) chunk the family-city insert at its own column count — [ff046d9](https://github.com/becked/per-ankh/commit/ff046d9ae83d1ebb8ff5e1e123070270cd36717c)
- (games) make capital family attribution independent of city order — [25b2258](https://github.com/becked/per-ankh/commit/25b22585826bea85954ebf6c94dbf3d33a06e1c8)
- (stats) give the capital family chart its own empty state — [1121bc3](https://github.com/becked/per-ankh/commit/1121bc3c49c0ad764ebbb0980dad694dad0d7a1d)
- (deps) bump eslint to 10 to clear the brace-expansion advisory — [9ee2860](https://github.com/becked/per-ankh/commit/9ee2860b0eda0e969edd7a74b4bfdf8d002a80f0)
- (stats) separate the wonders outcome buckets by hue — [a2fc3e9](https://github.com/becked/per-ankh/commit/a2fc3e9cac10ab99642a1be7ae6f2ce66654d79a)

### Performance

- (charts) tree-shake ECharts and type options against the registered set — [c1676f8](https://github.com/becked/per-ankh/commit/c1676f8f2aac004d6a9b3830ac0c3545d4b5f43b)
- (tournament) chunk the per-match user identity batch — [0bd7b8c](https://github.com/becked/per-ankh/commit/0bd7b8c571ea94825e0fb220f9e0943b8aa613a3)
- (stats) drop the two family indexes nothing reads — [2510827](https://github.com/becked/per-ankh/commit/2510827f39dc5ca3110649b9f62bebb3b9e99fef)
- (cloud) cache parsed-game blobs per-POP in front of R2 — [4fbcdc5](https://github.com/becked/per-ankh/commit/4fbcdc50883b7c8ccb03657c6c33975ebf9d16b8)
- (cloud) give the events table its own primary D1 handle — [73bdbdb](https://github.com/becked/per-ankh/commit/73bdbdba7e34b65ab62287332ae6b99cfd6da501)
- (cloud) serve user stats from a D1 read replica — [1b8b2d4](https://github.com/becked/per-ankh/commit/1b8b2d49c392c86b46b81f5e6e51efd04ba3e99d)
- (cloud) anchor stale-tolerant sessions at first-primary — [a6f6b33](https://github.com/becked/per-ankh/commit/a6f6b33be9d93a4791cdc72e7d647debba5fd903)

### Other

- (lint) restrict the bare "echarts" import — [b30fc31](https://github.com/becked/per-ankh/commit/b30fc31f137127444d539e03bdc40910d9042bf6)
- (stats) address review — share the archetype rule, pass rate through — [39cb772](https://github.com/becked/per-ankh/commit/39cb7726020888701735c23574396495d166d23a)
- (stats) say the trait chart is capped at 15 rows — [95f77ba](https://github.com/becked/per-ankh/commit/95f77ba654966ab94eee2b824a92f3c7aa785dd8)
- (stats) apply the #155 review findings to the wonder chart — [14aaca5](https://github.com/becked/per-ankh/commit/14aaca5f5f003666c538411b0f52763ec692fe22)
- (tournament) extract matchSlotOutcome — [489667a](https://github.com/becked/per-ankh/commit/489667a4b6bf1b4da330ef6689d50c6dea4eeb30)
- (tournament) narrow MatchTable's tournament prop — [908662a](https://github.com/becked/per-ankh/commit/908662a81330e79d94a1bf5b1003cf764cc7ea3a)
- (tournament) make the admin-only slot Discord fields optional — [11f7e77](https://github.com/becked/per-ankh/commit/11f7e77bec8d8bb66a6f1952b4533c83c5b65627)
- (tournament) share the match table's chrome classes — [ed54fa5](https://github.com/becked/per-ankh/commit/ed54fa50e29d55ee8921fd0c235b8209e1af8889)
- (tournament) cover the public per-user read and its cast section — [66761fb](https://github.com/becked/per-ankh/commit/66761fbe70dfedefd80fd754c9e06c3a35028d0b)
- (api) document the profile tab flags and the attribution rule — [c10196a](https://github.com/becked/per-ankh/commit/c10196a9ea2656932a188e7674568faa7990eb8b)
- (tournament) drop the profile tab's enrollment section — [e44baad](https://github.com/becked/per-ankh/commit/e44baad73f775eff9a37948fcbd3b996dca97e21)
- (users) move the Stats tab to the end of the profile tab bar — [e1c8547](https://github.com/becked/per-ankh/commit/e1c8547152e9c5330fe99e0f2387f5a4fef5fbfa)
- (tournament) declare MatchTableTournament in the table module — [88ebdb1](https://github.com/becked/per-ankh/commit/88ebdb16b3bd55993cd8eac794ab51cfea042304)
- (tournament) move the profile Tournaments tab into the tournament lib — [1ca9890](https://github.com/becked/per-ankh/commit/1ca98905231018e757c73698e8f69321c0b73dff)
- correct the participation-query and header-status comments — [f4bc179](https://github.com/becked/per-ankh/commit/f4bc17933fe10b4587d5d5dda6f72394e279406a)
- (stats) drop the trait icon resolver, it can never resolve — [a2fb498](https://github.com/becked/per-ankh/commit/a2fb498b7b1a5a2a0496ca35dce015726e443bbd)
- (stats) drop the leader chart subtitles — [acda2ac](https://github.com/becked/per-ankh/commit/acda2ac9cbb137d8a09747a3d0da45ba5d0a9b27)
- (tournament) the stats page has five tabs, not three — [faa16ed](https://github.com/becked/per-ankh/commit/faa16ed4178ae49d022162f9235c275a648e48a2)
- (stats) keep fmtWonder local to the wonders chart — [0301673](https://github.com/becked/per-ankh/commit/030167365d1c4a19e0da7393d509a72dd2726702)
- (stats) draw each wonder as one outcome-colored bar — [0f3276a](https://github.com/becked/per-ankh/commit/0f3276af165ecd1d9d6bd3f5e4506617d53f6ff3)
- (deps) apply in-range security lockfile bumps — [41b58ed](https://github.com/becked/per-ankh/commit/41b58eddcc63a929df46946ebb90f14eede6549b)
- (ui) move UserAutocomplete into the shared ui lib — [e3902d9](https://github.com/becked/per-ankh/commit/e3902d9f2b6009c5966980e940588794a998c969)
- (stats) one outcome-series builder for the two family charts — [6a85a68](https://github.com/becked/per-ankh/commit/6a85a6893f847996e8d36ba3c9fe94c8718601b5)
- (stats) one win/loss builder behind both family charts — [c0a0806](https://github.com/becked/per-ankh/commit/c0a080673f794c9f3d223e0bd5dff8eca2f3982c)
- (stats) name the avg_share denominator and what v8 added — [32b2baa](https://github.com/becked/per-ankh/commit/32b2baaf2a85210b063aed7af8f462dab287e141)
- (stats) derive the bundle schema version from its changelog — [b81440a](https://github.com/becked/per-ankh/commit/b81440acd11b31272985888624d833316039ea48)
- "Claude PR Assistant workflow" — [2ae838d](https://github.com/becked/per-ankh/commit/2ae838d8d52839db33dcf26edc19fa81d0aaddec)
- "Claude Code Review workflow" — [fc174d3](https://github.com/becked/per-ankh/commit/fc174d39e0883b065b4ab2e404e09c8f02cdd282)
- (release) deploy 2026-07-26-9ee2860 — [db80a2c](https://github.com/becked/per-ankh/commit/db80a2caf9a23cc54f198734c6c6b12ffdb96baa)
- (ci) gate the @claude workflow to collaborators — [32fe3ef](https://github.com/becked/per-ankh/commit/32fe3eff15cb05ad3a7c7144dba6daea6be06d98)
- (ci) drop the auto PR review workflow — [437db88](https://github.com/becked/per-ankh/commit/437db881060e7f2df34baabab3fbcd1a156e3144)
- (skills) add pr-review skill for contributor-PR fit checks — [1b8c145](https://github.com/becked/per-ankh/commit/1b8c1455917d3a7fcdd7f1954fbe4de880fe20a6)
- (admin) note that the blob cache is out of the cache CLI's reach — [e8c4ff8](https://github.com/becked/per-ankh/commit/e8c4ff87c50f1228d71e7b731a0edcf881ea38a4)
- (cloud) read the reindex blob through readBlob — [a6c326a](https://github.com/becked/per-ankh/commit/a6c326acdb35654dbd8601b3b869580cb83a89bd)
- (cloud) move legacy share events queries to EVENTS_DB — [d5df19e](https://github.com/becked/per-ankh/commit/d5df19e46e5ac49a6715aa46c7764f59face2b0b)
- (cloud) mirror routeEnv in direct handler calls, widen the events guard — [76b167a](https://github.com/becked/per-ankh/commit/76b167a05b6c65f85aaa046867d8e38582d2b9af)
- (cloud) record D1 read replication as a provisioning step — [9710aba](https://github.com/becked/per-ankh/commit/9710aba5e1d484bae9b29adea9e99a6010dd245f)
- remove orphaned *ToRow serializers left by parity-harness removal — [c46d23f](https://github.com/becked/per-ankh/commit/c46d23f2d556f958fccefcf5ff89be38d1421ee3)
- (parser) drop parity-harness fossils orphaned by #132 and #153 — [4c96973](https://github.com/becked/per-ankh/commit/4c96973d24996d29d84dca3c134a3d04d735cfc0)
- (parser) drop unread Tile seed fields, re-anchor optI64Str's note — [583fff2](https://github.com/becked/per-ankh/commit/583fff240402b5d747c212dddc8b3c6b833ba5a3)
- drop trailing blank line flagged by prettier in claude.yml — [9a6722b](https://github.com/becked/per-ankh/commit/9a6722b185d41a657ba86e2ff0a66a7bd407e36a)

## [2026-07-26-9ee2860] - 2026-07-26

### Features

- (stats) starting-leader archetype and trait win rates — [03c123d](https://github.com/becked/per-ankh/commit/03c123d256a6aaaa8b136329f1cc43f10cec1530)
- (stats) wonders — when they land, how builders fare, how often they're taken — [adb08e3](https://github.com/becked/per-ankh/commit/adb08e3c36f62ced64356e453bdf419f3b878984)
- (tournament) emphasize the winner in the shared match table — [4b7966d](https://github.com/becked/per-ankh/commit/4b7966d2cc89cc68574dc54873d6b312d13c5e21)
- (tournament) add GET /v1/users/:user_id/tournaments — [bf14692](https://github.com/becked/per-ankh/commit/bf14692ed7417b881ba9fb7ca38f686dc73a249c)
- (users) add the Tournaments tab to the player profile — [230a487](https://github.com/becked/per-ankh/commit/230a4877e507a089d5e45d5f3d7fc43225da9e64)
- (admin) sweep reparse and reindex by user, tournament, or upload date — [3013fdf](https://github.com/becked/per-ankh/commit/3013fdf5e12bf143b6fb5560a76b162c796483e0)
- (stats) capital family class win rate — [13a1058](https://github.com/becked/per-ankh/commit/13a10580492b47fd99635a09b1a6f5edb23e14a6)
- (stats) family city footprint, and families on the tournament page — [0be8c60](https://github.com/becked/per-ankh/commit/0be8c60e66eaa8a0d78f65cd7adb7f9e11e43cc3)
- (admin) add `cache list` / `cache clear` for the KV caches — [26254d5](https://github.com/becked/per-ankh/commit/26254d55fb8708aca2e35912410db8c17f045c95)

### Fixes

- (stats) don't credit index 0 with wonders whose builder is unknown — [4abf681](https://github.com/becked/per-ankh/commit/4abf681877bec0101a17088178f7c199bfd10658)
- (admin) clear cast appearances before deleting a user — [5983d75](https://github.com/becked/per-ankh/commit/5983d75bfec99b5ed19426dbcad8eae7946154f6)
- (tournament) index and widen per-user match attribution — [0737a94](https://github.com/becked/per-ankh/commit/0737a94efa4c8317aa8b66dde70e880253d3b62c)
- (tournament) gate the profile tab on matches, not on holding a seat — [5f3256c](https://github.com/becked/per-ankh/commit/5f3256c249b4052cb0e49509a3b15589fb3e9950)
- (tournament) keep the admin slot handle fields required — [edffc8a](https://github.com/becked/per-ankh/commit/edffc8aa7ebc0c0042e5295613b1580fe254546f)
- (parser) credit a wonder to who held its tile when it completed — [1189243](https://github.com/becked/per-ankh/commit/1189243f29e5eb32eb57108a3cda4ec3805207ac)
- (stats) keep conquered players in the wonder-eligibility denominator — [3f2c1de](https://github.com/becked/per-ankh/commit/3f2c1dea1345f23f05ef9ade1d4ebca51a6ace89)
- (stats) tell an unknown wonder pool apart from an empty one — [39f0c9b](https://github.com/becked/per-ankh/commit/39f0c9b587febfb2439cdef6d90392d5519b5c4f)
- (schemas) raise the disabled-improvements cap — [f4f95a4](https://github.com/becked/per-ankh/commit/f4f95a476b777d394ffd910693d5213290b16b52)
- (parser) read the disabled-improvement list off <Game> — [b8c8434](https://github.com/becked/per-ankh/commit/b8c8434acce484d7b4ac5d894239cfbc35b4ff06)
- (stats) say what data is missing in the chart empty states — [d863ada](https://github.com/becked/per-ankh/commit/d863ada13d048901f633c89814adbba68ba935dd)
- (stats) rewrite the wonder chart's title and tooltip copy — [4720123](https://github.com/becked/per-ankh/commit/4720123f12f36cb61eddae89deca33f2620bf0e8)
- (admin) disambiguate the reindex table list — [a90e479](https://github.com/becked/per-ankh/commit/a90e4799982c8716a668045f785387c1181d18a5)
- (stats) keep the wonder turn axis on its tick interval — [4e42b59](https://github.com/becked/per-ankh/commit/4e42b59bfa363ebc51b6b38927e35b644a1600f4)
- (stats) name the missing domain in the leader empty states — [924523f](https://github.com/becked/per-ankh/commit/924523fdfc4dc2b7e8a95930cfcc882c43c6fa41)
- (deps) bump sharp to 0.35.3 for the libvips advisory — [3ab7037](https://github.com/becked/per-ankh/commit/3ab7037083186e7d9921940de85962ba1f6d9f43)
- (deps) clear the sharp advisory in cloud's wrangler toolchain — [f09d55a](https://github.com/becked/per-ankh/commit/f09d55aae4306c55097ee39130818646b96e1c3c)
- (stats) rank family founding order by the player's own foundings — [19f0f88](https://github.com/becked/per-ankh/commit/19f0f88570e0fc15940fcabaefa2ff4222cceb51)
- (stats) name the denominator in the family pick tooltip — [61157d0](https://github.com/becked/per-ankh/commit/61157d0e921522569b631438e5d234bc2ae56954)
- (stats) say games, not matches, in the wonder tooltip — [7e0f84b](https://github.com/becked/per-ankh/commit/7e0f84b8f8eb9d28503c6615c26ea41a26e17be6)
- (games) chunk the family-city insert at its own column count — [ff046d9](https://github.com/becked/per-ankh/commit/ff046d9ae83d1ebb8ff5e1e123070270cd36717c)
- (games) make capital family attribution independent of city order — [25b2258](https://github.com/becked/per-ankh/commit/25b22585826bea85954ebf6c94dbf3d33a06e1c8)
- (stats) give the capital family chart its own empty state — [1121bc3](https://github.com/becked/per-ankh/commit/1121bc3c49c0ad764ebbb0980dad694dad0d7a1d)
- (deps) bump eslint to 10 to clear the brace-expansion advisory — [9ee2860](https://github.com/becked/per-ankh/commit/9ee2860b0eda0e969edd7a74b4bfdf8d002a80f0)

### Performance

- (charts) tree-shake ECharts and type options against the registered set — [c1676f8](https://github.com/becked/per-ankh/commit/c1676f8f2aac004d6a9b3830ac0c3545d4b5f43b)
- (tournament) chunk the per-match user identity batch — [0bd7b8c](https://github.com/becked/per-ankh/commit/0bd7b8c571ea94825e0fb220f9e0943b8aa613a3)
- (stats) drop the two family indexes nothing reads — [2510827](https://github.com/becked/per-ankh/commit/2510827f39dc5ca3110649b9f62bebb3b9e99fef)

### Other

- (lint) restrict the bare "echarts" import — [b30fc31](https://github.com/becked/per-ankh/commit/b30fc31f137127444d539e03bdc40910d9042bf6)
- (stats) address review — share the archetype rule, pass rate through — [39cb772](https://github.com/becked/per-ankh/commit/39cb7726020888701735c23574396495d166d23a)
- (stats) say the trait chart is capped at 15 rows — [95f77ba](https://github.com/becked/per-ankh/commit/95f77ba654966ab94eee2b824a92f3c7aa785dd8)
- (stats) apply the #155 review findings to the wonder chart — [14aaca5](https://github.com/becked/per-ankh/commit/14aaca5f5f003666c538411b0f52763ec692fe22)
- (tournament) extract matchSlotOutcome — [489667a](https://github.com/becked/per-ankh/commit/489667a4b6bf1b4da330ef6689d50c6dea4eeb30)
- (tournament) narrow MatchTable's tournament prop — [908662a](https://github.com/becked/per-ankh/commit/908662a81330e79d94a1bf5b1003cf764cc7ea3a)
- (tournament) make the admin-only slot Discord fields optional — [11f7e77](https://github.com/becked/per-ankh/commit/11f7e77bec8d8bb66a6f1952b4533c83c5b65627)
- (tournament) share the match table's chrome classes — [ed54fa5](https://github.com/becked/per-ankh/commit/ed54fa50e29d55ee8921fd0c235b8209e1af8889)
- (tournament) cover the public per-user read and its cast section — [66761fb](https://github.com/becked/per-ankh/commit/66761fbe70dfedefd80fd754c9e06c3a35028d0b)
- (api) document the profile tab flags and the attribution rule — [c10196a](https://github.com/becked/per-ankh/commit/c10196a9ea2656932a188e7674568faa7990eb8b)
- (tournament) drop the profile tab's enrollment section — [e44baad](https://github.com/becked/per-ankh/commit/e44baad73f775eff9a37948fcbd3b996dca97e21)
- (users) move the Stats tab to the end of the profile tab bar — [e1c8547](https://github.com/becked/per-ankh/commit/e1c8547152e9c5330fe99e0f2387f5a4fef5fbfa)
- (tournament) declare MatchTableTournament in the table module — [88ebdb1](https://github.com/becked/per-ankh/commit/88ebdb16b3bd55993cd8eac794ab51cfea042304)
- (tournament) move the profile Tournaments tab into the tournament lib — [1ca9890](https://github.com/becked/per-ankh/commit/1ca98905231018e757c73698e8f69321c0b73dff)
- correct the participation-query and header-status comments — [f4bc179](https://github.com/becked/per-ankh/commit/f4bc17933fe10b4587d5d5dda6f72394e279406a)
- (stats) drop the trait icon resolver, it can never resolve — [a2fb498](https://github.com/becked/per-ankh/commit/a2fb498b7b1a5a2a0496ca35dce015726e443bbd)
- (stats) drop the leader chart subtitles — [acda2ac](https://github.com/becked/per-ankh/commit/acda2ac9cbb137d8a09747a3d0da45ba5d0a9b27)
- (tournament) the stats page has five tabs, not three — [faa16ed](https://github.com/becked/per-ankh/commit/faa16ed4178ae49d022162f9235c275a648e48a2)
- (stats) keep fmtWonder local to the wonders chart — [0301673](https://github.com/becked/per-ankh/commit/030167365d1c4a19e0da7393d509a72dd2726702)
- (stats) draw each wonder as one outcome-colored bar — [0f3276a](https://github.com/becked/per-ankh/commit/0f3276af165ecd1d9d6bd3f5e4506617d53f6ff3)
- (deps) apply in-range security lockfile bumps — [41b58ed](https://github.com/becked/per-ankh/commit/41b58eddcc63a929df46946ebb90f14eede6549b)
- (ui) move UserAutocomplete into the shared ui lib — [e3902d9](https://github.com/becked/per-ankh/commit/e3902d9f2b6009c5966980e940588794a998c969)
- (stats) one outcome-series builder for the two family charts — [6a85a68](https://github.com/becked/per-ankh/commit/6a85a6893f847996e8d36ba3c9fe94c8718601b5)
- (stats) one win/loss builder behind both family charts — [c0a0806](https://github.com/becked/per-ankh/commit/c0a080673f794c9f3d223e0bd5dff8eca2f3982c)
- (stats) name the avg_share denominator and what v8 added — [32b2baa](https://github.com/becked/per-ankh/commit/32b2baaf2a85210b063aed7af8f462dab287e141)
- (stats) derive the bundle schema version from its changelog — [b81440a](https://github.com/becked/per-ankh/commit/b81440acd11b31272985888624d833316039ea48)

## [2026-07-19-f120101] - 2026-07-19

### Features

- (military) bonus-card unit grants on the event rail — [6b1f5e0](https://github.com/becked/per-ankh/commit/6b1f5e07f2585e56d1bb469bc4ef6cc3cc256a65)
- (military) use the game's white flag glyphs for rail unit markers — [9e14889](https://github.com/becked/per-ankh/commit/9e14889fd3681d9215d997de7c55a26e37847fcd)
- (military) ring bonus-card markers in the player's color — [8ff56b4](https://github.com/becked/per-ankh/commit/8ff56b489819a67361bbd94b5f76459119b8bdb3)
- (military) read __ICON flag glyphs; drop the units_icons mirror — [1d0663d](https://github.com/becked/per-ankh/commit/1d0663d513dddce7c0e3b635f4746c3656d3c1e4)
- (military) distinguish bonus-card markers with a gold glow — [16f2419](https://github.com/becked/per-ankh/commit/16f2419c570185f7be8a56d8ee8f35b55d07728c)
- (stats) split yield curves by game outcome — [069afbd](https://github.com/becked/per-ankh/commit/069afbd066933a223648f5d608837b378068dfc9)
- (tournament) add Yields tab with winners-vs-losers toggle — [b95e05c](https://github.com/becked/per-ankh/commit/b95e05c29018329eea915017cd46f7874798096e)
- (bake) add the GAME_OPTION_NAMES display-name table — [1586ff1](https://github.com/becked/per-ankh/commit/1586ff1fd99a4aa3a96743335d068ef7aa0fde6c)
- (game-detail) show game options and opponent level on the Settings tab — [03c98b2](https://github.com/becked/per-ankh/commit/03c98b25fb76785a57c66f50ed5d36b9bb21dc0f)

### Fixes

- (stats) keep the yield band attached to the median when P25 is negative — [9796185](https://github.com/becked/per-ankh/commit/9796185682c9bdda277aa0236108fb5097759dd6)

### Other

- (game-detail) unit glyph as a units variant; share techName — [9c1439a](https://github.com/becked/per-ankh/commit/9c1439ae47b86706bc7374a4fe7eb00e0569cfd3)
- (stats) share WIN_COLOR/LOSS_COLOR from charts/helpers — [42ee3f7](https://github.com/becked/per-ankh/commit/42ee3f788887e288be7c388749c88dbb99a76b97)
- (stats) drop the winners/losers legend from the yield charts — [6d216b5](https://github.com/becked/per-ankh/commit/6d216b504cd02ebf02fe61caf2410756379406dc)
- (cloud) document display_name in the handleGamePatch header — [cdb1467](https://github.com/becked/per-ankh/commit/cdb146762e4a6cecbf1150cc693975fce224b580)
- (save-format) document temporal fidelity tiers and LogData retention — [c537e96](https://github.com/becked/per-ankh/commit/c537e968c46fd03b09fa3b96c0eae4ee611259c6)
- promote domain vocabulary to its own rule, add a PR review section — [201c121](https://github.com/becked/per-ankh/commit/201c12195fd2317c289e85d798d77426521b2dc0)
- (bake) refresh the bake skill's command list and sidecar semantics — [f120101](https://github.com/becked/per-ankh/commit/f120101dbd980ab1f86dbd2910612b503c27f733)

## [2026-07-18-39a0549] - 2026-07-18

### Features

- (techs) side-by-side tech timeline with planner links in the header — [7cd421c](https://github.com/becked/per-ankh/commit/7cd421ca9c31af51e6c36805526ff64d826a24d3)
- (techs) icons + unlock-cost ordering in Science Sources — [42cd997](https://github.com/becked/per-ankh/commit/42cd997b82414cf968c3d0e2046c6f7ad4d2d5d6)
- (techs) slim the Techs by Turn header — [ee2a6cb](https://github.com/becked/per-ankh/commit/ee2a6cb13ab18de10bd793e3152f3e51c379e202)
- (techs) flatten Techs by Turn cells to plain text — [69959d3](https://github.com/becked/per-ankh/commit/69959d3c7f3905392a7d6d2ea338b4e7148bee5f)
- (techs) add styled hover panel to Techs by Turn cells — [e7047ab](https://github.com/becked/per-ankh/commit/e7047ab0d64dbd96c9542926a4a2c58354b8dd96)
- (techs) pair Techs by Turn with Science Sources on wide screens — [7657da3](https://github.com/becked/per-ankh/commit/7657da3add5b99df6defab0e13b0111386b92238)
- (techs) relabel the tech-path link to "Show tech path" — [33ccc56](https://github.com/becked/per-ankh/commit/33ccc562242536b4d80f8edac270549f2b1e85f7)
- (tournament) remember casters' stream links and auto-attach on cast — [00ab780](https://github.com/becked/per-ankh/commit/00ab78077b9818a207eb3ecb9ffdb3d9c4fb992c)
- (tournament) backfill stream links from casting history; YouTube-first copy — [b9a4d42](https://github.com/becked/per-ankh/commit/b9a4d42b498054115bb7e84299d916a54f1ff83f)
- (techs) science chart view toggle on the Techs tab — [8276f34](https://github.com/becked/per-ankh/commit/8276f34eb8f19724d96db6680a4822b731448a61)
- (techs) drop redundant in-chart titles and hard y-axis cap — [c2fcfef](https://github.com/becked/per-ankh/commit/c2fcfefca7744a2681d7885199d209ad415fb598)

### Fixes

- (techs) match Techs by Turn styling to the Science Sources card — [071e82c](https://github.com/becked/per-ankh/commit/071e82ca11ce2d99148fdeb5bf4ece010d29e4b3)
- (preflight) don't truncate baked asset paths at embedded quotes — [39a0549](https://github.com/becked/per-ankh/commit/39a054977312671aba1e9e0a7a1e18285c2fdb8a)

### Other

- (techs) re-bake sprite manifest to local renders — [c643a86](https://github.com/becked/per-ankh/commit/c643a869db8aafb436f43b298c87fef45fb870df)
- refresh drifted baked data tables — [53f78d4](https://github.com/becked/per-ankh/commit/53f78d4c14c9fe4aca9ff1167a7916e730996ef8)
- fix prettier drift in bake-sprites and science-techs — [b95f0aa](https://github.com/becked/per-ankh/commit/b95f0aa4b073760600f386f607901f631968d7d6)
- (tournament) extract shared ensureUrlScheme URL helper — [037024d](https://github.com/becked/per-ankh/commit/037024d27da53ac8954eed4284b5563ac895f362)
- (account) group casting stream link with channels under a Video tab — [c0b04f2](https://github.com/becked/per-ankh/commit/c0b04f24787784bfb9be0cad2f26c834d6b9ffd9)
- apply prettier formatting to auth and tournament links editor — [ee86f19](https://github.com/becked/per-ankh/commit/ee86f1915d9a0c8093d96365d24ca68f9f9d470b)

## [2026-07-16-66af647] - 2026-07-16

### Features

- (techs) science event rail, source breakdown, and owtt planner links (#128) — [fa2b066](https://github.com/becked/per-ankh/commit/fa2b066eb247a6c08dfa5f8d5927d1208437a1fe)

### Fixes

- (tournament) read DOTA's map variant from either option spelling — [1c397b2](https://github.com/becked/per-ankh/commit/1c397b24cc213acf524e04719b0964b389374584)
- (tournament) bucket Swiss float-down matches by the record they were paired in — [1377120](https://github.com/becked/per-ankh/commit/13771209552d83769870a6d26eb1ae5574d2bc8a)

### Other

- (release) deploy 2026-07-15-1377120 — [5f96f3e](https://github.com/becked/per-ankh/commit/5f96f3ef7633da0839732f7b9be5d9bd14ce2883)
- apply prettier formatting — [66af647](https://github.com/becked/per-ankh/commit/66af647bc4b45e6b765137e5b39c31b797be6916)

## [2026-07-15-1377120] - 2026-07-15

### Fixes

- (tournament) read DOTA's map variant from either option spelling — [1c397b2](https://github.com/becked/per-ankh/commit/1c397b24cc213acf524e04719b0964b389374584)
- (tournament) bucket Swiss float-down matches by the record they were paired in — [1377120](https://github.com/becked/per-ankh/commit/13771209552d83769870a6d26eb1ae5574d2bc8a)

## [2026-07-14-b6d239c] - 2026-07-14

### Fixes

- (video) dedupe playlist videos by id before capping — [11b1607](https://github.com/becked/per-ankh/commit/11b1607df52e897f8a03e860173b006b0391546c)
- (video) bump video cache version to 4 to orphan duplicate-laden entries — [b6d239c](https://github.com/becked/per-ankh/commit/b6d239ce0a2d6367417433df76ba6833fc77d0ca)

### Other

- list api-reference.md in CLAUDE.md key docs — [76dae9b](https://github.com/becked/per-ankh/commit/76dae9ba0f157306b0cc69f94ec37000bb02351d)

## [2026-07-11-a045baa] - 2026-07-11

### Fixes

- (game-detail) restore hover on the Tech and Law charts — [a045baa](https://github.com/becked/per-ankh/commit/a045baa57add7134351df2d16fc67cd4270c8463)

## [2026-07-11-ab605e1] - 2026-07-11

### Other

- (game-detail) unify line-chart styling across tabs — [ab605e1](https://github.com/becked/per-ankh/commit/ab605e12bf0e1b56a8054895c88c51cccf42b440)

## [2026-07-11-3b65ccb] - 2026-07-11

### Features

- (tournament) add YouTube playlist Videos tab — [c9a6d62](https://github.com/becked/per-ankh/commit/c9a6d620d7deb9208b611c677a40e470f5e1e427)
- (tournament) search all playlist videos on the Videos tab — [3b65ccb](https://github.com/becked/per-ankh/commit/3b65ccb5b4191fb09d4fa6ecbd68b1ad261c5644)

### Fixes

- (tournament) sort playlist videos newest-first and make uploader attribution deterministic — [a35869f](https://github.com/becked/per-ankh/commit/a35869f3f1e5730293f4deebb9fef0e1534310c2)

## [2026-07-10-f24d8d7] - 2026-07-10

### Features

- (map) guard against and degrade gracefully on atlas manifest desync — [9ba2f32](https://github.com/becked/per-ankh/commit/9ba2f323705d4281ce7c2e8dd7787470e802c3b6)
- (game-detail) add workers-over-time chart to improvements tab — [7958ea3](https://github.com/becked/per-ankh/commit/7958ea30444d3759ba841d6efc33da5e07a4d3f2)
- (profile) add creator video channels with recent YouTube videos — [25f3dfb](https://github.com/becked/per-ankh/commit/25f3dfbaa9a14e9240fa0c6c866633394c4945d9)
- (home) add "Latest from creators" videos strip — [6736499](https://github.com/becked/per-ankh/commit/6736499e5ec49b05eb880fccbcffe6b1e0bd8d38)
- (home) move creator videos into a middle column beside recent games — [ab5ca15](https://github.com/becked/per-ankh/commit/ab5ca150c4934f5dc151b3897b9f2d7a516000b7)
- (admin) add creator video channel CLI commands — [a937af5](https://github.com/becked/per-ankh/commit/a937af5c3d29bbcc6e5da24872491a10e774a3f5)
- (home) lift discovery cards on hover instead of recoloring — [d86ee1c](https://github.com/becked/per-ankh/commit/d86ee1cba07d722f36915a17049572ee7fd59481)

### Fixes

- (map) gate render on structural atlases; fail preflight on empty manifest — [25a4832](https://github.com/becked/per-ankh/commit/25a4832a20d7f779d81df49b5c6077f4a95cb2ce)
- (game-detail) show curated map label in header for lowercase scripts — [909318f](https://github.com/becked/per-ankh/commit/909318f8df433d7d2c3f980638c9a4b58ee9237e)
- (video) guard XML entity decode; correct YOUTUBE_API_KEY comment — [488d217](https://github.com/becked/per-ankh/commit/488d217b06e8fa21926d859b8afd05af29b4e554)
- (home) reflect channel add/remove in creator feed immediately — [99e2b46](https://github.com/becked/per-ankh/commit/99e2b4664097a6bcf1ef5681355e1f6306d0ca46)

### Other

- (home) resize creator videos and rebalance the discovery grid — [3ddb6bb](https://github.com/becked/per-ankh/commit/3ddb6bbb02d0d91f52580784c6e722ad0064ba18)
- (video) share one card between the home feed and profile tab — [b516f32](https://github.com/becked/per-ankh/commit/b516f3206a72bac54ffd9c1119b9d5dfcd68550a)
- (home) remove the signed-in right-rail user panel — [1c1a150](https://github.com/becked/per-ankh/commit/1c1a15019ba98c8cc6d992d1c1ed3eeb61e36a67)
- apply prettier formatting to channel/video/tournament files — [f24d8d7](https://github.com/becked/per-ankh/commit/f24d8d7f26b19e101916f49b0bc4271d477a1201)

## [2026-07-10-38db13e] - 2026-07-10

### Features

- (tournament) atomic guarded slot-occupant swap — [b257a2f](https://github.com/becked/per-ankh/commit/b257a2ff30852dae830d070ecc646a900d11a4fa)
- (tournament) swap-slot occupant UI in Swiss standings — [6480c3c](https://github.com/becked/per-ankh/commit/6480c3c72715f14fb898bbde0dd107b9d37cc625)
- (tournament) anchor swap picker in a popover — [1ea3919](https://github.com/becked/per-ankh/commit/1ea39196e94dd038a2747f0cdf83eeda6dacf496)

## [2026-07-08-afa7ee2] - 2026-07-08

### Fixes

- (map) regenerate atlas manifest to the baked resources hash — [afa7ee2](https://github.com/becked/per-ankh/commit/afa7ee24a1a08d87e8e7426baa6151bfdf5130f9)

### Other

- (api) add HTTP API reference with route drift guard — [be89e8a](https://github.com/becked/per-ankh/commit/be89e8a6f36ee73ab5e355eaaf51c0fb8f41c74c)

## [2026-07-07-0fdd309] - 2026-07-07

### Features

- (tournament) show the viewer's timezone on the clock toggle — [6fa6990](https://github.com/becked/per-ankh/commit/6fa6990e49bc9b2770277b1e603c8d9d5b0d15a1)
- (tournament) add tournament-stats MVP (standings, casters, nation win rate) — [48c81dc](https://github.com/becked/per-ankh/commit/48c81dc3e3a3be53cf687cf5449a0dd946e17d1c)
- (tournament) add stats nav link and tab the stats page — [5515cb1](https://github.com/becked/per-ankh/commit/5515cb1da29afa2043e21142a8480cd596e61595)
- (tournament) render circular Discord avatars in the stats chart labels — [b8c329f](https://github.com/becked/per-ankh/commit/b8c329f99fd2cbe694344500735ec14a08236a1a)
- (games) let admins reparse a public game from its detail page — [3e40aa9](https://github.com/becked/per-ankh/commit/3e40aa95b28999e54f07e354da1b420df5b2ea3f)
- (tournament) add per-player nation picks to the stats Players tab — [fbaf0fa](https://github.com/becked/per-ankh/commit/fbaf0fa3c335cd494b7624b05e7232f76bb1a8a9)
- (tournament) "copy caster post" button on the match popover (#107) — [75085e2](https://github.com/becked/per-ankh/commit/75085e287cc83ecaed9dae640901bc5beac47c94)
- (tournament) add Matches tab, group header views into a toggle — [253b53d](https://github.com/becked/per-ankh/commit/253b53d88fedc9ef32c29ac2e98d434283ac73bb)
- (tournament) crossfade view content on tab switch — [624bea6](https://github.com/becked/per-ankh/commit/624bea6c77f989f3d60db3bac5047fea4262d9bd)

### Fixes

- (ui) add bottom padding to the chart expand button — [0e66754](https://github.com/becked/per-ankh/commit/0e667543b934826ac2b7e63413d52ccfa55c9021)
- (map) resolve a city's family per turn on the map — [da16328](https://github.com/becked/per-ankh/commit/da16328dcba30b793197837824729fbc1c743da9)
- (map) point resources atlas manifest at the baked hash — [9bd949a](https://github.com/becked/per-ankh/commit/9bd949afcd9d59b90ae9ce56b0539bad02e38a31)
- (ui) center the chart expand button icon — [c6a4c5b](https://github.com/becked/per-ankh/commit/c6a4c5bcb84aee9b46af1c85bcacfb10fbae6e20)
- (tournament) pin view-tab header controls so they don't shift — [1045bd2](https://github.com/becked/per-ankh/commit/1045bd2bf792662c96cf9c3d5621b937ec455cae)
- (tournament) reserve scrollbar gutter so tab switch doesn't shift — [d9a1831](https://github.com/becked/per-ankh/commit/d9a18314bf50b5ad8eec7efafc0f1a19904165d6)
- (security) escape user-controlled strings in ECharts tooltips — [4ca8daf](https://github.com/becked/per-ankh/commit/4ca8daf1c9f78d54ddabf0a792b4e4b7c0de5d49)

### Other

- restructure CLAUDE.md into root + nested files + skills — [aa576c2](https://github.com/becked/per-ankh/commit/aa576c23e32b3fe629db9cd008b9cd675be5ceca)
- (tournament) tabular-nums instead of monospace for match numbers — [ee10473](https://github.com/becked/per-ankh/commit/ee1047381e6420abe8d3b71e481738bd5bf1ace6)
- (header) put Upload icon before its label to match other buttons — [ec718ef](https://github.com/becked/per-ankh/commit/ec718ef59879d72b114c79052f0f872db2300fae)
- (tournament) add tournament-stats design & build plan — [19728f8](https://github.com/becked/per-ankh/commit/19728f81df38f0695f0f2be4a099783021f6b3ca)
- (cloud) stop claiming tournaments.updated_at is a cache key — [569f90c](https://github.com/becked/per-ankh/commit/569f90c9fcfe957153cfc4ea80842e91a3bdc491)
- (tournament) settle the tournament-stats open decisions — [c346e9a](https://github.com/becked/per-ankh/commit/c346e9aaaa478383d85ca39dbfa90a1200b2b8a2)
- (tournament) add rendered chart examples for the stats design — [820ba9f](https://github.com/becked/per-ankh/commit/820ba9f0781de95edb2aba6f13e5455d08a3f610)
- (tournament) rework the stats build plan around a three-chart MVP — [4982568](https://github.com/becked/per-ankh/commit/49825683347b6f9e220cb2c18afe686550a9c0c0)
- (release) deploy 2026-07-06-da16328 — [f99e92d](https://github.com/becked/per-ankh/commit/f99e92dbb607bec67cf98da60f418a68cfe25c5f)
- (tournament) address tournament-stats MVP review findings — [8cff4a2](https://github.com/becked/per-ankh/commit/8cff4a252bc68a3ea840ea1cc8db378911d71993)
- document local Worker setup (.dev.vars.example, dev-login, migrations) — [9a49550](https://github.com/becked/per-ankh/commit/9a4955048cb06874b23eea69044cd1b628d4f1b6)
- (release) deploy 2026-07-07-9a49550 — [611ee89](https://github.com/becked/per-ankh/commit/611ee89a2863173ea75b3cb9f1c294ba6a7b59f7)
- (assets) refresh XML-derived data tables — [b39f690](https://github.com/becked/per-ankh/commit/b39f690a00ae5c63ce0baf5f686d671ea102b737)
- (release) deploy 2026-07-07-b39f690 — [7c8655f](https://github.com/becked/per-ankh/commit/7c8655f7a2de891ece3b4ea065d5cf31e4707c0b)
- (tournament) share one player_summaries batch loader — [a170b90](https://github.com/becked/per-ankh/commit/a170b90f9360a18b427b891a08ff9c86877f50e6)
- (tournament) correct cache-key comments and record the Plane A cost shift — [033525e](https://github.com/becked/per-ankh/commit/033525e38ab6f8069b228d2d372ddb9a71118861)
- (tournament) settle Plane A caching — stays uncached, quantified — [dbfd2c9](https://github.com/becked/per-ankh/commit/dbfd2c9d44fd76d401674b2fc927b496b5f97924)
- apply prettier line-wrapping to tournament stats files — [b9c8424](https://github.com/becked/per-ankh/commit/b9c842477fbf74d7a7e28d066d980973a1dbb29c)
- (tournament) match view toggle to the matches-page segmented control — [ad16e0d](https://github.com/becked/per-ankh/commit/ad16e0d5150dbddd85d4a2b6460c6c5b757f312e)
- (tournament) hoist header into a shared [slug] layout — [4e1d0fe](https://github.com/becked/per-ankh/commit/4e1d0fe5f019c8429aa839e3d4866cc59fd76af1)
- add CONTRIBUTING guide with fork-and-PR workflow — [f78c444](https://github.com/becked/per-ankh/commit/f78c4448fb222512a621f9925635d7045c2b1da2)
- (tournament) apply stats-review consistency cleanups — [7d7956b](https://github.com/becked/per-ankh/commit/7d7956b9b924e8b79e4d54946d895274cbe3b565)

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
