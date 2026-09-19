# E2E recording pipeline

Records `script/E2E.s.sol` running for real against the public dashboard and
produces `out/vigil-e2e.mp4` (+ `.srt`): the dashboard on the left, the live
forge log on the right, narrated afterwards from the numbers the run produced.
Copied from the reference pipeline in the somnia repo; the chain is the clock here.

## One-time setup

    npm --prefix video install
    python3 -m venv video/.venv && video/.venv/bin/pip install edge-tts

## A take, start to finish (≈10 min)

    node --experimental-strip-types video/record.ts --probe   # page live? terminal docked? cards render?
    node --experimental-strip-types video/record.ts           # runs forge --broadcast on testnet, records out/raw/take.webm
    node --experimental-strip-types video/select.ts           # → out/take.json from out/e2e.log + broadcast receipts
    video/.venv/bin/python video/tts.py                       # → out/audio/*.mp3 + words
    video/.venv/bin/python video/captions.py                  # → cut.json, captions.ass, captions.srt
    video/.venv/bin/python video/build.py                     # → out/vigil-e2e.mp4
    bash video/verify.sh

Rehearsal without spending anything: `anvil --fork-url robinhood_testnet --chain-id 46630 --port 8546`,
`cd web && npx vite --port 5179`, then `record.ts --fork` (the page reads the fork through `?rpc=`).

## Honesty rules

- Every number in the narration is read from the take (`out/take.json`), never typed in; `select.ts`
  refuses a take whose claims do not hold (Bob covered, suppliers lost assets).
- Terminal lines are verbatim forge output. `[E2E] phase n` lines are printed by forge during its
  simulation; the recorder shows each one when that phase's first transaction confirms on chain, so the
  terminal reads in chain time. Receipt lines (`✅ [Success] Hash`, `Block`) appear as they are printed.
- The explorer shot is a screenshot of the real transaction page for the first `liquidateWithCover`.
- `verify.sh` checks every hash seen on camera against the broadcast receipts.
