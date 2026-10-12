# Mimic

A minimal pomodoro timer PWA with tasks and alarm sounds.

Named after the Mimics in *Edge of Tomorrow*, who trap you in the same
day over and over. Focus, break, repeat. Live, die, repeat.

## Features

- Pomodoro, short break and long break timers
- Two presets (25 · 5 and 45 · 15 by default), switched from the timer
  with the ⇄ button, each with its own adjustable lengths
- Pomodoros alternate with short breaks; take a long break whenever you
  pick one
- Optional auto-start for breaks and pomodoros
- Tasks with pomodoro estimates, notes and an estimated finish time
- Reorder tasks by dragging the grip handle, or with Alt+↑/↓
- Alarm sounds (Chime, Bell, Digital, Kitchen) with volume and repeat
- Browser notifications when a round ends
- Keeps the screen awake while the timer runs
- Works offline and can be installed to your home screen or dock

## Live Demo

https://lawrencedrums.github.io/mimic/

To install, use the install icon in the address bar in Chrome or Edge,
or Share → Add to Home Screen in iOS Safari.

## Run Locally

```bash
# Clone the repo
git clone https://github.com/lawrencedrums/mimic.git
cd mimic

# Serve with any static server
python3 -m http.server 8000
```

Open http://localhost:8000 in your browser.

## Deploy

GitHub Pages serves the repo root from `main`, so pushing to `main`
deploys. The service worker fetches from the network first, so
installed copies pick up a deploy the next time they load online.
