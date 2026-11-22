NextGX Refined Logo Pack (Pure-Vector Edition)
- nextgx-app-icon.svg: square rounded gaming tile app icon (Solar Amber default: #FFD166 -> #FFAA32 -> #E45A18)
- nextgx-primary.svg: dark-background pure-vector nGX wordmark + NEXTGX BROWSER subtitle
- nextgx-light.svg: light-background pure-vector nGX wordmark
- nextgx-themes.css: eight adaptive theme palettes

Refinements applied:
1. Replaced font-dependent <text>n</text> with a precision custom geometric vector <path> for lowercase 'n', matching the stroke geometry and kerning of oversized custom 'G' and 'X'.
2. Optically centered the nGX monogram inside the 256x256 tile with warm obsidian background, top gloss highlight, and neon rim border.
3. Wired live CSS custom properties (--gx-logo-highlight, --gx-logo-primary, --gx-logo-secondary, --gx-logo-tile-top, --gx-logo-tile-bot) in src/ui/theme.css so all in-browser logos (Titlebar, Start Page Hero, WebUI Settings/History header) dynamically adapt across all 8 browser themes + Private mode.
4. Generated multi-resolution Windows build/icon.ico (16/24/32/48/64/128/256px) and build/icon.png (512px) in Solar Amber via scripts/generate-icons.js.
