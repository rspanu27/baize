# Table preset research

Status: research only, nothing here is wired into `packages/tables`. Written 2026-11-11.

**Correction to the task board:** the preset count is **11, not 13**. Snooker 9 ft and snooker 8 ft are not wanted. The list is: snooker 12/10/6 ft; pool 9, 8, 8 pro/oversize, 7 (bar box), 7 Valley; UK blackball 7 and 6 ft; Chinese 8-ball 9 ft.

> **Update 2026-11-12.** Two things changed after this research was written. (1) `mouthM` is defined as the opening where the jaw facings begin (the published "at the fall" opening for rounded jaws), not the jaw-point width, so the `opening + 2 r sin(phi)` formula below is no longer used: presets encode the published opening directly. (2) The project owner supplied the blackball playing areas: 7 ft 1.83 x 0.91 m, 6 ft 1.68 x 0.84 m. The encoded values and their comments in `packages/tables/src/presets/tables.ts` are authoritative.

## What is verified and what is not

Verified from a primary source (an official rulebook or specification text I opened):

- Snooker 12 ft playing area, ball diameter and ball mass tolerance (WPBSA rules, May 2022).
- WPA pool: 9 ft and 8 ft (92x46) playing areas, ball diameter and mass, corner and side mouth ranges, cut angles 142 and 104 degrees, nose height 63.5 % of ball diameter, shelf depths. I read these on poolroom.com, which republishes the WPA tournament specification; I did not find the WPA's own PDF, so treat this as "primary, republished".
- Chinese 8-ball / Heyball playing area, ball diameter and mass (rules texts).

Everything else is manufacturer data, retailer data, forum statements, or my own inference, and is labelled as such. **No table preset in this file has a published jaw radius, a drop (slate cut) radius or setback, or a published cushion restitution/friction.** Those fields are assumed throughout and are listed in Open questions.

Important plain statements:

- **Snooker pocket openings are defined by templates, not published numbers.** The WPBSA rulebook (May 2022, Section 1, 1(g)) only says there is a pocket at each corner and one in the middle of each long side. Older rules (B.A. & C.C.) said openings "conform to the templates" authorised by the governing body (snookerheritage.co.uk article, search-seen wording). The templates are proprietary. All snooker mouth figures below are approximations from secondary sources.
- The "playing area" of smaller tables is not standardised. Manufacturers quote bed size (slate) or nominal feet, and different sites disagree.

Conversion notes: 1 in = 25.4 mm. Ball sizes: 2 1/16 in = 52.39 mm (snooker uses 52.5 mm per WPBSA), 2 in = 50.8 mm, 1 7/8 in = 47.63 mm, 2 1/4 in = 57.15 mm.

### How `mouthM` is to be derived from published "opening" figures

Published snooker/blackball openings are usually measured "at the fall" or at the cushion top, between the jaw knuckles, which is narrower than `mouthM` (where the straight nose ends and the curve starts). If the jaw turns through angle phi = 180 deg - facingAngle with knuckle radius r, the straight nose ends about `r * sin(phi)` further out on each side, so:

`mouthM ~ published_opening + 2 * jawRadius * sin(phi)`   (my geometric inference, not from any source)

Because jaw radii are unsourced, the rounded-jaw mouths below are **assumed starting values** and should be tuned against reference photos/templates. For pool, jaw points are near-sharp so published mouths map directly to `mouthM`.

### Cushion physics (cited once, applies to all presets)

I did not open any source with published ball-cushion restitution or friction values. Assumed for all presets until sourced: restitution 0.85, friction 0.2 (common modelling values; **assumed**, low confidence). Nose height uses the WPA rule (63.5 % of ball diameter) for pool; for snooker/blackball/Chinese 8-ball no figure was found, so 63.5 % of the ball diameter is **assumed**.

For comparison only: the pooltool library defaults for a 7 ft "Showood" pocket table (software defaults, not a standard; https://pooltool.readthedocs.io/en/stable/resources/table_specs.html): playing 1.9812 x 0.9906 m, cushion height 0.036576 m, corner mouth 0.118 m, side mouth 0.137 m, corner pocket radius 0.062 m with depth 0.0417 m, side pocket radius 0.0645 m with depth 0.0685 m, corner jaw radius 0.02095 m, side jaw radius 0.00795 m. These use pooltool's own geometry definitions and may not map onto our fields; useful as a sanity check on magnitude only.

---

## 1. Snooker 12 ft (WPBSA full size)

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 3.569 x 1.778 m (11 ft 8.5 in x 5 ft 10 in), tolerance +/-13 mm | https://wpbsa.com/wp-content/uploads/Rulebook-Website-Updated-May-2022.pdf (Sec. 1, 1(a)) | Verified, primary |
| Ball diameter | 0.0525 m, +/-0.05 mm; set weight spread max 3 g | same, Sec. 1, 2(b),(c) | Verified, primary |
| Ball mass | not in rules; typical ~0.1425 kg (assumed, not sourced) | n/a | Assumed |
| Corner opening (published approx.) | ~0.089 m (3.5 in); Wikipedia text quotes ~86 mm | https://forums.azbilliards.com/threads/what-size-are-the-pockets-and-balls-on.268994/ (forum, quoting Wikipedia and posters); https://aplussnooker.com/standard-snooker-table-sizes-and-dimensions-explained/ ("about 89 mm") | Approximation |
| Middle opening (published approx.) | ~0.102 m (4 in) per forum, "at the top of the cushion" | forum thread found via search (forums.azbilliards.com rules-of-snooker thread, search result only) | Approximation, weak |
| Conflict | aplussnooker.com says middle ~83 mm, narrower than corner. This contradicts every other source and general knowledge that middles are wider; I reject it. | aplussnooker URL above | Rejected |
| `mouthM` corner / middle | ~0.105 m / ~0.115 m (assumed: opening + 2 r sin phi, with r_corner 20 mm, phi 38 deg; r_middle 15 mm, phi 76 deg) | derived | Assumed |
| `jawRadiusM` | corner 0.020, middle 0.015 | none | Assumed |
| `facingAngleRad` | corner ~142 deg (2.478), middle ~104 deg (1.815): WPA pool values reused | WPA values, see pool | Assumed for snooker |
| Drop circle | radius ~0.045 m, setback ~0.03 m corner; ~0.040 / 0.02 middle | none | Assumed |
| Nose height | 0.033 m (63.5 % of 52.5 mm) | WPA rule applied to snooker | Assumed |
| Table height (floor to cushion top) | 0.864 m +/-13 mm (not needed by physics) | WPBSA rules, 1(b) | Verified |
| Restitution / friction | 0.85 / 0.2 | see cushion note | Assumed |

## 2. Snooker 10 ft

No governing-body spec exists. Sources for the playing area:

- Search-result wording gave "9 ft 8 in x 4 ft 10 in" for a 10 ft table = 2.946 x 1.473 m. Aplussnooker lists 2946 x 1473 mm (labelled approximate): https://aplussnooker.com/standard-snooker-table-sizes-and-dimensions-explained/. A retailer listing (Liberty Games, seen in search results only; the page itself returned 403 to me) gave 294 x 147 cm.
- Disagreeing: snookersite.com lists ~3050 x 1525 mm (https://www.snookersite.com/guides/snooker-table-sizes), which is nominal 10 x 5 ft bed size, not the cushion-to-cushion area. Hamilton lists the Riley 10 ft as "10' x 5' (305cm x 152cm)" (https://www.hamiltonbilliards.com/m387-10ft-riley-billiard-snooker-table.html), also bed/nominal.
- My cross-check: the 12 ft bed is 12 ft x 6 ft 1.5 in and the playing area is 89 mm smaller in each direction; applying 89 mm to a 305 x 156 cm bed gives ~2.96 x 1.47 m, matching 2.946 x 1.473 within 15 mm.

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 2.946 x 1.473 m (9 ft 8 in x 4 ft 10 in) | aplussnooker + retailer listing + my cross-check; chosen as the value two or three independent places agree on | Manufacturer/retailer data, approximate |
| Ball diameter | 0.0525 m typical (2 1/16 in); 2 in (0.0508 m) also sold | https://bestsnookercue.com/blogs/news/snooker-table-sizes-explained-12ft-10ft-6ft | Retailer data |
| Pockets | no source; assume the same as 12 ft (same ball) | n/a | Assumed |
| Cushion | as 12 ft | n/a | Assumed |

## 3. Snooker 6 ft

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 1.740 x 0.864 m | my inference: 6 ft x 3 ft 1.5 in bed (snookerheritage.co.uk metrication article gives the 1970 B.A. & C.C. 6 ft bed as 6 ft x 3 ft 1.5 in) minus 89 mm per axis as on a 12 ft table | Inference |
| Competing figures | 1.829 x 0.914 m (aplussnooker, nominal 6 x 3 ft, not a playing area); 1.78 x 0.89 m is also quoted around but I found no source; a retailer's folding 6 ft model "173 cm x 82 cm" (search result only) | URLs above | Nominal/retail |
| Why | 1.740 x 0.864 sits between the retail 173 x 82 and the nominal 183 x 91.4 and has a derivation | | |
| Ball diameter | 0.0508 m (2 in) or 0.0476 m (1 7/8 in) common on small tables; 0.0525 m on some. Recommend default 0.0508 | bestsnookercue.com above ("2in or 1 7/8in") | Retailer data |
| Pockets | no source. Assumed corner opening ~0.075 m, middle ~0.085 m, scaled to the smaller ball | n/a | Assumed |

## 4. Pool 9 ft (100 x 50 in)

Source for all WPA numbers: https://www.poolroom.com/tournament-table-equipment-specifications/ (republishes the WPA tournament specification).

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 2.540 x 1.270 m (100 x 50 in, +1/8 in) | poolroom.com WPA spec | Verified (republished primary) |
| Ball diameter / mass | 0.05715 m (+0.127 mm); 0.156-0.170 kg, use 0.163 | same | Verified |
| Corner mouth | 4.5-4.625 in = 0.1143-0.1175 m; use 0.1159 (midpoint) | same | Verified range |
| Side mouth | 5-5.125 in = 0.1270-0.1302 m; use 0.1286 | same | Verified range |
| Facing angle | corner 142 deg (2.478 rad), side 104 deg (1.815 rad), +1 deg | same ("cut angles ... both sides of each pocket"). Matches the WPA values you quoted | Verified |
| Jaw radius | ~0.002 (near-sharp points) | none | Assumed |
| Shelf depth | corner 1-2.25 in (25-57 mm), side 0-0.375 in (0-10 mm) | same | Verified range; relation to drop circle is my inference |
| Drop circle | corner radius ~0.055, setback ~0.03; side radius ~0.060, setback ~0.01 | loosely guided by shelf depths and pooltool magnitudes | Assumed |
| Nose height | 63.5 % (62.5-64.5 %) of ball diameter = 0.0363 m | same | Verified |

## 5. Pool 8 ft (88 x 44 in)

I found **no source** for an 88 x 44 in playing area. The WPA spec lists 8 ft as 92 x 46 (see next). 88 x 44 is a common home-table nominal (Brunswick/Olhausen style) but I could not confirm it from any opened page. 88 x 44 in = 2.2352 x 1.1176 m.

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 2.2352 x 1.1176 m | owner-supplied figure, no source found | Unverified |
| Ball | 0.05715 m | WPA | Verified for WPA ball |
| Pockets, angles, nose | as 9 ft (WPA ranges); home 8 ft tables are often looser, unknown | poolroom.com | Assumed to match |

## 6. Pool 8 ft pro / oversize (92 x 46 in)

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 2.3368 x 1.1684 m (92 x 46 in, +1/8 in) | poolroom.com WPA spec lists this as the 8 ft tournament size | Verified (republished primary) |
| Everything else | as Pool 9 ft | same page | Verified (spec is common) |

## 7. Pool 7 ft (78 x 39 in, Diamond-style bar box)

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 1.9812 x 0.9906 m (78 x 39 in) | owner-supplied; **not confirmed**. Diamond's pages I opened give an overall 94 x 54 in for the 7 ft Pro and leave playing area blank | Unverified |
| Generic 7 ft | 76 x 38 in = 1.9304 x 0.9652 m is the more commonly quoted figure (Wikipedia, tagged "citation needed"; https://en.wikipedia.org/wiki/Billiard_table). A retailer lists "regulation" 74 x 38 in | | Weak |
| Ball | 0.05715 m (bar tables: 2.25 in standard; coin tables may use a bigger cue ball, ignored) | WPA / general | Approximation |
| Pockets | bar boxes have larger pockets and sharper side-pocket entry than regulation tables (forum / university page, no numbers). Assume corner mouth 0.118 m, side 0.131 m, jaw angles as WPA | none for numbers | Assumed |
| Cushion | nose 63.5 % of ball | WPA rule | Assumed |

## 8. Pool 7 ft Valley (74 x 37 in)

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 1.8796 x 0.9398 m (74 x 37 in) | owner-supplied; I found **no** Valley page with this. Valley Pro Cat sheet and forum thread I opened gave no playing area | Unverified |
| Ball | 0.05715 m | general | Approximation |
| Pockets | forum comment that Valley bar boxes have larger pockets than 9 ft tables (anecdote). Assume corner 0.120, side 0.133 | none | Assumed |

## 9. UK blackball 7 ft

The WPA Blackball rules text I opened (https://www.blackballaus.com.au/_files/ugd/f24879_97828fa9f54a431f894c479c505c5eb5.pdf) contains no table dimensions. The EPA rules page (https://epa.org.uk/rules/pics.php) has only rack line sizes.

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 1.930 x 0.965 m (76 x 38 in) | **assumed**: no UK-pool playing-area source found. Wikipedia says UK tables are nominally 7 x 3.5 ft (https://en.wikipedia.org/wiki/Blackball_(pool)); a cloth guide lists 7 ft cloth 78 x 44 in (premiumcues.co.uk), which is cloth, not playing area | Assumed |
| Ball diameter | object 0.0508 m (2 in) or 0.0524 m (2 1/16 in); cue 0.0476 m (1 7/8 in) with 2 in set (often) | https://en.wikipedia.org/wiki/Blackball_(pool); Riley FAQ says 7 ft English pool uses 2 in (51 mm) balls | Secondary, consistent |
| Pocket opening | WEPF rule: ball diameter x 1.6, so 0.081 m for 2 in, 0.084 m for 2 1/16 in (Wikipedia citing WEPF 2004; forum calc ~3.2 in) | https://en.wikipedia.org/wiki/Billiard_table | Secondary; inference from rule |
| Jaw shape | rounded, snooker-like ("just larger than the balls") | Wikipedia Blackball | Qualitative |
| `mouthM` / `jawRadiusM` / angles | corner ~0.097 / 0.020 radius / 142 deg; middle ~0.100 / 0.015 / 104 deg (opening + 2 r sin phi, see formula) | derived | Assumed |
| Cushion | nose 63.5 % ball diameter (0.032 m) | assumed | Assumed |

## 10. UK blackball 6 ft

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 1.654 x 0.827 m (7 ft area scaled by 6/7 and rounded) | **assumed**; Wikipedia lists 6 x 3 ft tables, cloth guide lists 6 ft cloth 67 x 37 in | Assumed |
| Ball | as 7 ft: 0.0508 m object, 0.0476 m cue | as above | Secondary |
| Pockets | WEPF ratio 1.6 x ball again; same mouth model as 7 ft | | Assumed |

## 11. Chinese 8-ball 9 ft

| Field | Recommended | Source | Confidence |
|---|---|---|---|
| Playing area | 2.540 x 1.270 m (+/-9 mm) | World Chinese 8-ball Masters rules 2017 text, Sec. 3: "2540 x 1270mm(+/-9mm)" (via https://forums.azbilliards.com/threads/%EF%BC%882%EF%BC%89world-chinese-8-ball-masters-rules-standard-rules-for-the-chinese-eight-ball-game.454319); Joy listing agrees (100 x 50 in): https://www.cuesportsyorkshire.co.uk/product-page/heyball-table | Primary rules text (forum copy) plus manufacturer |
| Conflict | WPA Heyball rules 2025 give 2,540 x 1,260 mm +/-9 mm (https://www.hkbilliardsports.org.hk/wp-content/uploads/2025/08/2025.07.19-Rules-of-Heyball.pdf). Recommend 1.270 (matches Chinese 8-ball Masters rules and the Joy listing; 10 mm is within the +/-9 mm tolerance band edge anyway). Offer 1.260 as note | | |
| Ball | 0.05715 m (+/-0.05 mm), 156-170 g (same two rules texts) | same | Verified |
| Pocket opening | Joy Q7/Q8 listing: "3.34-inch wide opening" = 0.0848 m, corner/middle not stated; forum posts say about 3.5 in "like regulation snooker", secondhand | cuesportsyorkshire.co.uk above; https://forums.azbilliards.com/goto/post?id=5834733 | Manufacturer, ambiguous |
| Jaw shape | rounded, snooker-style, flat-faced steel/rubber cushions ("I"-style steel cushion on Joy) | Joy listing; Wikipedia Chinese eight-ball | Qualitative |
| `mouthM` / jaw / angles | corner ~0.104 / r 0.020 / 142 deg; middle ~0.108 / r 0.015 / 104 deg (opening 0.0848 + 2 r sin phi) | derived | Assumed |
| Cushion | table height 800-850 mm floor to cushion top (not needed); nose 63.5 % of ball (0.036 m) | rules; assumed | Assumed |

---

## Summary: playing areas and ball diameters

| # | Preset | Playing area (m) | Ball diameter (m) | Basis |
|---|---|---|---|---|
| 1 | Snooker 12 ft | 3.569 x 1.778 | 0.0525 | Verified |
| 2 | Snooker 10 ft | 2.946 x 1.473 | 0.0525 (2 in option) | Approximate |
| 3 | Snooker 6 ft | 1.740 x 0.864 | 0.0508 (0.0476 / 0.0525 options) | Inference |
| 4 | Pool 9 ft | 2.540 x 1.270 | 0.05715 | Verified |
| 5 | Pool 8 ft (88 x 44) | 2.2352 x 1.1176 | 0.05715 | Playing area unverified |
| 6 | Pool 8 ft pro (92 x 46) | 2.3368 x 1.1684 | 0.05715 | Verified |
| 7 | Pool 7 ft bar box (78 x 39) | 1.9812 x 0.9906 | 0.05715 | Unverified |
| 8 | Pool 7 ft Valley (74 x 37) | 1.8796 x 0.9398 | 0.05715 | Unverified |
| 9 | Blackball 7 ft | 1.930 x 0.965 | 0.0508 obj / 0.0476 cue (or 0.0524) | Assumed |
| 10 | Blackball 6 ft | 1.654 x 0.827 | same as 9 | Assumed |
| 11 | Chinese 8-ball 9 ft | 2.540 x 1.270 | 0.05715 | Rules text |

## Open questions

1. Snooker pocket geometry for all three snooker tables: no published openings (templates are proprietary). Mouths, jaw radii, facing angles, drop circles are all assumed. Needs template drawings or measurements from a real table.
2. Which opening figure the snooker "3.5 in / 4 in" and "86 mm" refer to (fall vs cushion top vs straight-nose end). I assumed "at the fall" and added `2 r sin(phi)`.
3. Snooker, blackball and Chinese 8-ball cushion nose height: none found; assumed 63.5 % of ball diameter.
4. Cushion restitution and friction for every preset: none sourced; assumed 0.85 / 0.2. A published measurement paper should replace these.
5. Snooker 10 ft and 6 ft playing areas: no manufacturer spec opened (Riley, BCE and others returned no usable page; several sites returned 403). Values are retailer figures and an inference.
6. Pool 8 ft 88 x 44 in, 7 ft 78 x 39 in (Diamond-style) and 74 x 37 in (Valley): owner-supplied sizes I could not confirm; Diamond/Valley pages gave no playing area. The WPA-published 8 ft is 92 x 46. Please confirm with a spec sheet.
7. Bar-box pocket mouths (presets 7, 8): only anecdotes that they are larger; mouths assumed.
8. UK blackball 7 ft and 6 ft playing areas: no source; assumed. Mouth only via WEPF 1.6 x ball ratio (secondary).
9. Chinese 8-ball pocket openings: Joy quotes 3.34 in without saying corner or middle; the playing-area width is 1270 mm in the 2017 rules but 1260 mm in the 2025 Heyball rules.
10. Pool drop circle and setback: shelf depths are published but how they map to a single drop circle is my inference.
11. Ball masses for snooker, blackball (not sourced); snooker ~0.1425 kg assumed.
12. The WPA specification itself (not the poolroom.com copy) and the 2017 Chinese 8-ball rules PDF (I read a forum copy) should be checked directly.

## Overall confidence

High for 12 ft snooker area/ball and for the pool 9 ft / 8 ft pro WPA numbers and Chinese 8-ball 9 ft area/ball. Medium for 10 ft snooker area. Low for 6 ft snooker, both blackball tables, bar-box sizes and every pocket drop/jaw/restitution/friction number.
