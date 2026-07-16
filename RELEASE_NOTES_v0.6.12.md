# RockSniffer_PJ v0.6.12 Release Notes

Fixes the playthrough-storage multi-write / data-corruption pathway diagnosed from live session logs, plus a new output-file feature. C# changes require a rebuild; no RockSnifferLib (submodule) changes.

## Bug fixed: ghost attempts overwriting complete playthrough records

Live logs showed some songs producing 2-3 `Storing playthrough_tracker/...` writes — the first large (complete per-section data), the later ones small (~300-450 bytes) and byte-identical to each other, sometimes firing after the *next* song had already started, keyed to the previous song.

Root cause (two Nonstop-era mechanisms interacting with a timer-throttled browser source):

1. An invisible OBS browser source under Chromium intensive wake-up throttling polls ~once per minute instead of every 100ms.
2. When one of its sparse polls lands inside the results screen (state `SONG_ENDING` persists there for 30-60s), the poller's Nonstop re-arm branch (`!songStarted` + state `SONG_ENDING` + resolvable arrangement) fires `onSongStarted` for the song the user *already finished*, building a fresh all-placeholder attempt.
3. `update()` on that same poll stamps `sections[0]` with the frozen final cumulative noteData (song timer is at the end, so the current section index exceeds 0).
4. The next observed transition — `SONG_ENDING -> IN_MENUS`, or the songID flip once the next song starts (which also explains stale-keyed late writes: the songID branch fires with `_prevdata.songDetails`) — fires `onSongEnded`.
5. The empty-shell guards pass (`finishedSections == 1`), `finalize()` stamps the last section with the same frozen noteData, and `isBetter()` returns true: the ghost's last-section accuracy exactly ties the stored best's, and tie-counts-as-better (`>= 0`, intended for real replays) lets it through.
6. The sparse ghost attempt **overwrites the complete record**. Headline accuracy survives (last section carries the true final accuracy) but section 0 falsely holds whole-song cumulative stats and every middle section is an empty placeholder — poisoning future per-section feedback ("X% better accuracy in {section}") for that song.

Ghost payloads serialize deterministically (`sections[0]` + `sections[last]` = frozen final noteData, all else `{}`), which is why repeat writes are byte-identical even across different browser sources.

### Fix 1 — ghost-attempt guard (`addons/_deps/playthrough-tracker.js`)

`isBetter()` now rejects any attempt whose populated-section count is lower than the stored previous best's. Real full replays populate at least as many sections as the stored best, so equal counts preserve the intended tie-counts-as-better semantic; ghost attempts (1-2 populated sections) are rejected with a console warning.

### Fix 2 — identical-content skip (`RockSniffer/Addons/Storage/SQLiteStorage.cs`)

`SetValue` now reads the existing value first and returns without writing (or logging) when the incoming content is byte-identical. Costs one SELECT (~1ms on localhost) per PUT. Kills redundant duplicate writes from any source, and keeps the console `Storing` log honest.

### Operational note

The trigger in the diagnosed sessions was an invisible browser source left running for months. Recommended alongside this release: remove unused invisible overlay sources, or tick "Shutdown source when not visible" on them. Songs whose stored records were already corrupted by ghost writes (identifiable by abnormally small `playthrough_tracker` rows with only 2 populated sections) can be deleted from `addonstorage.sqlite` so the next playthrough re-baselines cleanly.

## New feature: current section / phrase name output tokens

Two new output-file tokens, resolved at the current song timer position from the chart's authored names:

- `%CURRENT_SECTION%` — e.g. `verse 2`, `solo 1`, `bridge` (Rocksmith section names carry their iteration number baked in)
- `%CURRENT_PHRASE%` — the phrase iteration's name at the timer position

Both emit an empty string whenever unresolvable — song timer at 0 (menus), no arrangementID match, or missing chart data — so the files blank out between songs and OBS text sources hide naturally (same UX contract as `%CURRENT_PATH%`).

Two new default output files:

- `output/current_section.txt` = `%CURRENT_SECTION%`
- `output/current_phrase.txt` = `%CURRENT_PHRASE%`

Existing user configs pick the new entries up automatically on next run (Json.NET merges new default dictionary keys — same mechanism that rolled out `path.txt` in v0.6.9).

## Files changed

- `addons/_deps/playthrough-tracker.js` — ghost-attempt guard in `isBetter()`
- `RockSniffer/Addons/Storage/SQLiteStorage.cs` — identical-content skip in `SetValue()`
- `RockSniffer/Program.cs` — `%CURRENT_SECTION%` / `%CURRENT_PHRASE%` token resolution; version bump 0.6.11 → 0.6.12
- `RockSniffer/Configuration/OutputSettings.cs` — two new default output files

No submodule changes. Requires C# rebuild (SQLiteStorage + Program + OutputSettings changed).
