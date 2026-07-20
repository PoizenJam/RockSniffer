var ADDON_ID = "rocklist_live_connector";
var POLL_INTERVAL_MS = 900;
var CONNECTION_TIMEOUT_MS = POLL_INTERVAL_MS * 3;
var RELAY_FEEDBACK_TIMEOUT_MS = 3000;
var DEBUG_LOG_LIMIT = 80;

var storage = null;
var poller = null;
var relayFeedbackTimeoutId = 0;
var lastConnectionState = null;
var debugThrottle = {};
var state = {
  relayUrl: "",
  connected: false,
  debugEnabled: false,
  debugFeedback: "",
  debugLogs: [],
  lastDataAt: 0,
  currentStateLabel: "Waiting for RockSniffer",
  lastSong: null,
  lastSyncAt: null,
  relayFeedback: createRelayFeedbackState(false),
  sync: {
    tone: "warning",
    title: "Waiting",
    detail: "Complete setup to start syncing.",
  },
  lastSongKey: "",
  lastSongAt: 0,
  lastCompletedSongKey: "",
  lastCompletedSongAt: 0,
};

$(function () {
  storage = new SnifferStorage(ADDON_ID);

  bindEvents();
  bindDebugCapture();
  addDebugLog("info", "Addon page loaded.", {
    addonId: ADDON_ID,
    pageUrl: window.location.href,
    userAgent: window.navigator.userAgent,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  restoreRelayUrl();
  startPoller();
  refreshConnectionState();
  window.setInterval(refreshConnectionState, 1000);
  render();
});

function createRelayFeedbackState(isSaved) {
  return isSaved
    ? {
        tone: "",
        message: "",
      }
    : {
        tone: "warning",
        message: "Relay URL not saved.",
      };
}

function syncIdleState() {
  if (state.relayUrl) {
    return {
      tone: "",
      title: "Ready",
      detail: "Waiting for the next song.",
    };
  }

  return {
    tone: "warning",
    title: "Waiting",
    detail: "Complete setup to start syncing.",
  };
}

function getDisplayedSyncState() {
  if (!state.relayUrl) {
    return syncIdleState();
  }

  return state.sync;
}

function bindEvents() {
  $("#relay-form").on("submit", function (event) {
    event.preventDefault();
    saveRelayUrl();
  });

  $("#clear-relay").on("click", function () {
    clearRelayUrl();
  });

  $("#relay-url").on("input", function () {
    renderRelayForm();
  });

  $("#debug-enabled").on("change", function () {
    state.debugEnabled = $(this).is(":checked");
    state.debugFeedback = "";
    addDebugLog("info", state.debugEnabled ? "Debug mode enabled." : "Debug mode disabled.");
    renderDebugPanel();
  });

  $("#copy-debug").on("click", function () {
    copyDebugReport();
  });

  $("#clear-debug").on("click", function () {
    state.debugLogs = [];
    state.debugFeedback = "";
    addDebugLog("info", "Debug log cleared.");
    renderDebugPanel();
  });
}

function bindDebugCapture() {
  window.onerror = function (message, source, lineno, colno, error) {
    addDebugLog("error", "Unhandled script error.", {
      message: message,
      source: source,
      line: lineno,
      column: colno,
      error: error && error.stack ? error.stack : String(error || ""),
    });
  };

  $(document).ajaxError(function (_event, xhr, settings, errorThrown) {
    var url = settings && settings.url ? settings.url : "";
    if (isExpectedRockSnifferPollFailure(url)) {
      return;
    }

    addDebugLog("error", "HTTP request failed.", {
      method: settings && settings.method ? settings.method : settings && settings.type,
      url: redactUrl(url),
      status: xhr && xhr.status,
      statusText: xhr && xhr.statusText,
      error: errorThrown || "",
      response: summarizeResponseText(xhr && xhr.responseText),
    });
  });
}

function restoreRelayUrl() {
  storage
    .getValue("relayUrl")
    .done(function (value) {
      state.relayUrl = sanitizeRelayUrl(value);
      $("#relay-url").val(state.relayUrl);
      addDebugLog("info", state.relayUrl ? "Restored saved webhook URL." : "No saved webhook URL found.", {
        relayUrl: redactUrl(state.relayUrl),
      });

      if (state.relayUrl) {
        state.relayFeedback = createRelayFeedbackState(true);
        state.sync = syncIdleState();
      } else {
        state.relayFeedback = createRelayFeedbackState(false);
      }

      render();
    })
    .fail(function () {
      addDebugLog("error", "Could not read saved webhook URL from RockSniffer storage.");
      state.relayFeedback = createRelayFeedbackState(false);
      render();
    });
}

function saveRelayUrl() {
  var relayUrl = sanitizeRelayUrl($("#relay-url").val());

  if (!isValidRelayUrl(relayUrl)) {
    addDebugLog("warning", "Rejected invalid webhook URL.", {
      relayUrl: relayUrl,
    });
    state.relayFeedback = {
      tone: "danger",
      message: "Enter a valid relay URL.",
    };
    render();
    return;
  }

  storage
    .setValue("relayUrl", relayUrl)
    .done(function () {
      state.relayUrl = relayUrl;
      addDebugLog("info", "Saved webhook URL.", {
        relayUrl: redactUrl(state.relayUrl),
      });
      $("#relay-url").val(state.relayUrl);
      state.relayFeedback = {
        tone: "success",
        message: "Saved.",
      };
      state.sync = syncIdleState();
      scheduleRelayFeedbackReset();
      render();
    })
    .fail(function () {
      addDebugLog("error", "Could not save webhook URL to RockSniffer storage.", {
        relayUrl: redactUrl(relayUrl),
      });
      state.relayFeedback = {
        tone: "danger",
        message: "Could not save locally.",
      };
      render();
    });
}

function clearRelayUrl() {
  clearRelayFeedbackReset();
  storage
    .setValue("relayUrl", "")
    .always(function () {
      state.relayUrl = "";
      $("#relay-url").val("");
      addDebugLog("info", "Cleared saved webhook URL.");
      state.relayFeedback = createRelayFeedbackState(false);
      state.sync = syncIdleState();
      render();
    });
}

function startPoller() {
  poller = new SnifferPoller({
    interval: POLL_INTERVAL_MS,
  });
  addDebugLog("info", "Started RockSniffer poller.", {
    intervalMs: POLL_INTERVAL_MS,
  });

  poller.onData(function (data) {
    state.lastDataAt = Date.now();
    state.currentStateLabel = getStateLabel(data.currentState);
    if (data && data.success === false) {
      addDebugLogThrottled(
        "missing-valid-song-data",
        "warning",
        "RockSniffer responded but did not have valid song data.",
        {
          currentState: data.currentState,
        },
        10000
      );
    }
    refreshConnectionState();
    updateSongFromReadout(data);
    render();
  });

  poller.onStateChanged(function (_oldState, nextState) {
    state.currentStateLabel = getStateLabel(nextState);
    render();
  });

  poller.onSongStarted(function (song) {
    addDebugLog("info", "RockSniffer reported song started.", summarizeSong(song));
    handleSongStarted(song);
  });

  poller.onSongEnded(function (song) {
    addDebugLog("info", "RockSniffer reported song completed.", summarizeSong(song));
    handleSongCompleted(song);
  });
}

function refreshConnectionState() {
  state.connected =
    state.lastDataAt > 0 && Date.now() - state.lastDataAt <= CONNECTION_TIMEOUT_MS;
  if (lastConnectionState !== state.connected) {
    lastConnectionState = state.connected;
    addDebugLog(state.connected ? "info" : "warning", state.connected ? "Connected to RockSniffer addon service." : "Waiting for RockSniffer addon service.", {
      lastDataAt: state.lastDataAt ? new Date(state.lastDataAt).toISOString() : null,
      timeoutMs: CONNECTION_TIMEOUT_MS,
    });
  }
  renderStatusCards();
}

function updateSongFromReadout(data) {
  if (!data || !data.songDetails) {
    addDebugLogThrottled(
      "missing-song-details",
      "warning",
      "RockSniffer response did not include songDetails.",
      null,
      10000
    );
    return;
  }

  var arrangement = getCurrentArrangement();
  state.lastSong = buildDisplaySong({
    title: data.songDetails.songName,
    artist: data.songDetails.artistName,
    arrangement: arrangementName(arrangement),
    tuning: arrangementTuning(arrangement),
  });
}

function handleSongStarted(song) {
  state.lastDataAt = Date.now();
  refreshConnectionState();

  var payload = buildSongEventPayload("songStarted", song);
  state.lastSong = buildDisplaySong(payload.song);

  if (!canSendSongPayload(payload)) {
    return;
  }

  var songKey = buildSongKey(payload.song);
  if (
    songKey &&
    state.lastSongKey === songKey &&
    Date.now() - state.lastSongAt < 5000
  ) {
    addDebugLog("info", "Skipped duplicate songStarted event.", {
      songKey: songKey,
    });
    return;
  }

  state.lastSongKey = songKey;
  state.lastSongAt = Date.now();
  state.sync = {
    tone: "",
    title: "Checking queue",
    detail: "Matching current queue item.",
  };
  render();

  sendRelayEvent(payload);
}

function handleSongCompleted(song) {
  state.lastDataAt = Date.now();
  refreshConnectionState();

  var payload = buildSongEventPayload("songCompleted", song);
  state.lastSong = buildDisplaySong(payload.song);

  if (!canSendSongPayload(payload)) {
    return;
  }

  var songKey = buildSongKey(payload.song);
  if (
    songKey &&
    state.lastCompletedSongKey === songKey &&
    Date.now() - state.lastCompletedSongAt < 5000
  ) {
    addDebugLog("info", "Skipped duplicate songCompleted event.", {
      songKey: songKey,
    });
    return;
  }

  state.lastCompletedSongKey = songKey;
  state.lastCompletedSongAt = Date.now();
  state.sync = {
    tone: "",
    title: "Completing song",
    detail: "Matching current queue item.",
  };
  render();

  sendRelayEvent(payload);
}

function buildSongEventPayload(eventName, song) {
  var arrangement = getCurrentArrangement();
  if (!arrangement) {
    addDebugLog("warning", "Current arrangement was not available for event payload.", {
      event: eventName,
      song: summarizeSong(song),
    });
  }
  return {
    event: eventName,
    observedAt: Date.now(),
    song: {
      id: normalizeString(song.songID),
      title: normalizeString(song.songName),
      artist: normalizeString(song.artistName),
      album: normalizeString(song.albumName),
      arrangement: arrangementName(arrangement),
      tuning: arrangementTuning(arrangement),
      lengthSeconds: normalizeNumber(song.songLength),
    },
  };
}

function canSendSongPayload(payload) {
  if (!payload.song.title || !payload.song.artist) {
    addDebugLog("error", "Song payload is missing title or artist.", {
      event: payload.event,
      song: payload.song,
    });
    state.sync = {
      tone: "danger",
      title: "Error",
      detail: "Song details unavailable.",
    };
    render();
    return false;
  }

  if (!state.relayUrl) {
    addDebugLog("warning", "Skipped relay event because webhook URL is not configured.", {
      event: payload.event,
      song: payload.song,
    });
    state.sync = {
      tone: "warning",
      title: "Waiting",
      detail: "Queue sync is not set up.",
    };
    render();
    return false;
  }

  return true;
}

function sendRelayEvent(payload) {
  addDebugLog("info", "Sending relay event to RockList.live.", {
    event: payload.event,
    relayUrl: redactUrl(state.relayUrl),
    song: payload.song,
  });
  $.ajax({
    method: "POST",
    url: state.relayUrl,
    crossDomain: true,
    contentType: "application/json",
    dataType: "json",
    data: JSON.stringify(payload),
  })
    .done(function (response) {
      state.lastSyncAt = Date.now();
      addDebugLog("info", "RockList.live relay response received.", {
        event: payload.event,
        status: response && response.status,
        message: response && response.message,
      });
      applyRelayResponse(response);
      render();
    })
    .fail(function (xhr) {
      addDebugLog("error", "RockList.live relay event failed.", {
        event: payload.event,
        status: xhr && xhr.status,
        statusText: xhr && xhr.statusText,
        response: summarizeResponseText(xhr && xhr.responseText),
      });
      state.sync = {
        tone: "danger",
        title: "Error",
        detail: extractRelayError(xhr),
      };
      render();
    });
}

function applyRelayResponse(response) {
  if (!response || typeof response !== "object") {
    addDebugLog("error", "RockList.live returned an unexpected response.", {
      response: response,
    });
    state.sync = {
      tone: "danger",
      title: "Error",
      detail: "RockList.live returned an unexpected response.",
    };
    return;
  }

  if (response.status === "current_updated") {
    state.sync = {
      tone: "success",
      title: "Current song updated",
      detail: response.message || "Queue updated.",
    };
    return;
  }

  if (response.status === "current_advanced_and_updated") {
    state.sync = {
      tone: "success",
      title: "Queue updated",
      detail:
        response.message ||
        "Previous current song marked played. Matching song is now playing.",
    };
    return;
  }

  if (response.status === "already_current") {
    state.sync = {
      tone: "success",
      title: "Already current",
      detail: response.message || "Already up to date.",
    };
    return;
  }

  if (response.status === "ignored_no_match") {
    state.sync = {
      tone: "warning",
      title: "No match",
      detail: response.message || "Queue unchanged.",
    };
    return;
  }

  if (response.status === "ignored_ambiguous") {
    state.sync = {
      tone: "warning",
      title: "More than one match",
      detail: response.message || "Queue unchanged.",
    };
    return;
  }

  if (response.status === "current_marked_played") {
    state.sync = {
      tone: "success",
      title: "Current song marked played",
      detail: response.message || "Current song was marked played.",
    };
    return;
  }

  if (response.status === "ignored_no_current_match") {
    state.sync = {
      tone: "warning",
      title: "No current match",
      detail:
        response.message ||
        "Completion did not match the current playlist item.",
    };
    return;
  }

  if (response.status === "ignored_ambiguous_current") {
    state.sync = {
      tone: "warning",
      title: "More than one current match",
      detail:
        response.message || "More than one current playlist item matched.",
    };
    return;
  }

  state.sync = {
    tone: "",
    title: "Ready",
    detail: response.message || "Ready for the next song.",
  };
  addDebugLog("warning", "RockList.live returned an unrecognized relay status.", {
    status: response.status,
    message: response.message,
  });
}

function render() {
  renderStatusCards();
  renderRelayForm();
  renderLastSong();
  renderDebugPanel();
}

function renderStatusCards() {
  var displayedSync = getDisplayedSyncState();

  setStatusCard("rocksniffer", {
    title: state.connected ? "Connected" : "Waiting for data",
    detail: state.connected
      ? state.currentStateLabel === "Waiting for RockSniffer"
        ? "Rocksmith not running."
        : state.currentStateLabel
      : "Waiting for RockSniffer.",
    tone: state.connected ? "success" : "warning",
  });

  var syncDetail = displayedSync.detail;
  if (state.lastSyncAt) {
    syncDetail += " Last update: " + new Date(state.lastSyncAt).toLocaleTimeString();
  }

  setStatusCard("sync", {
    title: displayedSync.title,
    detail: syncDetail,
    tone: displayedSync.tone,
  });
}

function renderRelayForm() {
  var draftRelayUrl = sanitizeRelayUrl($("#relay-url").val());
  var relayUrlChanged = draftRelayUrl !== state.relayUrl;
  var canSaveRelayUrl = isValidRelayUrl(draftRelayUrl) && relayUrlChanged;

  $("#save-relay").prop("disabled", !canSaveRelayUrl);
  $("#clear-relay").prop("disabled", !state.relayUrl);

  $("#relay-feedback")
    .text(state.relayFeedback.message)
    .removeClass("is-success is-warning is-danger");

  if (state.relayFeedback.tone) {
    $("#relay-feedback").addClass("is-" + state.relayFeedback.tone);
  }
}

function renderLastSong() {
  var songCard = $(".song-card");
  var songTitle = $("#last-song-title");

  if (!state.lastSong) {
    songCard.addClass("is-empty");
    songTitle.addClass("is-empty").text("No song yet");
    $("#last-song-artist").text(
      state.connected
        ? "Start playing to see the current song."
        : "Waiting for RockSniffer."
    );
    $("#last-song-arrangement").text("");
    $("#last-song-state").text("");
    return;
  }

  songCard.removeClass("is-empty");
  songTitle.removeClass("is-empty").text(state.lastSong.title);
  $("#last-song-artist").text(state.lastSong.artist);
  $("#last-song-arrangement").text(state.lastSong.arrangementLine);
  $("#last-song-state").text(state.currentStateLabel);
}

function renderDebugPanel() {
  $("#debug-enabled").prop("checked", state.debugEnabled);
  $("#copy-debug").prop("disabled", state.debugLogs.length === 0);
  $("#clear-debug").prop("disabled", state.debugLogs.length === 0);
  $("#debug-feedback").text(state.debugFeedback);

  if (state.debugEnabled) {
    $(".debug-panel").addClass("is-debug-enabled");
    $("#debug-output").text(formatDebugReport());
  } else {
    $(".debug-panel").removeClass("is-debug-enabled");
    $("#debug-output").text("");
  }
}

function clearRelayFeedbackReset() {
  if (!relayFeedbackTimeoutId) {
    return;
  }

  window.clearTimeout(relayFeedbackTimeoutId);
  relayFeedbackTimeoutId = 0;
}

function scheduleRelayFeedbackReset() {
  clearRelayFeedbackReset();
  relayFeedbackTimeoutId = window.setTimeout(function () {
    state.relayFeedback = createRelayFeedbackState(!!state.relayUrl);
    renderRelayForm();
    relayFeedbackTimeoutId = 0;
  }, RELAY_FEEDBACK_TIMEOUT_MS);
}

function setStatusCard(prefix, input) {
  $("#" + prefix + "-status").text(input.title);
  $("#" + prefix + "-detail").text(input.detail);

  var card = $("#" + prefix + "-status").closest(".status-card");
  card.removeClass("is-success is-warning is-danger");

  if (input.tone) {
    card.addClass("is-" + input.tone);
  }
}

function addDebugLog(level, message, details) {
  state.debugLogs.push({
    at: new Date().toISOString(),
    level: level,
    message: message,
    details: sanitizeDebugDetails(details || null),
  });

  if (state.debugLogs.length > DEBUG_LOG_LIMIT) {
    state.debugLogs.splice(0, state.debugLogs.length - DEBUG_LOG_LIMIT);
  }

  if (state.debugEnabled && $("#debug-output").length) {
    renderDebugPanel();
  }
}

function addDebugLogThrottled(key, level, message, details, throttleMs) {
  var now = Date.now();

  if (debugThrottle[key] && now - debugThrottle[key] < throttleMs) {
    return;
  }

  debugThrottle[key] = now;
  addDebugLog(level, message, details);
}

function formatDebugReport() {
  var report = {
    generatedAt: new Date().toISOString(),
    addonId: ADDON_ID,
    pageUrl: window.location.href,
    browser: window.navigator.userAgent,
    rockSnifferService: "http://" + ip + ":" + port,
    relayConfigured: !!state.relayUrl,
    relayUrl: redactUrl(state.relayUrl),
    connected: state.connected,
    currentState: state.currentStateLabel,
    lastDataAt: state.lastDataAt ? new Date(state.lastDataAt).toISOString() : null,
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    lastSong: state.lastSong,
    sync: state.sync,
    logs: state.debugLogs,
  };

  return JSON.stringify(report, null, 2);
}

function copyDebugReport() {
  var report = formatDebugReport();

  if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
    window.navigator.clipboard
      .writeText(report)
      .then(function () {
        setDebugFeedback("Copied debug report.");
      })
      .catch(function () {
        fallbackCopyDebugReport(report);
      });
    return;
  }

  fallbackCopyDebugReport(report);
}

function fallbackCopyDebugReport(report) {
  var textarea = $("<textarea></textarea>");
  textarea.val(report);
  textarea.attr("readonly", "readonly");
  textarea.css({
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
  });
  $("body").append(textarea);
  textarea[0].select();

  try {
    document.execCommand("copy");
    setDebugFeedback("Copied debug report.");
  } catch (_error) {
    setDebugFeedback("Could not copy debug report. Select the text and copy it manually.");
  }

  textarea.remove();
}

function setDebugFeedback(message) {
  state.debugFeedback = message;
  renderDebugPanel();
}

function sanitizeDebugDetails(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactUrl(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if ($.isArray(value)) {
    return $.map(value, sanitizeDebugDetails);
  }

  if (typeof value === "object") {
    var output = {};
    $.each(value, function (key, item) {
      output[key] = /url|token|relay/i.test(key)
        ? redactUrl(item)
        : sanitizeDebugDetails(item);
    });
    return output;
  }

  return String(value);
}

function buildDisplaySong(song) {
  return {
    title: song.title || "Unknown song",
    artist: song.artist || "Unknown artist",
    arrangementLine: buildArrangementLine(song.arrangement, song.tuning),
  };
}

function buildArrangementLine(arrangement, tuning) {
  var parts = [];

  if (arrangement) {
    parts.push(arrangement);
  }

  if (tuning) {
    parts.push(tuning);
  }

  return parts.length > 0 ? parts.join(" • ") : "";
}

function summarizeSong(song) {
  if (!song) {
    return null;
  }

  return {
    id: normalizeString(song.songID),
    title: normalizeString(song.songName),
    artist: normalizeString(song.artistName),
    album: normalizeString(song.albumName),
    lengthSeconds: normalizeNumber(song.songLength),
  };
}

function getCurrentArrangement() {
  if (!poller || typeof poller.getCurrentArrangement !== "function") {
    return null;
  }

  try {
    return poller.getCurrentArrangement();
  } catch (_error) {
    return null;
  }
}

function arrangementName(arrangement) {
  if (!arrangement) {
    return null;
  }

  return normalizeString(arrangement.name || arrangement.type);
}

function arrangementTuning(arrangement) {
  if (!arrangement || !arrangement.tuning) {
    return null;
  }

  return normalizeString(arrangement.tuning.TuningName);
}

function getStateLabel(stateId) {
  var normalizedState = normalizeStateId(stateId);

  if (normalizedState === STATE_IN_MENUS) {
    return "In menus";
  }

  if (normalizedState === STATE_SONG_SELECTED) {
    return "Song selected";
  }

  if (normalizedState === STATE_SONG_STARTING) {
    return "Song starting";
  }

  if (normalizedState === STATE_SONG_PLAYING) {
    return "Song playing";
  }

  if (normalizedState === STATE_SONG_ENDING) {
    return "Song ending";
  }

  return "Waiting for RockSniffer";
}

function normalizeStateId(stateId) {
  if (typeof stateId === "string") {
    return stateId;
  }

  var legacyStateMap = {
    1: STATE_IN_MENUS,
    2: STATE_SONG_SELECTED,
    3: STATE_SONG_STARTING,
    4: STATE_SONG_PLAYING,
    5: STATE_SONG_ENDING,
  };

  return legacyStateMap[stateId] || STATE_NONE;
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  var trimmed = $.trim(value);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value) {
  return typeof value === "number" && isFinite(value) ? value : null;
}

function sanitizeRelayUrl(value) {
  return $.trim(String(value || ""));
}

function isValidRelayUrl(value) {
  if (!value) {
    return false;
  }

  try {
    var parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function buildSongKey(song) {
  return [song.id || "", song.artist || "", song.title || ""].join("::");
}

function extractRelayError(xhr) {
  if (xhr && xhr.responseJSON && xhr.responseJSON.message) {
    return xhr.responseJSON.message;
  }

  if (xhr && xhr.responseText) {
    try {
      var parsed = JSON.parse(xhr.responseText);
      if (parsed && parsed.message) {
        return parsed.message;
      }
    } catch (_error) {
      return "Unreadable response.";
    }
  }

  if (xhr && xhr.status) {
    return "RockList.live returned " + xhr.status + ".";
  }

  return "RockList.live could not be reached.";
}

function redactUrl(value) {
  if (typeof value !== "string" || !value) {
    return value || "";
  }

  try {
    var parsed = new URL(value);
    var parts = parsed.pathname.split("/");

    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "rocksniffer" && parts[i + 2]) {
        parts[i + 2] = "[redacted-token]";
        parsed.pathname = parts.join("/");
        return parsed.toString();
      }
    }

    return parsed.origin + parsed.pathname;
  } catch (_error) {
    return value.replace(
      /(\/rocksniffer\/[^/\s]+\/)[^/?#\s]+/i,
      "$1[redacted-token]"
    );
  }
}

function summarizeResponseText(value) {
  if (!value) {
    return "";
  }

  var text = String(value);
  return text.length > 500 ? text.substring(0, 500) + "..." : text;
}

function isExpectedRockSnifferPollFailure(url) {
  return url === "http://" + ip + ":" + port;
}
