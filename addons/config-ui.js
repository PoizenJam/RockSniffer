// Assign default path for poller to inspect
//
// DEPRECATED in v0.6.5 hotfix5: this constant is no longer referenced by any of the
// shipped addons or by sniffer-poller.js's getCurrentArrangement(). Arrangement
// resolution now uses memoryReadout.currentPath (a real-time signal read from a
// stable byte pointer in Rocksmith memory) instead of a static guess. Kept here for
// backward compatibility with any user-customized addons that may still import it.
// Safe to remove from your fork if you don't have any custom addons relying on it.
const defaultPath = "Lead";
