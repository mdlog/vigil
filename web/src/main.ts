import './styles.css';
import { client } from './chain/client';
import { readSnapshot, type Snapshot } from './chain/snapshot';
import { el, mount } from './ui/dom';
import { startPolling } from './ui/poll';
import { createHeader } from './panels/header';
import { createSession } from './panels/session';
import { createFooter } from './panels/footer';
import type { Meta, Panel } from './panels/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = el('div', { class: 'banner hidden', role: 'status' });
const panels: Panel[] = [createHeader(), createSession(), createFooter()];
mount(app, banner, ...panels.map((p) => p.root));

let snapshot: Snapshot | null = null;
const meta: Meta = { nowMs: Date.now(), lastOkMs: null, error: null };

function paint() {
  meta.nowMs = Date.now();
  for (const p of panels) p.render(snapshot, meta);
  const show = meta.error !== null && snapshot !== null;
  banner.classList.toggle('hidden', !show);
  if (show) {
    banner.textContent = `RPC unreachable — showing data fetched ${new Date(meta.lastOkMs ?? 0).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })} ET`;
  }
}

startPolling(
  async () => {
    snapshot = await readSnapshot(client);
    meta.lastOkMs = Date.now();
    meta.error = null;
    paint();
  },
  (e) => {
    meta.error = e instanceof Error ? e.message : String(e);
    paint();
  },
);
setInterval(paint, 1000); // clock + countdown tick
