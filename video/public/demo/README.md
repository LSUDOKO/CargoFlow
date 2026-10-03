# Drop your recording here

- Screen recording of the live site: `recording.mp4` (1920x1080, 30 fps, one continuous take; see `../../DEMO-SHOTLIST.md`).
- Your voice-over, read from `../../SCRIPT.md` at a natural pace: `../audio/voiceover-raw.wav` (any sample rate, mono or stereo, quiet room).
- `cuts.json`: which parts of the take go into each shot. Start from `cuts.json.example` (`node scripts/fit-demo.mjs --init`);
  read the times off `recording-proxy.mp4` (`node scripts/timecode-proxy.mjs`).

Then, from `video/`: `bash scripts/finalize.sh` -> `out/cargoflow-final.mp4`. Full steps in `../../README.md`
("Finishing the film"). `recording.mp4`, the proxy, `demo-75s.mp4` and `manifest.json` are gitignored.
