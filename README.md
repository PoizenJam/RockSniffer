# RockSniffer

An enhanced fork of [kokolihapihvi's RockSniffer](https://github.com/kokolihapihvi/RockSniffer) for Rocksmith 2014 streamers and players who want deeper insight into their sessions.

RockSniffer adds pause/resume detection, structured playthrough history logging, Score Attack stat tracking, and configurable event output — features designed for stat tracking, stream automation, and post-session video editing.

Requires the companion [RockSnifferLib](https://github.com/PoizenJam/RockSnifferLib) fork.

---

## Features Added Over Base RockSniffer

### Pause & Resume Detection

Rocksniffer detects when a song is paused and resumed in real time. This is achieved through a stall-counter system that monitors the game's internal song timer for consecutive stalled reads, with guards to prevent false positives near the start and end of songs.

When a pause is detected, the sniffer state transitions to `SONG_PAUSED`. Downstream events (resume, restart, quit-from-pause) are tracked accordingly. The `paused` flag is carried through to all end-of-song logging, so you always know whether a playthrough involved a pause.

### Game State & Game Stage Output

Two new output files are available for use in OBS or other streaming tools:

- **`game_state.txt`** — The sniffer's high-level state machine value (e.g., `IN_MENUS`, `SONG_PLAYING`, `SONG_PAUSED`, `SONG_ENDING`). Useful for triggering OBS scene switches.
- **`game_stage.txt`** — Rocksmith's own internal game stage string, read directly from memory.

Both are configured via `config/output.json` using the `%GAME_STATE%` and `%GAME_STAGE%` format tokens.

### Playthrough History (SQLite & CSV)

Every song playthrough is logged to a persistent database and/or CSV file with full metadata and performance stats. Enable in `config/output.json`:

```json
{
  "enableSqliteHistory": true,
  "sqliteHistoryPath": "playthrough_history.db",
  "enableCsvHistory": true,
  "csvHistoryPath": "playthrough_history.csv"
}
```

Each record includes:

- **Timestamps** — When the song was selected, when gameplay actually started, and when it ended
- **Song metadata** — Song name, artist, album, year, song length, CDLC author
- **Arrangement details** — Arrangement path (Lead/Rhythm/Bass), tuning
- **Performance stats** — Total notes, notes hit, notes missed, highest streak, accuracy
- **Session flags** — Whether the song was completed, whether it was paused at any point
- **Score Attack stats** (when applicable) — Perfect/good/passed/failed phrases, phrase streaks, score, multiplier

The three-timestamp design (metadata load, actual start, actual end) enables precise alignment with stream recordings for post-session video editing.

### Configurable Event Logging

EVENT=START and EVENT=END log output is controlled by the `eventLogMode` setting in `config/output.json`:

- **`"disabled"`** — No event output to console or sniffer.log (history logging still works independently)
- **`"legacy"`** — Single-line format matching the original sniffer log style
- **`"enabled"`** — Human-readable multi-line format with labeled fields

---

## Example Log Output

```
[2026-03-05 21:03:08] EVENT=START;artist=Dio;album=Holy Diver;year=1983;song=Rainbow in the Dark;length=249.703;path=Bass;tuning=E Standard;author=Ubisoft;
[2026-03-05 21:07:16] EVENT=END;completed=True;paused=False;accuracy=99.8%;totalNotes=662;notesHit=661;highestStreak=401;
```

With a pause mid-song:

```
[2026-03-05 21:10:00] EVENT=START;artist=Rush;album=Moving Pictures;year=1981;song=Limelight;length=271.69;path=Bass;tuning=E Standard;author=Ubisoft;
[2026-03-05 21:12:30] Song Paused! (timer stalled at 150.234 for 5 reads)
[2026-03-05 21:12:45] Song Resumed!
[2026-03-05 21:15:10] EVENT=END;completed=True;paused=True;accuracy=99.3%;totalNotes=735;notesHit=730;highestStreak=227;
```

Score Attack mode includes additional stats:

```
EVENT=END;completed=True;paused=False;accuracy=99.3%;totalNotes=735;notesHit=730;highestStreak=227;Mode=true;TotalPerfectHits=710;PerfectPhrases=12;GoodPhrases=3;PassedPhrases=0;FailedPhrases=0;HighestPerfectPhraseStreak=8;HighestGoodPhraseStreak=2;HighestPassedPhraseStreak=0;HighestFailedPhraseStreak=0;CurrentScore=125000;HighestMultiplier=4;
```

### Score Attack Support

When playing in Score Attack mode, RockSniffer reads and logs the full set of Score Attack-specific stats from game memory, including perfect hits, phrase ratings (perfect/good/passed/failed), phrase streaks, current score, and highest multiplier. These are included in both the event log and playthrough history.

### Improved Tuning Dictionary

Greratly increased ability to detect rare or exotic tunings, as well as compensate for some common 'errors' seen in CDLC (i.e., bass charts not setting offsets for B and e string). If a match in the tuning dictionary is not found, the program will fall back to simply displaying the raw string tuning. 

### Improved Vocal Overlay

Vocal overlay has been improved, adding multiple themes (kick, twitch, rocksmith-style) and improving the javascript execution such that lyrics are displayed more or less identical to in-game lyrics, with the same style of line breaks, highlighting, and marking for completed lyrics.

---

## Setup

Base setup is the same as the original RockSniffer — see the [RockSniffer Wiki](https://github.com/kokolihapihvi/RockSniffer/wiki/Set-Up) for initial configuration.

To enable PJ-specific features, edit `config/output.json` and set:

- `enableSqliteHistory` / `enableCsvHistory` to `true` for playthrough logging
- `eventLogMode` to `"legacy"` or `"enabled"` for event console/log output
- The default output dictionary already includes `game_state.txt` and `game_stage.txt`

---

## Note

This fork adds additional memory reads, file writes, and processing compared to the base RockSniffer. If you don't need pause detection, playthrough history, or Score Attack stats, the [main RockSniffer distribution](https://github.com/kokolihapihvi/RockSniffer) will have lower overhead.

---

## Credits

Original RockSniffer by [kokolihapihvi](https://github.com/kokolihapihvi/RockSniffer). Fork enhancements by [PoizenJam](https://github.com/PoizenJam).
