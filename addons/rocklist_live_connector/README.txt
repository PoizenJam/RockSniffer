RockList.live Connector for RockSniffer

What this addon does
- Watches RockSniffer for song starts and completions.
- Sends the current song to RockList.live.
- Asks RockList.live to set matching queued songs current and mark matching current songs played.

How to set it up
1. Start RockSniffer.
2. In RockList.live, open your channel settings Integrations tab:
   https://rocklist.live/dashboard/settings#integrations
3. Copy your RockSniffer webhook URL.
4. Open this page in your browser:
   http://127.0.0.1:9938/addons/rocklist_live_connector/rocklist_live_connector.html
5. Paste the webhook URL and save it.
6. Keep the page open in a browser tab or OBS browser source while you play.

Compatibility
- Built for PoizenJam/RockSniffer v0.6.10.
- Uses the current string-based RockSniffer state values.
- Also labels legacy numeric state values from older RockSniffer builds.

What to expect
- RockList.live can set the matching queued song as current.
- RockList.live can mark the previous current song played when it advances.
- RockList.live can mark the matching current song played when RockSniffer detects completion.
- Song completion only matches the current playlist item; queued-only matches are not marked played.
- If more than one queued song matches, RockList.live leaves the queue unchanged.
