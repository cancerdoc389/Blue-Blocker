# CHANGELOG

```txt
Summary
	1. document grouping follow 'SemVer2.0' protocol
	2. use 'PATCH' as a minimum granularity
	3. use concise descriptions
	4. type: feat \ fix \ update \ perf \ remove \ docs \ chore
	5. version timestamp follow the yyyy.MM.dd format
```

# Unreleased

-   fix: the block lock is now a 3-minute lease renewed every 30 s, so a closed, refreshed or orphaned tab frees it within minutes instead of holding it for the whole of a wait (up to 90 min). the lock is also cleared whenever the extension is reloaded
-   update: consumer status (started, waiting for another tab, next block in Ns, cooling down, stopped) is logged at the default console level so it can be seen without enabling Verbose
-   update: blocks continue while the x.com tab is in the background; the foreground-only gate has been removed
-   fix: read `verified_type` from `verification` and follower counts from `relationship_counts` now that x.com has dropped the `legacy` wrapper from user objects (restores the "skip accounts with over N followers" option and Business-checkmark detection) (#437)
-   fix: only ever run one block chain per tab. concurrent `start()` calls used to spawn parallel chains that multiplied the block rate and defeated the pacing entirely
-   fix: wait for each block request to finish before scheduling the next, and never leave the queue consumer wedged on a queue error
-   fix: send one block request per attempt (a duplicated request was fired from the network-error handler)
-   update: wider, log-uniformly randomised block pacing: 1–5 min warm-up, 45 s–8 min between blocks, bursts of 3–12, 12–90 min rests, 30 min–2 h back-off on rate limits, and a 2–6 h pause after 300 blocks
-   fix: intercept `fetch()` in addition to `XMLHttpRequest` so timeline parsing and auth-header capture survive x.com moving API traffic to fetch (restores queue processing and blocking of new accounts)
-   fix: detect the extension API namespace reliably on Chromium browsers that expose a partial `browser` global (restores popup controls and toolbar badge) (#427)
-   fix: read user name/screen name from `core` and stop throwing on missing relationship flags after x.com schema changes (#416)
-   fix: block advertisers in promoted tweets using the new `promotedMetadata.advertiser_results` shape (#416)

# v0.3.4 [2023.07.04]

-   feat: show alert when user is logged out
-   patch: write to history when block fails due to account deletion
-   fix: retry after db failure
-   fix: errors not surfacing during db transactions
-   chore: add typedefs to all messages
-   chore: display variance in popup

# v0.3.3 [2023.07.01]

-   feat: track block history, click blocked number in context menu to access (#63)
-   feat: added safelist control buttons: import, export, clear
-   feat: import block lists into queue via json files (#145)
-   feat: added close button to all popups (#68)
-   feat: auto-safelist unblocked users (#136)
-   update: popups can now be placed in any corner of the screen (#68)
-   fix: skip legacy verified error recovery
-   chore: make toasts slightly slimmer
-   chore: more and better header assignment
-   chore: add entropy to block interval

# v0.3.2 [2023.06.28]

-   fix: chrome prior to version 109
-   fix: stop parsing twitter error responses when sent using status 200
-   fix: stop blocking automated accounts (those clearly labelled as such by twitter)
-   fix: better error handling in blocking logic, wrap legacy verified logic to prevent deadlocks when db doesn't start
-   chore: remove some unneeded debug logs

# v0.3.1 [2023.06.27]

-   feat: overhaul popup menu to have new quickmenu for quick changes and an advanced tab for full options list (#141)
-   remove: management permissions requirement in manifest (#155)
-   chore: update integration logic to send test message instead of using management api
-   feat: block users promoting tweets (#5)

## v0.3.0 [2023.06.26]

-   chore: migrate to create-chrome-ext with typescript
-   chore: also check profile shape to detect nft avatars (#130)
-   feat: use travis brown's verified db to check legacy verifications (#134)
-   feat: integration with soupcan (#139)
-   fix: queue locking and overly fast blocking (#66)
-   fix: critical point logic in queue and counter new generate ref ids per lock
-   fix: ignore error responses from twitter (#142)
-   perf: change user object in queue to be slimmer
