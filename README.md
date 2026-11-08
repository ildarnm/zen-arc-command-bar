# Arc Command Bar for Zen

A small Sine JavaScript mod that makes `Cmd+T` (`Ctrl+T` on Windows/Linux) act like an Arc-style tab palette.

## Behaviour

- The current tab is never included.
- With an empty query, open tabs are ordered by most recent use, so the previously active tab is selected first.
- Typing searches open tabs from Zen Spaces and Firefox bookmarks by title and URL.
- When matches exist, the best match is first and **Search in a new tab** is always second.
- When nothing matches, **Search in a new tab** is first.
- When the query is a web address, **Open site** appears immediately after **Search in a new tab** and opens the address directly.
- A bookmark whose URL is already open is deduplicated in favour of the open tab.

## Install locally

1. Install Sine and enable JavaScript mods from unofficial sources.
2. Copy this folder into the active Zen profile under `chrome/sine-mods/zen-arc-command-bar`.
3. Add the object from `theme.json` to `chrome/sine-mods/mods.json` under the key `zen-arc-command-bar`, with `"enabled": true`.
4. Restart Zen. If it does not load, open `about:support` and choose **Clear startup cache**.

Disable any other mod that intercepts `Cmd+T` (for example ZenTabPalette),
otherwise both palettes will open at the same time.

## Controls

- `Cmd+T` / `Ctrl+T`: open the palette.
- `Up`, `Down`, or `Tab`: change selection.
- `Enter`: switch to the tab, open the saved site or entered address, or search in a new tab.
- `Escape` or click outside: close.

## Development

The ranking layer is browser-independent and can be checked with:

```sh
node tests/core.test.js
```

Set `zen-arc-command-bar.debug` to `true` in `about:config` to see diagnostics in Browser Console.
