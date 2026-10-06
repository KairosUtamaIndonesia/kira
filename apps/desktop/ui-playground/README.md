# Kira UI Playground

Run `bun run dev:ui-playground` from the repository root and open the local URL Vite prints.
This browser-only preview uses mock data and does not connect to Kira or start Electron.

To add an experiment, create a screen component in `src/screens/`, then add its name,
description, and render function to the `experiments` list in `src/playground.tsx`. Keep an
experiment small and self-contained; reuse desktop components when they work without the
Electron bridge, otherwise use a standalone mockup. Promote a chosen idea by implementing it
deliberately in the desktop renderer, not by treating the scratch file as production code.
