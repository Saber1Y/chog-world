# CHOG World video

The 35-second motion intro, rendered from code with Remotion and narrated by VoiceStudio's "The Neighbor".
The scripts for the intro and the 3-minute demo are in `../docs/DEMO-SCRIPT.md`.

```bash
cd chog-world/video
pnpm install --ignore-workspace
pnpm voiceover        # regenerate missing voiceover lines (VoiceStudio must be running)
pnpm studio           # preview and scrub in the browser
pnpm render           # out/chog-world-intro.mp4 (1920x1080)
pnpm render:square    # out/chog-world-intro-square.mp4 (1080x1080)
pnpm render:vertical  # out/chog-world-intro-vertical.mp4 (1080x1920)
pnpm still            # out/poster.png
```

Edit a line in `voiceover/lines.json`, then `node voiceover/generate.mjs <line-id>` to regenerate just that one.
Scene timing lives in the `SCENES` table at the top of `src/Intro.tsx`.
