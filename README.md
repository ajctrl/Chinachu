Chinachu
========

Requirements
------------

- Linux
- Node.js 24.x
- The npm version bundled with Node.js 24
- FFmpeg (including ffprobe)
- Mirakurun 4.1.3
- Socket.IO 4.8.3 clients (Engine.IO protocol 4)

Install Node.js, npm, FFmpeg, and ffprobe system-wide and ensure they are
available in `PATH`, then install dependencies with `npm ci`. Chinachu does not
install private copies of these tools. Both TCP and Unix socket connections to
Mirakurun are supported. Socket.IO 2.x clients are not supported.

