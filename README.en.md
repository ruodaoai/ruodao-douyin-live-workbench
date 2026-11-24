# Douyin Live Interaction Workbench

A livestream interaction workbench for Douyin Live Companion. Four real-time audience games ship built in, rendered on a three.js 3D stage, plus an operator console for captions, voice announcements, canned replies and music.

## Built-in games

- **Humans vs Zombies** - spawn, upgrade and defend against waves.
- **Hometown Vote** - audience votes for regions in real time.
- **Three Kingdoms Ambition** - pick a faction, grow an army, capture territory.
- **Running Sheep** - a race the audience pushes forward.

## Overlay stage

- 1080x1920 transparent vertical overlay, ready to paste into Live Companion as a browser source.
- Generative 9:16 key art, commander portraits, particles, base lighting and cinematic camera moves.
- Node-authoritative simulation at 20 Hz so every viewer sees the same state.

## Operator console

- One-click captions on screen, voice announcements, canned scripts.
- Keyword auto-reply and a timeline that schedules interactions.
- Background music search and playback, routed either to the overlay or to the local machine.
- meshy GLB commander import.

## Requirements

- Ruodao desktop host; Douyin Live Companion for the browser-source overlay.
- A modern GPU for the three.js stage.

## Permissions and privacy

- `process`, `network`, `clipboard`, local storage.
- Stream data and overlay assets stay local; nothing is uploaded to Ruodao.

## Links

- Marketplace: https://ruodao.com/plugin-market

## License

MIT
