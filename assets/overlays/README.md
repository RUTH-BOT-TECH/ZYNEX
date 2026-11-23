# Overlay artwork

These are the transparent PNG layers that make `.wasted`, `.jail` and the rest
look like the effects people recognise, instead of an ffmpeg approximation.

Sourced from `canvacord-assets` (MIT). Copied into the repo deliberately: if the
engine resolved them from `node_modules`, a clean install or a different package
manager would break every effect in production only.

`.wasted` is the GTA loss screen — red lettering on a grey band. `.jail` is
prison bars. The engine scales the user's photo to cover the artwork's aspect
ratio, centre-crops it, and composites the artwork on top.

No text is rendered with ffmpeg: `ffmpeg-static` is built without `drawtext`,
and the Railway container has no system fonts at all.
