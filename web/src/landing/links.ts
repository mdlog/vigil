const REPO = 'https://github.com/mdlog/vigil';

/** Every outbound link of the landing page, each pointing at the file that backs the claim next to it. */
export const LINKS = {
  dashboard: `${import.meta.env.BASE_URL}dashboard/`,
  repo: REPO,
  contracts: `${REPO}/tree/main/src`,
  design: `${REPO}/blob/main/docs/DESIGN.md`,
  docs: `${REPO}#readme`,
  calibrator: `${REPO}/blob/main/calibrator/report_full.md`,
  e2e: `${REPO}/blob/main/docs/DEPLOYMENTS.md#end-to-end-run-on-the-live-testnet`,
} as const;
