// SnifferState string constants (v0.6.9).
//
// Pre-v0.6.7 these were integers matching the C# enum underlying values
// (NONE=0..SONG_PAUSED=6). v0.6.7 added [JsonConverter(typeof(StringEnumConverter))]
// to the currentState field in AddonServiceListener.JsonResponse, which made the
// JSON emit "currentState": "SONG_PLAYING" instead of 4. The integer constants
// became silently broken — every `state == STATE_*` comparison was string==int
// which always evaluates false.
//
// Symptoms before v0.6.9:
//   - vocals addon never displayed lyrics (gate at vocals/script.js:27 always
//     failed, so display was always blanked).
//   - playthrough-tracker.js never called update() / update_phrase() during
//     gameplay (gate at line 115 always failed), so per-phrase / per-section
//     accuracy never accumulated. Phrases displayed grey in current_song_* and
//     Arcade_* addons because getPhraseAccuracy returned 'Rest' on the empty
//     constructor-placeholder data.
//   - accuracy_chart never collected data points (similar gate broke).
//   - sniffer-poller.js internal lifecycle gates (lines 133, 140, 173) failed
//     too; songID-change tracking kept most things working but state-driven
//     transitions were silently no-ops.
//
// Fix: change the constants to the enum member NAMES, which is what the JSON
// now carries. All consumer comparisons (`state == STATE_SONG_PLAYING`,
// `data.currentState != STATE_IN_MENUS`, etc.) start working immediately
// without per-addon edits.
const STATE_NONE = "NONE";
const STATE_IN_MENUS = "IN_MENUS";
const STATE_SONG_SELECTED = "SONG_SELECTED";
const STATE_SONG_STARTING = "SONG_STARTING";
const STATE_SONG_PLAYING = "SONG_PLAYING";
const STATE_SONG_ENDING = "SONG_ENDING";

class SnifferPoller {
	//Create variables and containers for poller data.
	constructor(options = {}) {
		var defaultOptions = {
			ip: ip,
			port: port,
			interval: 900,

			onData: (data) => {},
			onSongChanged: (songData) => {console.log("onSongChanged",songData)},
			onSongStarted: (songData) => {console.log("onSongStarted",songData)},
			onSongEnded: (songData) => {console.log("onSongEnded",songData)},
			onStateChanged: (oldState, newState) => {console.log("onStateChanged",oldState+"=>"+newState)}
		}

		//Set up options
		this.options = {}
		$.extend(this.options, defaultOptions, options);

		//Poll interval
		this.polltimer = setInterval(() => this.poll(), this.options.interval);

		//Some internal state variables
		this.songStarted = false;

		this.callbacks = {
			onData: [],
			onSongChanged: [],
			onSongStarted: [],
			onSongEnded: [],
			onStateChanged: []
		}
	}

	//Trigger for onData
	onData(f) {
		this.callbacks.onData.push(f);
	}
	
	//Event triggers for onData
	_doOnData(data) {
		this.options.onData(data);

		for (var i = this.callbacks.onData.length - 1; i >= 0; i--) {
			this.callbacks.onData[i](data);
		}
	}

	//Trigger for song change
	onSongChanged(f) {
		this.callbacks.onSongChanged.push(f);
	}
	
	//Event triggers for song change
	_doOnSongChanged(song) {
		this.options.onSongChanged(song);

		for (var i = this.callbacks.onSongChanged.length - 1; i >= 0; i--) {
			this.callbacks.onSongChanged[i](song);
		}
	}

	//Trigger for song start
	onSongStarted(f) {
		this.callbacks.onSongStarted.push(f);
	}
	
	//Event triggers for song start
	_doOnSongStarted(song) {
		this.options.onSongStarted(song);

		for (var i = this.callbacks.onSongStarted.length - 1; i >= 0; i--) {
			this.callbacks.onSongStarted[i](song);
		}
	}

	//Event triggers for song end
	onSongEnded(f) {
		this.callbacks.onSongEnded.push(f);
	}
	
	//Event triggers for song end
	_doOnSongEnded(song) {
		this.options.onSongEnded(song);

		for (var i = this.callbacks.onSongEnded.length - 1; i >= 0; i--) {
			this.callbacks.onSongEnded[i](song);
		}
	}

	//Set up event triggers
	onStateChanged(f) {
		this.callbacks.onStateChanged.push(f);
	}
	
	//Event triggers when game state changes
	_doOnStateChanged(oldState, newState) {
		this.options.onStateChanged(oldState, newState);

		for (var i = this.callbacks.onStateChanged.length - 1; i >= 0; i--) {
			this.callbacks.onStateChanged[i](oldState, newState);
		}
	}

	//Set event triggers when data
	gotData(data) {
		//If we have no previous data, fire all events
		if(!this._prevdata) {
			this._doOnStateChanged(STATE_NONE, data.currentState);
			this._doOnSongChanged(data.songDetails);

			this._prevdata = data;
			this._doOnData(data);

			return;
		}

		if(this._prevdata.currentState != data.currentState) {
			this._doOnStateChanged(this._prevdata.currentState, data.currentState);

			//Standard end-of-song path: state transitions SONG_ENDING -> IN_MENUS.
			//Use this._prevdata.songDetails (not data.songDetails) so we fire with the song
			//that just ended, in case songDetails have already advanced to the next song.
			//Gated on songStarted so we don't double-fire when the songID-change branch below
			//has already handled this transition (Nonstop Play case).
			if(this._prevdata.currentState == STATE_SONG_ENDING && data.currentState == STATE_IN_MENUS) {
				if(this.songStarted) {
					this._doOnSongEnded(this._prevdata.songDetails);
					this.songStarted = false;
				}
			}

			if(data.currentState == STATE_IN_MENUS) {
				this.songStarted = false;
			}
		}

		//Detect songID change.
		//Nonstop Play: the C# state machine can stay parked in SONG_ENDING between songs (it only
		//exits on songTimer == 0, which doesn't reliably happen between consecutive Nonstop songs),
		//or it transitions through IN_MENUS so briefly the JS poll misses it. Either way, the
		//reliable signal that one song has ended and another has started is the songID flipping
		//while songStarted is true. Fire onSongEnded for the previous song before onSongChanged so
		//listeners (e.g. PlaythroughTracker) finalize against the right arrangement, then reset
		//songStarted so the onSongStarted gate below can re-fire for the new song.
		if(this._prevdata.songDetails && data.songDetails && this._prevdata.songDetails.songID != data.songDetails.songID) {
			if(this.songStarted) {
				this._doOnSongEnded(this._prevdata.songDetails);
				this.songStarted = false;
			}
			this._doOnSongChanged(data.songDetails);
		}

		//IMPORTANT: update _prevdata BEFORE the songStarted check below.
		//getCurrentArrangement() reads from this._prevdata, and tracker.onSongStarted (fired via
		//_doOnSongStarted) calls poller.getCurrentArrangement() to size its currentAttempt arrays.
		//If _prevdata is left stale here, the tracker initializes against the previous song's
		//arrangement, recreating the original Nonstop bug from the wrong direction.
		this._prevdata = data;

		//Don't fire song started before we have a valid arrangement.
		//SONG_ENDING is included as a valid trigger because in Nonstop Play the C# state machine
		//can stay parked in SONG_ENDING throughout the entire next song. Without this the tracker
		//would never reset for songs 2..N of a Nonstop run.
		if(!this.songStarted) {
			if(data.currentState == STATE_SONG_STARTING || data.currentState == STATE_SONG_PLAYING || data.currentState == STATE_SONG_ENDING) {
				if(this.getCurrentArrangement() != null) {
					this.songStarted = true;
					this._doOnSongStarted(data.songDetails);
				}
			}
		}

		this._doOnData(data);
	}

	//Get current data
	getCurrentReadout() {
		return this._prevdata.memoryReadout;
	}

	//Get current song
	getCurrentSong() {
		return this._prevdata.songDetails;
	}

	//Get current game state
	getCurrentState() {
		return this._prevdata.currentState;
	}

	//Get song timer
	getSongTimer() {
		return this._prevdata.memoryReadout.songTimer;
	}

	//Get current accuract
	getCurrentAccuracy(decimals = 2) {
		// Defensive null checks (v0.6.5 hotfix): _prevdata.memoryReadout.noteData can be
		// null in transient states — e.g., the C# RSMemoryReader's first DoReadout calls
		// before any song-mode memory has been populated, or when the noteData magic-number
		// validation fails on a poll between songs. Without these checks, addons that call
		// getCurrentAccuracy from onSongEnded handlers (which now fires on songID change too,
		// not just on state transitions) would throw "Cannot read properties of null" Vue
		// errors and break the overlay.
		if(!this._prevdata || !this._prevdata.memoryReadout || !this._prevdata.memoryReadout.noteData) {
			return 0;
		}
		var accuracy = this._prevdata.memoryReadout.noteData.Accuracy;
		if(accuracy == null) {
			return 0;
		}

		//Round to decimals
		return parseFloat(accuracy.toFixed(decimals));
	}

	//Get current arrangement (v0.6.5 hotfix5.1)
	//
	// Resolution order:
	//   1) Direct arrangementID match (exact — works in LaS/SA when memory has populated;
	//      fails in Nonstop where the arrangement_hash pointer doesn't populate). Allows
	//      bonus/alternate arrangements to match — the memory hash is exact, we trust it.
	//   2) Path filter — match by currentPath (Bass/Lead/Rhythm) read from a stable byte
	//      pointer in memory. First non-bonus, non-alternate match wins. If no regular
	//      match exists, falls through to first bonus/alt match. Path is populated from
	//      Rocksmith launch onward and works in Nonstop Play.
	//   3) Returns null if neither resolves — callers should null-check (the playthrough
	//      tracker has defensive guards for this).
	//
	// HOTFIX5 CLEAN CUT: removed the prevPath and defaultPath fallback branches that
	// previous versions used as last-resort guesses. Those were a per-addon mutable variable
	// (this.prevPath, set on every successful resolution) and a global `defaultPath` constant
	// from the now-removed config-ui.js (defaulting to "Lead"). With currentPath providing
	// a reliable real-time signal, those guesses are no longer necessary; an unresolved
	// arrangement returns null instead of silently picking a wrong path.
	//
	// HOTFIX5.1: restored first-match-wins behavior in step 2. Initial hotfix5 used a
	// count-and-only-pick-if-one approach that left sections/phrases unrendered during
	// song-select when a song happened to have multiple arrangements with type matching
	// currentPath. Legacy code (using prevPath/defaultPath) was always first-match-wins,
	// which is what users expect.
	getCurrentArrangement() {
		if(!this._prevdata) {
			return null;
		}

		if(!this._prevdata.memoryReadout) {
			return null;
		}

		if(!this._prevdata.songDetails || !this._prevdata.songDetails.arrangements) {
			return null;
		}

		var arrangements = this._prevdata.songDetails.arrangements;

		// STEP 1: Direct arrangementID match — exact, allow bonus/alt
		for (var i = arrangements.length - 1; i >= 0; i--) {
			var arrangement = arrangements[i];

			//Check that ID is correctly formatted (32 hex chars) to avoid bad matches
			if(arrangement.arrangementID && arrangement.arrangementID.length == 32 &&
			   arrangement.arrangementID == this._prevdata.memoryReadout.arrangementID) {
				return arrangement;
			}
		}

		// STEP 2: Path filter — first match wins
		var currentPath = this._prevdata.memoryReadout.currentPath;
		if(currentPath) {
			// 2a: Prefer non-bonus, non-alternate
			for (var i = 0; i < arrangements.length; i++) {
				var arr = arrangements[i];
				if((arr.type == currentPath || arr.name == currentPath) &&
				   arr.isBonusArrangement == false && arr.isAlternateArrangement == false) {
					return arr;
				}
			}
			// 2b: Bonus/alt allowed if no regular match exists
			for (var i = 0; i < arrangements.length; i++) {
				var arr = arrangements[i];
				if(arr.type == currentPath || arr.name == currentPath) {
					return arr;
				}
			}
		}

		// Unresolvable — return null. Callers all have null guards.
		return null;
	}

	//Get section at current time
	getCurrentSection() {
		return this.getSectionAt(this.getSongTimer());
	}

	//Get section at specific time
	getSectionAt(time) {
		var arrangement = this.getCurrentArrangement();

		if(!arrangement) {
			return null;
		}

		for (var i = arrangement.sections.length-1; i >= 0; i--) {
			var section = arrangement.sections[i];
			section.index = i;

			if(time > section.startTime) {
				return section;
			}
		}

		return arrangement.sections[0];
	}
	
	//Get phrase at current time
	getCurrentPhrase() {
		return this.getPhraseAt(this.getSongTimer());
	}
	
	//Get phrase at specific time
	getPhraseAt(time) {
		var arrangement = this.getCurrentArrangement();

		if(!arrangement) {
			return null;
		}

		for (var i = arrangement.phraseIterations.length-1; i >= 0; i--) {
			var phrase = arrangement.phraseIterations[i];
			phrase.index = i;

			if(time > phrase.startTime) {
				return phrase;
			}
		}

		return arrangement.phraseIterations[0];
	}
	
	//get Maximum Difficulty from an arrangement
	getMaxDif(){
		var arrangement = this.getCurrentArrangement();
		if(!arrangement) {
			return 0;
		}
		var maxDif = 0;			
		for (var i = 0; i < arrangement.phraseIterations.length; i++) { 
			var phrase = arrangement.phraseIterations[i];
			if(phrase.maxDifficulty > maxDif){
				maxDif = phrase.maxDifficulty;					
			}
		}	
		return maxDif;
	}

	poll() {
		$.getJSON("http://"+this.options.ip+":"+this.options.port, (data) => this.gotData(data));
	}

	stop() {
		clearInterval(this.polltimer);
	}
}
