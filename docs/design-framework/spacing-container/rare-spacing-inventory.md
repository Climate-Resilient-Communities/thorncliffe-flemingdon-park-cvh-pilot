# Rare spacing inventory

Every spacing value in the approved prototype that is not on the common app scale (2, 4, 6, 8, 10, 12, 14, 16, 20 and 24 px), where it is used, and what happens to it. This records decision G1 of 2026-10-02 (`token-architecture.md` section 11): a rare value is kept only where a pilot component uses it, with a semantic name; prototype presentation and slide spacing are not generated for the app.

**Method.** Every `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` and `--gap` declaration with a pixel value was read from `design/prototype/cvh/cvh.css` (comments removed) and from the inline styles of the pilot screens' `*.dc.html` files. Pilot screens are the prototype screens in the pilot plan, excluding the MVP screens listed in `docs/planning/pilot/epics.md` and the boards (`Main`, `Notes`, `Walkthrough_*`, `Lib_*`). A stylesheet rule counts as used by a screen when every class in its selector appears in that screen's file; state classes (`cvh-hub--narrow`, `cvh-basic`, `is-*`) and the shared `cvh-ico` are ignored for that test. Border widths are not spacing and are not listed.

## Kept as app tokens

| Value | Token in `tokens.json` | Semantic token | Job |
| --- | --- | --- | --- |
| 1 px | `app-space-1px` | `--offset-align-hairline` | Aligns a check box or small icon with the first text line |
| 3 px | `app-space-3px` | `--offset-align-icon` | Aligns an icon with the first line of body text |
| 7 px | `app-space-7px` | `--inset-count-badge-inline` | Inline padding of the Hub side navigation count badge |
| 18 px | `app-space-18px` | `--inset-button-large-inline`, `--gap-meta-inline`, `--gap-section-hub-review`, `--gap-type-grid-inline` | Large resident buttons, list-row metadata, Hub review page sections, disruption type grid |
| 22 px | `app-space-22px` | `--gap-section-hub-main` | Main-column sections on Hub home, audience and update pages |
| 28 px | `app-space-28px` | `--gap-columns-hub` | Main column to 380 px aside on two-column Hub pages |

1 px is real spacing in these places (optical alignment), not only a border width. The MVP badge paddings of 1 px below are spacing too and are decided with those screens.

## Every occurrence

| Value | Where | Property | Selector | Pilot screens using it | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 px | `cvh.css:488` | `margin-top` | `.cvh-option__box` | A-02, A-04, O-02, O-03, O-04, O-05, O-07, O-11, O-15, O-18, R-05, R-26, R-33, R-35 | Kept: `app-space-1px` → `--offset-align-hairline` |
| 1 px | `cvh.css:659` | `margin-top` | `.cvh-ambbar__line .cvh-ico` | A-02 | Kept: `app-space-1px` → `--offset-align-hairline` |
| 1 px | `cvh.css:722` | `margin-top` | `.cvh-ci__state .cvh-ico` | A-04 | Kept: `app-space-1px` → `--offset-align-hairline` |
| 1 px | `cvh.css:1096` | `padding` | `.cvh-mq-flag` | — | Not generated: MVP screen (O-08); decide when that screen is built |
| 1 px | `cvh.css:1155` | `padding` | `.cvh-md-lang` | — | Not generated: MVP screen (O-10); decide when that screen is built |
| 1 px | `cvh.css:1538` | `margin-top` | `.cvh-rd-check__box` | — | Not generated: MVP screen (P-12, P-14); decide when that screen is built |
| 3 px | `cvh.css:171` | `padding` | `.cvh-proto` | C_ProtoBar (prototype only) | Not generated: prototype presentation (prototype bar) |
| 3 px | `cvh.css:270` | `padding` | `.cvh-stmt` | — | Not generated: MVP screen (X-06, P-05); decide when that screen is built |
| 3 px | `cvh.css:313` | `margin-top` | `.cvh-tailored__item .cvh-ico` | R-03, R-25, X-12 | Kept: `app-space-3px` → `--offset-align-icon` |
| 3 px | `cvh.css:1220` | `padding` | `.cvh-pc-kind` | — | Not generated: MVP screen (P-04); decide when that screen is built |
| 3 px | `cvh.css:1740` | `margin-top` | `.cvh-find-reason .cvh-ico` | R-10 | Kept: `app-space-3px` → `--offset-align-icon` |
| 3 px | `R14_MapView.dc.html:118` | `margin-top` | `inline style` | R-14 | Kept: `app-space-3px` → `--offset-align-icon` |
| 3 px | `R15_MapList.dc.html:84` | `margin-top` | `inline style` | R-15 | Kept: `app-space-3px` → `--offset-align-icon` |
| 3 px | `R16_MapPreview.dc.html:118` | `margin-top` | `inline style` | R-16 | Kept: `app-space-3px` → `--offset-align-icon` |
| 3 px | `R35_WhereILive.dc.html:53` | `margin-top` | `inline style` | R-35 | Kept: `app-space-3px` → `--offset-align-icon` |
| 5 px | `cvh.css:174` | `gap` | `.cvh-proto__word` | C_ProtoBar (prototype only) | Not generated: prototype presentation (prototype bar) |
| 7 px | `cvh.css:396` | `padding` | `.cvh-side__count` | C_HubSide | Kept: `app-space-7px` → `--inset-count-badge-inline` |
| 7 px | `cvh.css:1324` | `padding` | `.cvh-ps-link__n` | — | Not generated: MVP screen (P-02); decide when that screen is built |
| 18 px | `cvh.css:153` | `padding` | `.cvh-dest` | R-03, R-07, R-11, R-12, R-14, R-16, R-24, R-25 | Kept: `app-space-18px` → `--inset-button-large-inline` |
| 18 px | `cvh.css:435` | `padding` | `.cvh-topbtn` | R-03 | Kept: `app-space-18px` → `--inset-button-large-inline` |
| 18 px | `cvh.css:501` | `padding` | `.cvh-device` | R-04, R-06, R-30 | Not generated: prototype presentation (phone frame drawn around the message) |
| 18 px | `cvh.css:799` | `padding` | `.cvh-lock` | R-04 | Not generated: prototype presentation (lock screen drawn in a phone frame) |
| 18 px | `cvh.css:844` | `gap` | `.cvh-hrow__meta` | O-01 | Kept: `app-space-18px` → `--gap-meta-inline` |
| 18 px | `cvh.css:1111` | `padding` | `.cvh-mq-batch` | — | Not generated: MVP screen (O-08); decide when that screen is built |
| 18 px | `cvh.css:1168` | `gap` | `.cvh-pc-links` | — | Not generated: MVP screen (P-04, P-05, P-07, P-08, P-09); decide when that screen is built |
| 18 px | `cvh.css:1171` | `padding` | `.cvh-pc-head` | — | Not generated: MVP screen (P-04); decide when that screen is built |
| 18 px | `cvh.css:1252` | `padding` | `.cvh-pc-spacecard` | — | Not generated: MVP screen (P-07); decide when that screen is built |
| 18 px | `cvh.css:1298` | `gap` | `.cvh-ps` | — | Not generated: MVP screen (P-01, P-02, P-03, P-06, P-10); decide when that screen is built |
| 18 px | `cvh.css:1448` | `padding` | `.cvh-ps-mail__body` | — | Not generated: MVP screen (P-06); decide when that screen is built |
| 18 px | `cvh.css:1480` | `gap` | `.cvh-rd-meta` | — | Not generated: MVP screen (P-11); decide when that screen is built |
| 18 px | `cvh.css:1582` | `padding-inline-start` | `.cvh-devnote ul` | R-30 | Not generated: prototype presentation (developer note under a screen) |
| 18 px | `O07_AmbReview.dc.html:72` | `--gap` | `inline style` | O-07 | Kept: `app-space-18px` → `--gap-section-hub-review` |
| 18 px | `O12_AckComposer.dc.html:90` | `--gap` | `inline style` | O-12 | Kept: `app-space-18px` → `--gap-section-hub-review` |
| 18 px | `X13_DisruptionType.dc.html:39` | `gap` | `inline style` | X-13 | Kept: `app-space-18px` → `--gap-type-grid-inline` |
| 22 px | `cvh.css:274` | `padding-inline-end` | `.cvh-stmt--need` | — | Not generated: MVP screen (X-06); decide when that screen is built |
| 22 px | `cvh.css:276` | `padding-inline-start` | `[dir="rtl"] .cvh-stmt--need` | — | Not generated: MVP screen (X-06); decide when that screen is built |
| 22 px | `cvh.css:1067` | `margin` | `.cvh-mq-meter` | — | Not generated: MVP screen (O-08); decide when that screen is built |
| 22 px | `cvh.css:1453` | `padding-inline-start` | `.cvh-ps-order` | — | Not generated: MVP screen (P-06); decide when that screen is built |
| 22 px | `cvh.css:1639` | `padding-inline-start` | `.cvh-rv-rules` | — | Not generated: MVP screen (P-15); decide when that screen is built |
| 22 px | `O01_OperatorHome.dc.html:83` | `--gap` | `inline style` | O-01 | Kept: `app-space-22px` → `--gap-section-hub-main` |
| 22 px | `O03_AudiencePlace.dc.html:59` | `--gap` | `inline style` | O-03 | Kept: `app-space-22px` → `--gap-section-hub-main` |
| 22 px | `O04_AudienceGroup.dc.html:59` | `--gap` | `inline style` | O-04 | Kept: `app-space-22px` → `--gap-section-hub-main` |
| 22 px | `O14_Update.dc.html:84` | `--gap` | `inline style` | O-14 | Kept: `app-space-22px` → `--gap-section-hub-main` |
| 22 px | `O15_Correct.dc.html:70` | `--gap` | `inline style` | O-15 | Kept: `app-space-22px` → `--gap-section-hub-main` |
| 28 px | `cvh.css:799` | `padding` | `.cvh-lock` | R-04 | Not generated: prototype presentation (lock screen drawn in a phone frame) |
| 28 px | `cvh.css:919` | `gap` | `.cvh-ha-cols` | O-02, O-03, O-04, O-05, O-07, O-13 | Kept: `app-space-28px` → `--gap-columns-hub` |
| 28 px | `cvh.css:1434` | `gap` | `.cvh-ps-frames` | — | Not generated: MVP screen (P-06); decide when that screen is built |
| 32 px | `cvh.css:410` | `gap` | `.cvh-sheetpage` | — | Not generated: prototype board (component library artboard) |
| 40 px | `cvh.css:410` | `padding` | `.cvh-sheetpage` | — | Not generated: prototype board (component library artboard) |
| 48 px | `cvh.css:410` | `padding` | `.cvh-sheetpage` | — | Not generated: prototype board (component library artboard) |
| 120 px | `cvh.css:1207` | `margin-top` | `.cvh-hub--narrow .cvh-pc-grp` | — | Not generated: MVP screen (P-04); decide when that screen is built |

Values found only in prototype presentation, boards or MVP screens (5, 32, 40, 48 and 120 px, and the MVP uses of 1, 3, 7, 18, 22 and 28 px) are not generated. An MVP screen that needs one adds it to `tokens.json` with its location when that screen is built.
