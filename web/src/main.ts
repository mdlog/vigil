import './styles.css';
import { client } from './chain/client';
import { readSnapshot, type Snapshot } from './chain/snapshot';
import { readCurve } from './chain/curve';
import { el, mount } from './ui/dom';
import { startPolling } from './ui/poll';
import { createHeader } from './panels/header';
import { createSession } from './panels/session';
import { createPrice } from './panels/price';
import { createEconomy } from './panels/economy';
import { createUse } from './panels/use';
import { createEvidence } from './panels/evidence';
import { createContracts } from './panels/contracts';
import { createFooter } from './panels/footer';
import type { Meta, Panel } from './panels/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = el('div', { class: 'banner hidden', role: 'status' });
const price = createPrice();
const panels: Panel[] = [createHeader(), createSession(), price, createEconomy(), createUse(), createEvidence(), createContracts(), createFooter()];
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

let curveSurfaceKey = '';
startPolling(
  async () => {
    snapshot = await readSnapshot(client);
    meta.lastOkMs = Date.now();
    meta.error = null;
    paint();
    const key = `${snapshot.surface.sigmaGapWad}-${snapshot.surface.kTailBps}-${snapshot.surface.hFloorBps}-${snapshot.surface.hMaxBps}`;
    if (key !== curveSurfaceKey) {
      price.setCurve(await readCurve(client, snapshot.surface));
      curveSurfaceKey = key;
    }
  },
  (e) => {
    meta.error = e instanceof Error ? e.message : String(e);
    paint();
  },
);
setInterval(paint, 1000); // clock + countdown tick
