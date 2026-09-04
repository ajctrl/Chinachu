Chinachu [![Test](https://github.com/Chinachu/Chinachu/actions/workflows/test.yml/badge.svg)](https://github.com/Chinachu/Chinachu/actions/workflows/test.yml) [![tip for next commit](http://tip4commit.com/projects/689.svg)](http://tip4commit.com/projects/689)
========

Requirements
------------

- Linux
- Node.js 24.x (CI uses 24.18.0)
- The npm version bundled with Node.js 24
- FFmpeg (including ffprobe)
- Mirakurun 4.1.3
- Socket.IO 4.8.3 clients (Engine.IO protocol 4)

Install Node.js, npm, FFmpeg, and ffprobe system-wide and ensure they are
available in `PATH`, then install dependencies with `npm ci`. Chinachu does not
install private copies of these tools. Both TCP and Unix socket connections to
Mirakurun are supported. Socket.IO 2.x clients are not supported.

Stay in touch on Discord Community: <https://discord.gg/X7KU5W9>

<https://chinachu.moe/>
