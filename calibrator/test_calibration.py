"""Parity of the Python replicas with the on-chain arithmetic (test/unit/CurveFixture.t.sol) and the backtest maths."""
import unittest

import full_calibration as fc


class OnChainParity(unittest.TestCase):
    def test_haircut_matches_foundry_fixture(self):
        s = fc.NVDA_SIGMA_WAD
        self.assertEqual(fc.haircut_bps(0, s), 50)
        self.assertEqual(fc.haircut_bps(3_600, s), 164)
        self.assertEqual(fc.haircut_bps(63_000, s), 530)
        self.assertEqual(fc.haircut_bps(86_400, s), 611)
        self.assertEqual(fc.haircut_bps(235_800, s), 977)
        self.assertEqual(fc.haircut_bps(322_200, s), 1_133)
        self.assertEqual(fc.haircut_bps(432_000, s), 1_304)
        self.assertEqual(fc.haircut_bps(63_000, s, 20_000), 1_010)

    def test_rate_table_matches_deploy_lib(self):
        self.assertEqual(fc.rate_per_second(63_000, False), 95_000_000)
        self.assertEqual(fc.rate_per_second(235_800, False), 1_480_000_000)  # cast: 1.48e9 at the weekend bucket
        self.assertEqual(fc.rate_per_second(235_800, True), 27_000_000_000)
        mid = fc.rate_per_second(149_400 + (235_800 - 149_400) // 2, False)
        self.assertTrue(800_000_000 < mid < 1_480_000_000)

    def test_buffer_multiplier(self):
        self.assertEqual(fc.mult_wad(10), 6_240_000_000_000_000_000)
        self.assertEqual(fc.mult_wad(1_023), 1_000_000_000_000_000_000)
        self.assertEqual(fc.mult_wad(5_000), 210_000_000_000_000_000)
        self.assertTrue(420_000_000_000_000_000 < fc.mult_wad(1_250) < 1_000_000_000_000_000_000)

    def test_buffer_bps_matches_premium_contract(self):
        self.assertEqual(fc.buffer_bps(0.86), 1_022)   # b_ref = 10.2296 %, truncated like the contract
        self.assertEqual(fc.buffer_bps(0.86 * 0.95), 1_471)  # 14.7196 %, truncated
        self.assertEqual(fc.buffer_bps(0.99), 0)


class BacktestMaths(unittest.TestCase):
    def test_bad_debt_thresholds(self):
        lif = fc.LIF
        # plain market: bad debt exactly when loss > 1 − LLTV·LIF
        d = fc.LLTV
        for loss, expect in [(0.10, 0.0), (0.1022, 0.0), (0.11, (d - (1 - 0.11) / lif))]:
            got = max(d - (1 - loss) / lif, 0.0)
            self.assertAlmostEqual(got, max(expect, 0.0), places=9)
        # 5 Aug 2024 NVDA (−14.18 %) is bad debt on a plain market and not on a Vigil market with the 5 % cap
        self.assertGreater(max(fc.LLTV - (1 - 0.1418) / lif, 0.0), 0)
        self.assertEqual(max(fc.LLTV * 0.95 - (1 - 0.1418) / lif, 0.0), 0.0)


if __name__ == "__main__":
    unittest.main()
