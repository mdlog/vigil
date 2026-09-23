/** The historical replays behind the design (script/Demo.s.sol on Anvil: production contracts, real dates) — static by nature. */
export const DEMO_SCRIPT = 'https://github.com/mdlog/vigil/blob/main/script/Demo.s.sol';

export const REPLAYS: { replay: string; control: string | null; controlNote: string; what: string }[] = [
  {
    replay: '5 Aug 2024 · NVDA 107.27 → 92.06 (−14.18 %)',
    control: '40.59 USDG',
    controlNote: 'bad debt per 1,072 USDG position',
    what: 'member unwound Friday 15:00 to 76 % LTV at a 1.5 % discount; 500 bps haircut over the weekend; 0.07 USDG premium',
  },
  { replay: '27 Jan 2025 · NVDA 142.62 → 124.80 (−12.49 %)', control: '30.95 USDG', controlNote: 'bad debt per position', what: 'same path' },
  {
    replay: 'Max-LTV member hit by −12 % at Monday 10:00',
    control: null,
    controlNote: '',
    what: '70.12 USDG shortfall paid by the backstop inside the liquidation transaction; suppliers untouched',
  },
];
