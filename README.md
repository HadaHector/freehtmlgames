# freehtmlgames

A collection of single-player, offline-playable HTML games, designed mainly for mobile browsers. Each game lives in its own subfolder.

## Structure

```
index.html        # game selection page
my-game/
  index.html      # each game is self-contained
```

## Adding a game

1. Create a folder, e.g. `my-game/`, with an `index.html` as the entry point.
2. Keep it self-contained: no external CDNs or network requests, so it works offline.
3. Use relative paths for assets, since the site is served from a subpath on GitHub Pages.
4. Add the game to the `games` list in the root `index.html`.

## Deployment

Pushing to `main` deploys the site via GitHub Pages (`.github/workflows/pages.yml`).
Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Local testing

Tank Battlegrounds uses ES modules, which browsers won't load from `file://`. Serve the repo instead:

```
python3 -m http.server 8000   # then open http://localhost:8000/tank-battlegrounds/
```
