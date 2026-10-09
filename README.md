Chinachu
========

Requirements
------------

- Linux with `/proc/self/fd` available for recording file access
- Node.js 24.x
- The npm version bundled with Node.js 24
- FFmpeg (including ffprobe)
- Mirakurun 4.x (bundled npm client: 4.1.5)
- Socket.IO 4.8.4 clients (Engine.IO protocol 4)

Install Node.js, npm, FFmpeg, and ffprobe system-wide and ensure they are
available in `PATH`, then install dependencies with `npm ci`. Chinachu does not
install private copies of these tools. Both TCP and Unix socket connections to
Mirakurun are supported. Socket.IO 2.x clients are not supported.


Reservation keywords and automatic exclusion: [configuration and behavior](docs/auto-exclusion.md).

Browser UI architecture, vendored assets and checks: [documentation](docs/browser-ui.md).

Node dependency versions, native replacements and checks: [documentation](docs/npm-dependencies.md).

Web UI access through a reverse proxy, migration and API requirements: [documentation](docs/reverse-proxy.md).
