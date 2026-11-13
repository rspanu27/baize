# @baize/vision

Turns one photo of a table into a `Layout` of balls, entirely in the browser.

Rules of this package (enforced by lint, see `test/lint-guard.test.ts`):

- A photo is pixels in memory, passed in by the caller. Nothing here reads files, talks to the
  network, or stores anything: no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no storage.
- The only package it may import is `@baize/tables`.

Units: image points are pixels, `u` to the right and `v` down from the top-left corner of the
photo. Table points are metres in the table's own coordinates (see `@baize/tables`): origin at
the baulk/head-end left corner of the playing area, `x` across, `y` along, `z` up from the cloth.
