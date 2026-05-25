# RockSniffer_PJ v0.6.9 Release Notes

## Major changes

### Completion-flag determination rewrite

The completed flag for force-end paths (SONG_PLAYING→timer=0, songID-change force-end, gameStage force-end) is now decided by deterministic signals rather than the pre-v0.6.9 `maxTime ≥ songLength - 0.5s` heuristic.

A new helper `DetermineCompletedForForceEnd()` returns `false` if any of three documented cases applies:

1. **Pause-driven exit/restart/skip** — `currentState == SnifferState.SONG_PAUSED` at the moment of force-end (UpdateState() hasn't run yet this poll). Catches pause→restart that unloads the chart, pause→skip in Nonstop Play, and any pause-driven flow that fires a force-end before the state machine transitions.

2. **No-input boot at song start** — `maxTime < 0.1s`. Rocksmith's audio-input-loss abort only fires before the timer advances meaningfully; once playback is moving, an audio-input drop triggers auto-pause instead. The 0.1s floor is well below any legitimate play time and well above the float-near-zero initialization flashes (e.g. 9.2515e-37) that can appear briefly during chart load.

3. **Score Attack 3-strike fail** — `FailedPhrases >= 3` in the SA note data. Checked FIRST so a last-phrase fail (where `maxTime` would otherwise look like a natural completion) still resolves to `completed=false`.

Otherwise: presumed natural completion → `completed=true`. This fixes two prior false-negative sources:
- Natural completion that missed the SONG_ENDING state transition due to the 0.201s poll-cadence race window
- Nonstop Play song transitions where the previous song's `maxTime` ended fractionally below `songLength - 0.5s`

The `paused` field semantics (sticky across pause→resume) are unchanged — it continues to record "was the user paused at any point during this run" for the SQL/CSV/event log columns.

### Vocals addon — karaoke-style line slide

Substantial rewrite of `addons/vocals/script.js`:

- DOM-state-tracked per-line elements (replaces rebuild-HTML-string approach) so CSS transitions can fire across polls
- Lines slide upward through four slot positions: `incoming` (off-screen below) → `preview` (bottom row) → `active` (top row) → `outgoing` (off-screen above)
- Active line semantics changed to "most recently STARTED line" so just-sung lines stay visible during gaps between lines (matches Rocksmith's in-game behavior)
- Preview line suppressed during pre-song anticipation window, appears once the active line has actually started being sung

New tunable settings at top of script.js:
- `latencyCompensation: 0.3` (was 0.250 in pre-v0.6.9, briefly 0.5 in v0.6.9 development)
- `lineAnimationDuration: 0.5` (animation duration in seconds; 0 disables animation)
- `lineHeight: '1.2em'` (per-line height, sizes the .vocal container accordingly)

`postVocalDisplayTime` is now unused (line advancement is driven by `lineAnimationDuration` instead) but retained for backward-compat. The `<span class="lyric">` wrapper is preserved around per-line syllable spans for back-compat with twitch/kick/legacy themes that style it.

### sniffer-poller.js STATE_* string constants

The `STATE_*` constants at the top of `addons/_deps/sniffer-poller.js` were changed from integers (`STATE_SONG_PLAYING = 4`, etc.) to strings (`STATE_SONG_PLAYING = "SONG_PLAYING"`, etc.) to match the v0.6.7 JSON output, which uses `[JsonConverter(typeof(StringEnumConverter))]` on the `currentState` field of `AddonServiceListener.JsonResponse`.

Fixes silent breakage of:
- Vocals addon (gate at script.js:27 was always-false because string ≠ integer)
- Phrase color coding in current_song_v2/v3/v3.1_LaS/v4 and Arcade_v1_LaS/SA (gate in playthrough-tracker.js:115 was always-false, so per-phrase accuracy was never populated, and `getPhraseAccuracy` returned 'Rest' → `accuracyGradient('Rest')` returned grey)
- accuracy_chart silently broken (same gate at script.js:11)
- Internal lifecycle transitions in sniffer-poller.js itself (lines 133, 140, 173)

One file edit (`_deps/sniffer-poller.js`) cascades the fix to all consumers — no per-addon edits needed.

### New output-format tokens

Added three new tokens for `output.json` configuration:

- `%CURRENT_PATH%` — human-readable arrangement type ("Lead", "Rhythm", "Bass"). Populated from launch (defaults to "Lead"), updates when the user switches Path at the menu level. Useful for path-specific OBS scene switching.
- `%CURRENT_PATH_BYTE%` — raw byte value (1/2/4) backing the path. Niche but available.
- `%TUNING%` — tuning name of the currently-loaded arrangement (e.g. "E Standard", "D Standard (Capo Fret 2)"). Resolved via arrangementID match against `details.arrangements[]`.

A new default output entry `path.txt` is added to the default `output.json` (writes `%CURRENT_PATH%`). Empty string is written when the relevant memory field is unavailable; downstream OBS text sources hide automatically when the file is empty.

## Known gaps preserved from v0.6.8

- **Multiplayer mode disambiguation**: most Multiplayer sub-modes share gameStages with single-player counterparts (`las_game` etc.), so the `DeriveModeFromGameStage` classifier alone cannot distinguish them. The MULTIPLAYER mode gate at PlaythroughHistory and the JS tracker stays in place; full per-player tracking with CE-discovered MP-active flag and P2 note-data structs is v0.7.0 scope.

## Files changed

- `RockSnifferLib/Sniffing/Sniffer.cs` — added `DetermineCompletedForForceEnd()` helper, updated three force-end call sites
- `RockSniffer/Program.cs` — added `%CURRENT_PATH%`, `%CURRENT_PATH_BYTE%`, `%TUNING%` token substitutions; version bump 0.6.8 → 0.6.9
- `RockSniffer/Configuration/OutputSettings.cs` — added `path.txt` default output entry
- `addons/_deps/sniffer-poller.js` — STATE_* constants changed from integers to strings
- `addons/vocals/script.js` — full rewrite for karaoke-style line slide, tuned values applied, comments trimmed

