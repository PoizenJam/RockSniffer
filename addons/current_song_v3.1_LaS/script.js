const widthUI = document.getElementsByClassName("mainContainer")[0].offsetWidth; //Get width of UI

//create dictionary for translating phrase grades into color 
const gradeCode = {
	NaN : 'white',
	'error' : 'white',
	'No Data' : 'grey',
	'Rest' : 'black',
	'Fail' : 'red',
	'Pass' : 'indigo',
	'Good' : 'gold',
	'Perfect' : 'lime'
}

//Create function for translating phrase accuracy into color
function accuracyGradient(accuracy){
	if (accuracy == "Rest"){return "grey"}
	if (accuracy < 50){return "rgb(255, 0, 0)"}
	const red = Math.min(((100 - accuracy)/25),1) * 255;
	const green = Math.min(((accuracy - 50)/25),1) * 255;
	return "rgb("+red+","+green+", 0)";
};

// ──────────────────────────────────────────────────────────────────────────
// MIN-HOLD FOR MODE 1 (v0.6.10)
//
// Holds mode 1 (results comparison: prevNotes stats, "X% better than previous
// best", cycled feedback strings) for at least one full pass through the
// feedback array before subsequent onSongChanged/onSongStarted callbacks can
// flip back to mode 0. Min-hold scales with feedback length: a song with five
// feedback strings holds for 5 × CYCLE_MS, "YOU TRIED!"-only songs for one
// cycle.
//
// State transitions to SONG_SELECTED/SONG_STARTING/SONG_PLAYING override the
// hold immediately — once the user has progressed past the hub/result screen
// into the next song, the comparison is no longer useful.
//
// Fixes NSP regression where the songID flipped to the next-queued song the
// moment the user landed in nonstopplayhub, which triggered onSongChanged in
// the same poll as onSongEnded had set mode = 1, wiping the comparison view
// before the user could read it.
// ──────────────────────────────────────────────────────────────────────────
const CYCLE_MS = 5000;
let modeOneSetAt = 0;
let pendingModeFlipTimer = null;

function flipToModeZero(force) {
	force = !!force;
	if (pendingModeFlipTimer) {
		clearTimeout(pendingModeFlipTimer);
		pendingModeFlipTimer = null;
	}
	app.visible = true;
	if (app.mode !== 1) {
		app.mode = 0;
		return;
	}
	const minHoldMs = ((app.feedback || []).length || 1) * CYCLE_MS;
	const elapsed = Date.now() - modeOneSetAt;
	if (force || elapsed >= minHoldMs) {
		app.mode = 0;
	} else {
		pendingModeFlipTimer = setTimeout(function () {
			app.mode = 0;
			pendingModeFlipTimer = null;
		}, minHoldMs - elapsed);
	}
}

//Edit poller functions
const poller = new SnifferPoller({
	interval: 100,

	onData: function(data) {
		app.snifferData = data;
	},

	onSongStarted: function(data) {
		flipToModeZero();
	},

	onSongChanged: function(data) {
		flipToModeZero();
	},

	onSongEnded: function(data) {
		app.prevData = app.snifferData;
		// Snapshot tracker outputs BEFORE generateFeedback (and before the
		// tracker's own onSongChanged callback resets currentAttempt/previousBest
		// later in the same poll on songID flip in NSP).
		app.snapshotHasPreviousBest = tracker.hasPreviousBest();
		app.snapshotFinal = tracker.getFinal();
		app.mode = 1;
		modeOneSetAt = Date.now();
		generateFeedback();
	},

	onStateChanged: function(oldState, newState) {
		// Override min-hold the moment the user clearly progresses to the next
		// song. SONG_SELECTED = picked from hub; SONG_STARTING = chart loading;
		// SONG_PLAYING = actively playing. All three unambiguously signal that
		// the user has moved past the post-results screen.
		if (newState === STATE_SONG_SELECTED ||
		    newState === STATE_SONG_STARTING ||
		    newState === STATE_SONG_PLAYING) {
			flipToModeZero(true);
		}
	}
});

//Get tracker functions
const tracker = new PlaythroughTracker(poller);


//Create app
const app = new Vue({
	el: "#app",
	//create variable for data storage
	data: {
		visible: true,
		mode: 0,
		prevData: {},
		snifferData: {},
		feedback: [],
		feedbackIdx: 0,
		// (v0.6.10 amendment) Snapshots of tracker outputs at onSongEnded time.
		// The tracker resets (currentAttempt=null, previousBest=null) when its
		// onSongChanged callback fires later in the same poll as the songID flip
		// in NSP, which makes hasPreviousBest() return false and collapses the
		// `v-if="hasPreviousBest()"` block in mode 1 — losing the "X% better"
		// comparison line and the cycled feedback strings even while mode is
		// still 1 (held by the min-hold). Reading from these snapshots during
		// mode 1 keeps the comparison visible for the full hold window.
		snapshotHasPreviousBest: null,
		snapshotFinal: null,
        songInfoTransform: "translateX(0px)"
	},
	
	//set interval for song scroll
    mounted: function() {
        setInterval(this.doScrollSong, 4000);
    },
	
	//Create functions for UI
	methods: {
		
		//Scroll song if larger than UI
        doScrollSong: function() {
			if(this.song == null){
				let width = 0;
				} else {				
				width = (document.getElementsByClassName("songName")[0].offsetWidth + document.getElementsByClassName("songDash")[0].offsetWidth + document.getElementsByClassName("artistName")[0].offsetWidth);
				}
            if(this.songInfoTransform == "translateX(0px)" && width > widthUI) {
                this.songInfoTransform = "translateX(-"+(width-widthUI)+"px)";
            } else {
                this.songInfoTransform = "translateX(0px)";
            }
        },
		
		//If multiple feedback, cycle
		cycleFeedback: function() {
			if(this.mode == 1) {
				setTimeout(() => this.cycleFeedback(), 5000);
				this.feedbackIdx = (this.feedbackIdx+1) % this.feedback.length;
			}
		},
		
		//return previous best if available. Reads from snapshot during mode 1
		//so the `v-if="hasPreviousBest()"` block in the results view survives
		//tracker reset (which fires on songID change in NSP, before the
		//min-hold expires).
		hasPreviousBest: function() {
			if (this.mode === 1 && this.snapshotHasPreviousBest !== null) {
				return this.snapshotHasPreviousBest;
			}
			return tracker.hasPreviousBest();
		},

		//Return trackerScore. Same snapshot pattern as hasPreviousBest.
		trackerScore: function() {
			if (this.mode === 1 && this.snapshotFinal !== null) {
				return this.snapshotFinal;
			}
			return tracker.getFinal();
		}
	},
	
	//Grab variables for UI
	computed: {
		
		//Get song details. In mode 1 (results comparison), read from prevData so
		//the song name marquee / album art / artist all reference the song that
		//just ended — consistent with the prevNotes stats and comparison shown
		//below. In NSP, snifferData.songDetails advances eagerly to the next
		//queued song; without this, the marquee would already show song B while
		//the stats panel shows song A's data. (v0.6.10)
		song: function() {
			if (this.mode === 1 && this.prevData && this.prevData.songDetails) {
				return this.prevData.songDetails;
			}
			if(!this.snifferData) {
				return null;
			}

			return this.snifferData.songDetails;
		},	
		
		//Get current readout
		readout: function() {
			if(!this.snifferData) {
				return null;
			}

			return this.snifferData.memoryReadout;
		},
		
		//Get note data
		notes: function() {
			if(!this.snifferData) {
				return null;
			}

			return this.readout.noteData;
		},
		
		//Get song length
		songLength: function() {
			return formatTimer(this.song.songLength);
		},
		
		//Get song timer
		songTimer: function() {
			return formatTimer(this.readout.songTimer);
		},
		
		//Get song Progress in %
		songProgress: function() {
			if (this.readout.songTimer == 0){return 0;}
			return (this.readout.songTimer / this.song.songLength) * 100;
		},
		
		//get Phrase Start Time
		phraseStartTime: function() {
			if (this.readout.songTimer == 0){return 0;}
			const currentPhrase = poller.getCurrentPhrase();
			// Defensive null check (v0.6.5 hotfix)
			if(currentPhrase == null){return 0;}
			if(currentPhrase.index == 0){return 0;}
			return (currentPhrase.startTime / this.song.songLength) * 100;
		},
		
		//Calculate phrase height from difficulty
		phraseHeight: function() {
			if (this.readout.songTimer == 0){return 0;}
			let phraseHeight = 1;
			let maxDif = poller.getMaxDif();
			let phrase = poller.getCurrentPhrase();
			if(maxDif != 0){
				phraseHeight = phrase.maxDifficulty/maxDif;
			}
			return phraseHeight*100;
		},		
		
		//Get current arrangement (v0.6.5 hotfix5.1)
		// Resolution order: arrangementID direct match → currentPath filter (first
		// non-bonus/non-alternate match wins; falls through to bonus-allowed). Previously
		// used prevPath / defaultPath fallbacks, removed in favor of the menu-level Path
		// byte from memory.
		arrangement: function() {
			if(this.song == null) {return null;}
			if(this.song.arrangements == null) {return null;}
			var arrangements = this.song.arrangements;
			
			//STEP 1: arrangementID direct match
			for (let i = arrangements.length - 1; i >= 0; i--) {
				let arrangement = arrangements[i];
				if(arrangement.arrangementID && arrangement.arrangementID.length == 32 &&
				   arrangement.arrangementID == this.readout.arrangementID) {
					return arrangement;
				}
			}
			
			//STEP 2: currentPath filter — first match wins (legacy behavior restored in 5.1)
			var currentPath = this.readout.currentPath;
			if(currentPath) {
				for (let i = 0; i < arrangements.length; i++) {
					let arr = arrangements[i];
					if((arr.type == currentPath || arr.name == currentPath) &&
					   arr.isBonusArrangement == false && arr.isAlternateArrangement == false) {
						return arr;
					}
				}
				//Bonus/alt allowed if no regular match
				for (let i = 0; i < arrangements.length; i++) {
					let arr = arrangements[i];
					if(arr.type == currentPath || arr.name == currentPath) {
						return arr;
					}
				}
			}
			
			return null;
		},
		
		//Get tuning name
        tuningName: function() {
            if(this.arrangement == null) {return null;}
			return this.arrangement.tuning.TuningName;		
        },
		
		//Create and draw sections
		sections: function() {
			arrangement = this.arrangement;

			if(arrangement == null) {return null;}			
			
			let sections = arrangement.sections;

			let songLength = this.song.songLength;
			
			//Cycle through all sections and draw
			for (let i = 0; i < sections.length; i++) {
				let section = sections[i];

				section.length = section.endTime - section.startTime;

				section.startPercent = (section.startTime / songLength) * 100;
				
				//Always make the first section start from 0%
				if(i == 0) {
					section.length =  section.endTime;
					section.startPercent = 0;
				}

				section.endPercent = (section.endTime / songLength) * 100;

				section.lengthPercent = (section.length / songLength) * 100;

				section.style = {
					left: section.startPercent+'%',
					width: (section.lengthPercent-(100/(widthUI)))+'%',
				}
				
				//If currently playing, color royal-blue as in game
				if(this.readout.songTimer > section.startTime && this.readout.songTimer <= section.endTime){
					section.style.backgroundColor = "royalblue";
				}
				
				//If has previous best, color based on that. If not, then color using accuracy gradient.
				//Note: && is required (not bitwise &) so hasPreviousBest() short-circuits and getSectionAccuracy()
				//is not called when there is no previous best to compare against.
				if (this.readout.songTimer > section.endTime || this.readout.gameStage == "panel_bib" || this.readout.gameStage == "sa_songreview" || this.readout.gameStage == "las_songreview"){
					if(tracker.hasPreviousBest() && tracker.getSectionAccuracy((section.startTime + section.endTime)/2) != 'Rest') {
						section.style.backgroundColor = (tracker.isBetterRelative((section.startTime + section.endTime)/2) ? "lime" : "red");
					} else {						
						section.style.backgroundColor = accuracyGradient(tracker.getSectionAccuracy((section.startTime + section.endTime)/2));
					}
				}

				sections[i] = section;
			}

			return sections;
		},
		
		//Create and draw phrase iterations
		phraseIterations: function() {
			arrangement = this.arrangement;

			if(arrangement == null) {return null;}			
			
			let phraseIterations = arrangement.phraseIterations;

			songLength = this.song.songLength;
					
			maxDif = poller.getMaxDif();		
			
			//Cycle through phrases and draw
			for (let i = 0; i < phraseIterations.length; i++) {
				phrase = phraseIterations[i];

				phrase.length = phrase.endTime - phrase.startTime;

				phrase.startPercent = (phrase.startTime / songLength) * 100;
				
				//Always make the first phrase start from 0%
				if(i == 0) {
					phrase.length =  phrase.endTime;
					phrase.startPercent = 0;
				}

				phrase.endPercent = (phrase.endTime / songLength) * 100;

				phrase.lengthPercent = (phrase.length / songLength) * 100;
				
				phraseHeight = 1;
				
				if(phrase.maxDifficulty > maxDif){maxDif = phrase.maxDifficulty}
				
				if(maxDif != 0){
					phraseHeight = phrase.maxDifficulty/maxDif;
				}
				
				phrase.style = {
					left: phrase.startPercent+'%',
					width: (phrase.lengthPercent-(100/(widthUI)))+'%',
					height: Math.round((phraseHeight)*100)+'%'
				}

				//If phrase grade exists, color based on that; else, use accuracy gradient
				if (this.readout.songTimer > phrase.endTime || this.readout.gameStage == "panel_bib" || this.readout.gameStage == "sa_songreview"  || this.readout.gameStage == "las_songreview"){
					if(tracker.getPhraseGrade((phrase.startTime + phrase.endTime)/2) != "No Data"){
						phrase.style.backgroundColor = gradeCode[tracker.getPhraseGrade((phrase.startTime + phrase.endTime)/2)];
					} else {
						phrase.style.backgroundColor = accuracyGradient(tracker.getPhraseAccuracy((phrase.startTime + phrase.endTime)/2));						
					}
				}
				phraseIterations[i] = phrase;
			}
			return phraseIterations;
		},
		/* PREV */
		
		//Get previous song
		prevSong: function() {
			return this.prevData.songDetails;
		},
		
		//Get previous readout
		prevReadout: function() {
			if(!this.prevData) {
				return null;
			}

			return this.prevData.memoryReadout;
		},
		
		//Get previous note data 
		prevNotes: function() {
			if(!this.snifferData) {
				return null;
			}

			return this.prevReadout.noteData;
		},
		
		//Get previous arrangement
		prevArrangement: function() {
			if(this.prevSong == null) {return null;}
			if(this.prevSong.arrangements == null) {return null;}
			
			for (let i = this.prevSong.arrangements.length - 1; i >= 0; i--) {
				arrangement = this.prevSong.arrangements[i];

				if(arrangement.arrangementID.length == 32 && arrangement.arrangementID == this.prevReadout.arrangementID) {
					return arrangement;
				}
			}
			return null;
		},
		
		//Get previous path info
		prevPath: function() {
			if(this.prevSong == null){return null;}
			//Defensive: prevArrangement returns null when no entry in prevSong.arrangements matches
			//prevReadout.arrangementID — which is the case in Nonstop transitions when memoryReadout.arrangementID
			//becomes junk (e.g. "Fear Inoculum", "urn:image:dds:album_..."). Without this guard, .type
			//throws TypeError, killing the Vue render.
			if(this.prevArrangement == null){return null;}
			return this.prevArrangement.type;
		},
		
		//Get previous sections and draw results screen
		prevSections: function() {
			arrangement = this.prevArrangement;

			if(arrangement == null) {return null;}

			sections = arrangement.sections;

			songLength = this.prevSong.songLength;

			for (let i = 0; i < sections.length; i++) {
				section = sections[i];

				section.length = section.endTime - section.startTime;

				section.startPercent = (section.startTime / songLength) * 100;
				
				//Always make the first section start from 0%
				if(i == 0) {
					section.length =  section.endTime;
					section.startPercent = 0;
				}

				section.endPercent = (section.endTime / songLength) * 100;

				section.lengthPercent = (section.length / songLength) * 100;

				section.style = {
					left: section.startPercent+'%',
					width: (section.lengthPercent-(100/(widthUI)))+'%'
				}
				
				if(tracker.hasPreviousBest()) {
					section.style.backgroundColor = (tracker.isBetterRelative((section.startTime + section.endTime)/2) ? "lime" : "red");
				} else {						
					section.style.backgroundColor = accuracyGradient(tracker.getSectionAccuracy((section.startTime + section.endTime)/2));
				}
				
				sections[i] = section;
			}

			return sections;
		},
				
		//Get previous phrases and draw results screen
		prevPhrases: function() {
			arrangement = this.prevArrangement;

			if(arrangement == null) {return null;}

			phraseIterations = arrangement.phraseIterations;

			songLength = this.prevSong.songLength;
			
			maxDif = poller.getMaxDif();		
			
			for (let i = 0; i < phraseIterations.length; i++) {
				phrase = phraseIterations[i];

				phrase.length = phrase.endTime - phrase.startTime;

				phrase.startPercent = (phrase.startTime / songLength) * 100;
				
				//Always make the first phrase start from 0%
				if(i == 0) {
					phrase.length =  phrase.endTime;
					phrase.startPercent = 0;
				}

				phrase.endPercent = (phrase.endTime / songLength) * 100;

				phrase.lengthPercent = (phrase.length / songLength) * 100;
				
				phraseHeight = 1;
				
				if(phrase.maxDifficulty > maxDif){maxDif = phrase.maxDifficulty}
				
				if(maxDif != 0){
					phraseHeight = phrase.maxDifficulty/maxDif;
				}
				
				phrase.style = {
					left: phrase.startPercent+'%',
					width: (phrase.lengthPercent-(100/(widthUI)))+'%',
					height: Math.round((phraseHeight)*100)+'%'
				}
				
				if(tracker.getPhraseGrade((phrase.startTime + phrase.endTime)/2) != "No Data"){
					phrase.style.backgroundColor = gradeCode[tracker.getPhraseGrade((phrase.startTime + phrase.endTime)/2)];
				} else {
					phrase.style.backgroundColor = accuracyGradient(tracker.getPhraseAccuracy((phrase.startTime + phrase.endTime)/2));						
				}

				phraseIterations[i] = phrase;
			}

			return phraseIterations;
		}
	}
});

//Format timer
function formatTimer(time) {
	if (time < 0) {
		return "";
	}

	const minutes = Math.floor(time / 60);
	const seconds = time % 60;

	return [minutes, seconds].map(X => ('0' + Math.floor(X)).slice(-2)).join(':')
}

//Generate feedback
function generateFeedback() {
	app.feedback = [];

	arrangement = poller.getCurrentArrangement();
	//Defensive: getCurrentArrangement can return null in Nonstop Play transitions when memoryReadout.arrangementID
	//is junk and none of the fallback paths match. Without this guard, `arrangement.sections` throws TypeError,
	//propagating out of _doOnSongEnded -> gotData and aborting the poll BEFORE _doOnData runs — which means
	//app.snifferData isn't updated and the entire UI freezes. Falling back to a generic feedback line keeps
	//the data pipeline alive.
	if(arrangement == null) {
		app.feedback = ["YOU TRIED!"];
		app.cycleFeedback();
		hideTimeout = setTimeout(() => {if(app.mode == 1) {app.mode = 0; app.visible = false;}}, 60000);
		return;
	}
	sections = arrangement.sections;
	let feedback = []

	let greens = 0;

	for (let i = sections.length - 1; i >= 0; i--) {
		section = sections[i];
		const rel = tracker.getRelative(section.endTime);

		if(rel == null) {
			continue;
		}

		if(rel.Accuracy >= 0) {
			greens++;
		}

		if(rel.Accuracy >= 1) {
			feedback.push(rel.Accuracy.toFixed(1)+"% better accuracy in "+section.name);
		}
		if(rel.TotalNotesHit > 2) {
			feedback.push("Hit "+rel.TotalNotesHit+" more notes in "+section.name);
		}
	}

	if(greens > 0) {
		feedback.push(greens+" green sections");
	}

	feedback.sort(() => Math.random() - 0.5);

	if(poller.getCurrentAccuracy() == 100) {
		feedback.push("GOT A FULL COMPLETE!");
	}

	if(feedback.length == 0) {
		feedback.push("YOU TRIED!");
	}

	app.feedback = feedback;

	app.cycleFeedback();

	hideTimeout = setTimeout(() => {if(app.mode == 1) {app.mode = 0; app.visible = false;}}, 60000);
}
