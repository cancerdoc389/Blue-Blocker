<p align="center">
	<img src="https://github.com/kheina-com/blue-blocker/raw/main/assets/marquee.png" alt="Blue Blocker Logo">
	<br>
	Blocks all Verified Twitter Blue users on twitter.com
</p>

## Usage

Nothing! Just install and say goodbye to all the paid blue checkmarks!

By default, Blue Blocker does not block users you follow or who follow you that have purchased Twitter Blue. You can change this and other settings from the extension context menu found by clicking the extension icon in your browser's toolbar.

## How blocking is paced

Blocks do not all happen at once. To keep activity looking like a real person browsing — and to reduce the risk of x.com flagging your account for automated behaviour — Blue Blocker now spaces blocks out and only works while you're actually using the site. In practice this means:

- **There's a short delay before it starts.** When you open x.com, blocking doesn't begin immediately. There's a randomised warm-up wait (roughly 45 seconds to 2 minutes) before the first account is blocked.
- **Blocks are spread out, at random.** Accounts are blocked a random number of seconds apart (never in a rapid burst), in small groups, with a longer random pause between each group. Because of this, an account you've just scrolled past may not be blocked for a little while — this is expected and intentional.
- **It only runs when the tab is in front.** If you switch to another tab or another program, blocking pauses and picks up again when you come back to x.com.
- **The queue doesn't carry over between sessions.** Anything still waiting to be blocked is cleared when you close and reopen your browser, so it won't suddenly work through an old backlog the moment you next open x.com.
- **It backs off if x.com pushes back.** If x.com signals that you're going too fast, Blue Blocker stops for a long random cooldown (15–60 minutes) instead of retrying straight away.

Because all of this timing is handled automatically, there is no longer a "block interval" setting to configure. None of it changes _which_ accounts get blocked — only _when_.

## Install

[![Available from Chrome Webstore](assets/chrome.png)](https://chrome.google.com/webstore/detail/blue-blocker/jgpjphkbfjhlbajmmcoknjjppoamhpmm)
[![Available from Firefox Add-ons](assets/firefox.png)](https://addons.mozilla.org/en-US/firefox/addon/blue-blocker/)
[![Available from Microsoft Edge Add-ons](assets/edge.png)](https://microsoftedge.microsoft.com/addons/detail/blue-blocker/hicoljclclooehbejnglkgohmclmipip)

## Development

1. Check if your `Node.js` version is >= **18**.
2. Make sure you have [`jq`](https://jqlang.github.io/jq/) installed via your system package manager, e.g. via `apt-get install jq` on systems with `apt-get`.
3. Run `npm install` in the Blue-Blocker directory to install the npm-managed dependencies.

run the command

```shell
npm run dev
```

### Chrome

1. run `npm run dev` or `npm run build`
2. Visit the [chrome extentions page](chrome://extensions/)
    1. (or enter `chrome://extensions/` in the Chrome url bar)
3. Enable `Developer mode` in the top right
4. Click `Load unpacked` in the top left and select `blue-blocker/build` folder

### Firefox

1. Run `npm run build`
2. Run `make firefox`
3. Visit the [firefox addon debugging page](about:debugging#/runtime/this-firefox)
    1. (or enter `about:debugging#/runtime/this-firefox` in the Firefox url bar)
4. Click `Load Temporary Add-on` in the top right and select `manifest.json` in the `blue-blocker/build` folder

## License

This work is licensed under the [Mozilla Public License 2.0](https://choosealicense.com/licenses/mpl-2.0/), allowing for public, private, and commercial use so long as access to this library's source code is provided. If this library's source code is modified, then the modified source code must be licensed under the same license or an [applicable GNU license](https://www.mozilla.org/en-US/MPL/2.0/#1.12) and made publicly available.
