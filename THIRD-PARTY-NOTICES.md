# Third-party notices

Baize is released under the MIT License (`LICENSE`). Its packages `physics`, `tables`,
`vision` and `planner` have no third-party runtime dependencies (they depend only on each
other: `vision` and `planner` on `physics` and `tables`). The web app (`apps/web`) includes:

| Software         | Version                     | Licence | Source                                   | Used for                                  |
| ---------------- | --------------------------- | ------- | ---------------------------------------- | ----------------------------------------- |
| React, React DOM | see `apps/web/package.json` | MIT     | npm                                      | the editor                                |
| Zustand          | see `apps/web/package.json` | MIT     | npm                                      | the editor's store                        |
| Mediabunny       | 1.65.2 (pinned)             | MPL-2.0 | <https://github.com/Vanilagy/mediabunny> | reading and writing video files (Phase 7) |

## Mediabunny (MPL-2.0)

Copyright (c) 2026-present, Vanilagy and contributors. Licensed under the Mozilla Public License,
version 2.0. Baize uses it **unmodified**. The MPL's conditions that apply here:

- Its licence and copyright headers stay in its files (the production build keeps `/*!`
  comments; `apps/web/scripts/check-build.mjs` checks every build in CI).
- Recipients of the built site are told where its source is: the site serves
  `third-party-notices.txt` (from `apps/web/public/`) with this notice and the full licence
  text, linked from the editor.
- Changes to Mediabunny's own files would have to be published under the MPL. Baize makes none;
  it is reached only through `apps/web/src/video/media.ts` (enforced by lint), so it can be
  replaced by anything that provides that interface.
