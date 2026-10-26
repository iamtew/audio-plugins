# Stupid Audio

Catalog site for the Stupid Audio product line from Stupid Systems: TEW03, K1X, 5HKR, V4JB, and F4RT.

Static HTML on GitHub Pages: [iamtew.github.io/audio-plugins](https://iamtew.github.io/audio-plugins/).

Each plugin keeps its own site, downloads, and GitHub repo. This hub only lists them.

The animated backdrop (`fx.js`) loads a pinned [PixiJS](https://pixijs.com/) build from jsDelivr. No build step. If the CDN or WebGL is unavailable, or the visitor prefers reduced motion, the page falls back to its CSS gradients (or a still frame).

Preview locally with `python -m http.server`.

After a plugin logo changes in its checkout, run `just logos` here to copy the PNGs into `assets/`.
