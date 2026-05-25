# Per-Ankh — UX Review Bundle

Generated **2026-05-25T00:52:25.703Z** against `http://localhost:1420` · game `P5J5b0oR1IYan3cBtW2zt` · public user `xuWIHsyF2uC7ybDPjqd1G` · signed in as `xuWIHsyF2uC7ybDPjqd1G` (.becked).

## How to review

- **Humans:** open `index.html` — sidebar nav tree, breakpoint switcher, click any shot to zoom.
- **Claude Code:** start from `manifest.json` for the full inventory (route + state + breakpoint paths per screen), then Read only the `shots/*.jpg` you need. Filenames are `{pass}__{page}[__{tab}]__{breakpoint}.jpg`, so you can glob — e.g. `shots/auth__*__mobile.jpg` for every signed-in screen on mobile.

## What to look for

- Layout integrity at each breakpoint (overflow, clipping, tap-target size on mobile).
- State differences: anonymous vs. owner views of the same page (controls that should/shouldn't appear).
- Consistency of headers, tables, and charts against the games-table theme.
- Empty/edge states and any visibly broken renders.

## Inventory

Breakpoints: Desktop (1440×900), Tablet (768×1024), Mobile (390×844).

### Anonymous (signed out)

**Home** — `/`

- Home: [Desktop](shots/anon__home__desktop.jpg) · [Tablet](shots/anon__home__tablet.jpg) · [Mobile](shots/anon__home__mobile.jpg)

**Game detail** — `/games/P5J5b0oR1IYan3cBtW2zt`

- Overview: [Desktop](shots/anon__game-detail__overview__desktop.jpg) · [Tablet](shots/anon__game-detail__overview__tablet.jpg) · [Mobile](shots/anon__game-detail__overview__mobile.jpg)
- Events: [Desktop](shots/anon__game-detail__events__desktop.jpg) · [Tablet](shots/anon__game-detail__events__tablet.jpg) · [Mobile](shots/anon__game-detail__events__mobile.jpg)
- Laws: [Desktop](shots/anon__game-detail__laws__desktop.jpg) · [Tablet](shots/anon__game-detail__laws__tablet.jpg) · [Mobile](shots/anon__game-detail__laws__mobile.jpg)
- Techs: [Desktop](shots/anon__game-detail__techs__desktop.jpg) · [Tablet](shots/anon__game-detail__techs__tablet.jpg) · [Mobile](shots/anon__game-detail__techs__mobile.jpg)
- Yields: [Desktop](shots/anon__game-detail__yields__desktop.jpg) · [Tablet](shots/anon__game-detail__yields__tablet.jpg) · [Mobile](shots/anon__game-detail__yields__mobile.jpg)
- Military: [Desktop](shots/anon__game-detail__military__desktop.jpg) · [Tablet](shots/anon__game-detail__military__tablet.jpg) · [Mobile](shots/anon__game-detail__military__mobile.jpg)
- Cities: [Desktop](shots/anon__game-detail__cities__desktop.jpg) · [Tablet](shots/anon__game-detail__cities__tablet.jpg) · [Mobile](shots/anon__game-detail__cities__mobile.jpg)
- Improvements: [Desktop](shots/anon__game-detail__improvements__desktop.jpg) · [Tablet](shots/anon__game-detail__improvements__tablet.jpg) · [Mobile](shots/anon__game-detail__improvements__mobile.jpg)
- Map: [Desktop](shots/anon__game-detail__map__desktop.jpg) · [Tablet](shots/anon__game-detail__map__tablet.jpg) · [Mobile](shots/anon__game-detail__map__mobile.jpg)
- Settings: [Desktop](shots/anon__game-detail__settings__desktop.jpg) · [Tablet](shots/anon__game-detail__settings__tablet.jpg) · [Mobile](shots/anon__game-detail__settings__mobile.jpg)

**User profile** — `/users/xuWIHsyF2uC7ybDPjqd1G?tab=overview`

- Overview: [Desktop](shots/anon__user-profile__overview__desktop.jpg) · [Tablet](shots/anon__user-profile__overview__tablet.jpg) · [Mobile](shots/anon__user-profile__overview__mobile.jpg)
- Games: [Desktop](shots/anon__user-profile__games__desktop.jpg) · [Tablet](shots/anon__user-profile__games__tablet.jpg) · [Mobile](shots/anon__user-profile__games__mobile.jpg)
- Stats: [Desktop](shots/anon__user-profile__stats__desktop.jpg) · [Tablet](shots/anon__user-profile__stats__tablet.jpg) · [Mobile](shots/anon__user-profile__stats__mobile.jpg)

### Signed in (.becked)

**Home** — `/`

- Home: [Desktop](shots/auth__home__desktop.jpg) · [Tablet](shots/auth__home__tablet.jpg) · [Mobile](shots/auth__home__mobile.jpg)

**User profile** — `/users/xuWIHsyF2uC7ybDPjqd1G?tab=overview`

- Overview: [Desktop](shots/auth__user-profile__overview__desktop.jpg) · [Tablet](shots/auth__user-profile__overview__tablet.jpg) · [Mobile](shots/auth__user-profile__overview__mobile.jpg)
- Games: [Desktop](shots/auth__user-profile__games__desktop.jpg) · [Tablet](shots/auth__user-profile__games__tablet.jpg) · [Mobile](shots/auth__user-profile__games__mobile.jpg)
- Stats: [Desktop](shots/auth__user-profile__stats__desktop.jpg) · [Tablet](shots/auth__user-profile__stats__tablet.jpg) · [Mobile](shots/auth__user-profile__stats__mobile.jpg)

**Account** — `/account`

- Account: [Desktop](shots/auth__account__desktop.jpg) · [Tablet](shots/auth__account__tablet.jpg) · [Mobile](shots/auth__account__mobile.jpg)

**Game detail** — `/games/P5J5b0oR1IYan3cBtW2zt`

- Overview: [Desktop](shots/auth__game-detail__overview__desktop.jpg) · [Tablet](shots/auth__game-detail__overview__tablet.jpg) · [Mobile](shots/auth__game-detail__overview__mobile.jpg)
- Events: [Desktop](shots/auth__game-detail__events__desktop.jpg) · [Tablet](shots/auth__game-detail__events__tablet.jpg) · [Mobile](shots/auth__game-detail__events__mobile.jpg)
- Laws: [Desktop](shots/auth__game-detail__laws__desktop.jpg) · [Tablet](shots/auth__game-detail__laws__tablet.jpg) · [Mobile](shots/auth__game-detail__laws__mobile.jpg)
- Techs: [Desktop](shots/auth__game-detail__techs__desktop.jpg) · [Tablet](shots/auth__game-detail__techs__tablet.jpg) · [Mobile](shots/auth__game-detail__techs__mobile.jpg)
- Yields: [Desktop](shots/auth__game-detail__yields__desktop.jpg) · [Tablet](shots/auth__game-detail__yields__tablet.jpg) · [Mobile](shots/auth__game-detail__yields__mobile.jpg)
- Military: [Desktop](shots/auth__game-detail__military__desktop.jpg) · [Tablet](shots/auth__game-detail__military__tablet.jpg) · [Mobile](shots/auth__game-detail__military__mobile.jpg)
- Cities: [Desktop](shots/auth__game-detail__cities__desktop.jpg) · [Tablet](shots/auth__game-detail__cities__tablet.jpg) · [Mobile](shots/auth__game-detail__cities__mobile.jpg)
- Improvements: [Desktop](shots/auth__game-detail__improvements__desktop.jpg) · [Tablet](shots/auth__game-detail__improvements__tablet.jpg) · [Mobile](shots/auth__game-detail__improvements__mobile.jpg)
- Map: [Desktop](shots/auth__game-detail__map__desktop.jpg) · [Tablet](shots/auth__game-detail__map__tablet.jpg) · [Mobile](shots/auth__game-detail__map__mobile.jpg)
- Settings: [Desktop](shots/auth__game-detail__settings__desktop.jpg) · [Tablet](shots/auth__game-detail__settings__tablet.jpg) · [Mobile](shots/auth__game-detail__settings__mobile.jpg)

**Tournaments** — `/tournaments`

- Tournaments: [Desktop](shots/auth__tournaments__desktop.jpg) · [Tablet](shots/auth__tournaments__tablet.jpg) · [Mobile](shots/auth__tournaments__mobile.jpg)

**Tournament detail** — `/tournaments/test-03`

- Tournament: test-03: [Desktop](shots/auth__tournament-detail__desktop.jpg) · [Tablet](shots/auth__tournament-detail__tablet.jpg) · [Mobile](shots/auth__tournament-detail__mobile.jpg)

**Admin · reparse** — `/admin/reparse`

- Admin · reparse: [Desktop](shots/auth__admin-reparse__desktop.jpg) · [Tablet](shots/auth__admin-reparse__tablet.jpg) · [Mobile](shots/auth__admin-reparse__mobile.jpg)

**Redirect routes** — `(verification)`

- Redirect routes — verification only:
  - `/dashboard → /users/xuWIHsyF2uC7ybDPjqd1G  (→ /users/[id] (signed in) · /?next= (anon))`
  - `/games → /users/xuWIHsyF2uC7ybDPjqd1G  (→ /dashboard → profile)`
  - `/auth/callback → /auth/callback  (OAuth landing (not renderable))`
