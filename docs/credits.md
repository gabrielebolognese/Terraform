# Credits and licences

What the game is made of that someone else made, and under what terms; and what the game makes
itself. Every asset added to the game is listed here with its licence (Batch 35's exit gate).

## Made by others

| Asset | Where it is used | Author | Licence | Source |
|---|---|---|---|---|
| Lexend (typeface) | All the game's text | The Lexend Project (Bonnie Shaver-Troup, Thomas Jockin and contributors) | SIL Open Font License 1.1 | Google Fonts, loaded by `index.html` |

No other third-party asset ships with the game: no images, no recordings, no music files, no
sound samples.

## Made by the game itself

| What | How | Licence |
|---|---|---|
| Music (Batch 35) | Written as it plays from rules per phase (`src/web/sound-music.ts`): a key, chords, a tempo and timbres, played on Web Audio oscillators | The game's own: part of its source |
| Ambience and sound effects (Batch 35) | Made on the spot from oscillators and generated noise through filters (`src/web/sound-recipes.ts`, `src/web/sound-ambience.ts`); the noise is a fixed sequence, not a recording | The game's own: part of its source |
| The milestone chime (Batch 30, now on the interface channel) | Three sine tones, four for a phase | The game's own |
| The planet, the cities, the vehicles, the thumbnails | Drawn by the game's renderer (`src/render/`) from the simulation | The game's own |

"The game's own" means the asset is the game's source code and nothing else: it carries whatever
licence the project as a whole is released under, and it owes nothing to anyone else.

## Tools

The game is built with TypeScript, Vite and Vitest, and tested in happy-dom; none of them ships
inside the game itself beyond the code Vite writes.
