import { useState, type ReactNode } from 'react';
import { ArrowUpRight, BarChart3, Check, ChevronDown, Clock3, Github, LockKeyhole, Menu, ShieldCheck, Sparkles, X } from 'lucide-react';
import manifest from '@manifest';
import { Brand } from '../Brand';
import { useNow } from '../hooks/useNow';
import { heroView, syncStatus } from '../view/status';
import { LINKS } from './links';
import { LiveHero } from './LiveHero';
import { useLive } from './useLive';

const SYMBOL = (manifest.market as { collateralSymbol?: string }).collateralSymbol ?? 'NVDA';

const FAQS: [string, string][] = [
  [
    'What exactly does Vigil protect against?',
    'Vigil is designed for the gap risk created when tokenized equities stop trading but the lending market remains live. It ramps a bounded haircut into collateral pricing before closure, then uses soft unwind and first-loss cover to keep a weekend move from becoming socialized bad debt.',
  ],
  [
    'Does Vigil modify Morpho Blue?',
    'No. Vigil attaches to an unmodified Morpho Blue market through the oracle, premium, and backstop surfaces. Covered liquidation repays a shortfall in the same transaction as the seizure, so suppliers remain protected without a protocol fork.',
  ],
  [
    'Where can I inspect the implementation?',
    'The contracts, historical replays, calibration data, deployment manifests, and runbook are open source in the Vigil repository. The live dashboard reads the testnet deployment and lets you lend, borrow, join as a member and back the vault from a wallet.',
  ],
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label"><span />{children}</div>;
}

export function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const live = useLive();
  const nowMs = useNow(5000);
  const status = syncStatus(live.snapshot !== null, live.lastOkMs, live.error, nowMs);
  const hero = heroView(live.snapshot, status, SYMBOL);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell" id="top">
      <div className="ambient ambient-top" />
      <header className="site-nav">
        <div className="nav-inner">
          <Brand href="#top" />
          <nav className={menuOpen ? 'nav-links open' : 'nav-links'} aria-label="Main navigation">
            <a href="#protocol" onClick={closeMenu}>Protocol</a>
            <a href="#mechanics" onClick={closeMenu}>Mechanics</a>
            <a href="#evidence" onClick={closeMenu}>Evidence</a>
            <a href="#faq" onClick={closeMenu}>FAQ</a>
            <a className="mobile-cta button button-amber" href={LINKS.dashboard}>Open dashboard <ArrowUpRight size={15} /></a>
          </nav>
          <a className="button button-nav" href={LINKS.dashboard}>Open dashboard <ArrowUpRight size={15} /></a>
          <button className="menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-grid-lines" />
          <div className="container hero-container">
            <div className="hero-copy">
              <div className="eyebrow hero-eyebrow"><span className={hero.live ? 'pulse-dot' : 'pulse-dot off'} /> ON-CHAIN SESSION RISK <i /> ROBINHOOD CHAIN</div>
              <h1>Markets never close.<br /><em>Your risk layer shouldn’t either.</em></h1>
              <p className="hero-subhead">Vigil is the session-aware collateral risk layer for tokenized equity lending—designed to make the gap between Friday’s close and Monday’s open survivable.</p>
              <div className="hero-actions">
                <a className="button button-amber button-large" href={LINKS.dashboard}>Explore live testnet <ArrowUpRight size={17} /></a>
                <a className="text-link" href="#mechanics">See how it works <span>↓</span></a>
              </div>
              <div className="hero-meta"><span><Check size={14} /> Immutable contracts</span><span><Check size={14} /> No protocol fork</span><span><Check size={14} /> Open source</span></div>
            </div>
            <div className="hero-visual">
              <div className="visual-orbit one" />
              <div className="visual-orbit two" />
              <div className="visual-caption top"><span /> RISK ENGINE / 01</div>
              <LiveHero view={hero} href={LINKS.dashboard} />
              <div className="visual-caption bottom">NYSE CALENDAR <span>●</span> 2024–2028</div>
            </div>
          </div>
          <div className="scroll-cue"><span>SCROLL TO EXPLORE</span><i /></div>
        </section>

        <section className="logo-strip">
          <div className="container logo-strip-inner">
            <span className="logo-strip-label">BUILT FOR THE HOURS BETWEEN PRICES</span>
            <div className="logo-strip-items">
              <span><b className="logo-mini morpho">M</b> MORPHO BLUE</span>
              <span><b className="logo-mini chain">◈</b> ROBINHOOD CHAIN</span>
              <span><b className="logo-mini usdg">$</b> USDG</span>
              <span><b className="logo-mini stock">▰</b> TOKENIZED EQUITY</span>
            </div>
          </div>
        </section>

        <section className="section section-problem" id="protocol">
          <div className="container">
            <div className="section-intro split">
              <div><SectionLabel>The gap is the risk</SectionLabel><h2>When the market pauses,<br /><span>the loan doesn’t.</span></h2></div>
              <p>Stock tokens trade 24/7. Their price feeds don’t: they go silent from Friday evening until Sunday 20:00 ET, while the chain and the lending market keep running. The weekend’s move then lands at once, with no price in between at which a liquidation could have executed.</p>
            </div>
            <div className="problem-grid">
              <article className="problem-card accent">
                <small>01 / UNHEDGED CLOSURE</small>
                <div className="card-icon"><Clock3 size={22} /></div>
                <h3>Frozen price.<br />Live leverage.</h3>
                <p>A traditional oracle carries Friday’s price through the weekend while borrower exposure keeps moving.</p>
                <div className="card-footnote">THE BLIND SPOT <span>→</span></div>
              </article>
              <article className="problem-card">
                <small>02 / MARKET IMPACT</small>
                <div className="card-icon mint"><BarChart3 size={22} /></div>
                <h3>Monday opens<br />too late.</h3>
                <p>By the time a new price arrives, the market may already be underwater. Bad debt becomes everyone’s problem.</p>
                <div className="mini-loss-chart"><i /><i /><i /><i /><i /><i /><i /><i /></div>
              </article>
              <article className="problem-card dark">
                <small>03 / PROTOCOL RESPONSE</small>
                <div className="card-icon line"><ShieldCheck size={22} /></div>
                <h3>Risk needs<br />a session.</h3>
                <p>Vigil derives the session on-chain and makes risk continuous, bounded, and aligned with how markets actually trade.</p>
                <div className="card-footnote">THE VIGIL LAYER <span>→</span></div>
              </article>
            </div>
          </div>
        </section>

        <section className="section section-mechanics" id="mechanics">
          <div className="container">
            <div className="section-heading-row">
              <div><SectionLabel>One layer. Three surfaces.</SectionLabel><h2>Protection that moves<br /><span>with the session.</span></h2></div>
              <div className="heading-aside"><b>08</b><span>immutable<br />contracts</span></div>
            </div>
            <div className="architecture-line">
              <div className="architecture-node active"><span>01</span><b>CALENDAR</b></div>
              <div className="architecture-connector"><i /></div>
              <div className="architecture-node"><span>02</span><b>SESSION ORACLE</b></div>
              <div className="architecture-connector"><i /></div>
              <div className="architecture-node"><span>03</span><b>RISK ENGINE</b></div>
              <div className="architecture-connector"><i /></div>
              <div className="architecture-node morpho"><span>04</span><b>MORPHO BLUE</b></div>
            </div>
            <div className="mechanics-grid">
              <article className="mechanic-card featured">
                <div className="mechanic-header"><b>01</b><span>ORACLE</span></div>
                <div className="mechanic-visual wave">
                  <svg viewBox="0 0 500 110" preserveAspectRatio="none" aria-hidden="true"><path d="M0 76 C80 72 104 64 152 68 S226 73 280 50 S350 34 410 43 S455 52 500 45" /><path className="secondary" d="M0 76 C80 72 104 64 152 68 S226 73 280 80 S350 78 410 84 S455 82 500 79" /></svg>
                  <span className="wave-label top">PRICE FEED</span><span className="wave-label bottom">VIGIL HAIRCUT</span>
                </div>
                <h3>A price that knows<br /><em>when it’s closing.</em></h3>
                <p>VigilCalendar derives NYSE sessions on-chain—with DST, holidays, and early closes—then ramps a bounded haircut into the oracle price before closure.</p>
                <a className="card-link" href={LINKS.contracts} target="_blank" rel="noreferrer">Inspect the contracts <ArrowUpRight size={15} /></a>
              </article>
              <article className="mechanic-card">
                <div className="mechanic-header"><b>02</b><span>PREMIUM</span></div>
                <div className="mechanic-visual meter"><div className="meter-ring"><span>24/5</span></div><div><b>MEMBER</b><small>session premium</small></div></div>
                <h3>Leverage<br /><em>earns its cover.</em></h3>
                <p>Members pay a session premium in USDG, accrued from an on-chain index over the closures they hold leverage through.</p>
                <a className="card-link" href="#faq">Understand membership <ArrowUpRight size={15} /></a>
              </article>
              <article className="mechanic-card">
                <div className="mechanic-header"><b>03</b><span>BACKSTOP</span></div>
                <div className="mechanic-visual vault"><div className="vault-box"><LockKeyhole size={21} /><span>ERC-4626</span></div><b>↗</b><div className="vault-box small"><span>USDG</span></div></div>
                <h3>First-loss<br /><em>means last-resort.</em></h3>
                <p>An ERC-4626 tranche collects premiums and covers shortfalls inside liquidation—so suppliers stay whole.</p>
                <a className="card-link" href={LINKS.design} target="_blank" rel="noreferrer">Read the design <ArrowUpRight size={15} /></a>
              </article>
            </div>
          </div>
        </section>

        <section className="section section-evidence" id="evidence">
          <div className="container">
            <div className="section-intro evidence-intro">
              <div><SectionLabel>Built to be inspected</SectionLabel><h2>The numbers<br /><span>hold up.</span></h2></div>
              <p>Every parameter is backed by a replay, a fork test, or a live transaction. No black boxes. No hand-waving.</p>
            </div>
            <div className="evidence-layout">
              <div className="evidence-main">
                <b>0</b>
                <div><span>BAD DEBT</span><p>in Vigil markets across four years of NVDA, AAPL, and TSLA closure data.</p></div>
                <div className="evidence-chart"><i /><i /><i /><i /><i /></div>
                <small><a href={LINKS.calibrator} target="_blank" rel="noreferrer">CALIBRATOR / FOUR YEARS OF GAPS <ArrowUpRight size={14} /></a></small>
              </div>
              <div className="evidence-stats">
                <div><b>37</b><span>LIVE TESTNET<br />TRANSACTIONS</span><ArrowUpRight size={17} /><a className="stretched-link" href={LINKS.e2e} target="_blank" rel="noreferrer" aria-label="The 37 transactions of the end-to-end run" /></div>
                <div><b>−10.81%</b><span>REPLAYED<br />OPENING GAP</span><ArrowUpRight size={17} /><a className="stretched-link" href={LINKS.e2e} target="_blank" rel="noreferrer" aria-label="The replayed opening gap in the end-to-end run" /></div>
                <div><b>500 <small>BPS</small></b><span>MAXIMUM<br />HAIRCUT CAP</span><ArrowUpRight size={17} /><a className="stretched-link" href={LINKS.design} target="_blank" rel="noreferrer" aria-label="Why the market cap is 500 bps" /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section cta-section">
          <div className="container cta-container">
            <div className="cta-orb one" />
            <div className="cta-orb two" />
            <div className="cta-content">
              <span className="cta-kicker"><Sparkles size={15} /> LIVE ON ROBINHOOD CHAIN TESTNET</span>
              <h2>Make the<br /><em>gap survivable.</em></h2>
              <p>Explore the live dashboard, inspect the deployment, and see what session-aware risk looks like in motion.</p>
              <div className="hero-actions">
                <a className="button button-ink button-large" href={LINKS.dashboard}>Open live dashboard <ArrowUpRight size={17} /></a>
                <a className="button button-ghost button-large" href={LINKS.repo} target="_blank" rel="noreferrer"><Github size={17} /> View repository</a>
              </div>
            </div>
            <div className="cta-note"><i />DESIGNED FOR<br />CONTINUOUS<br />MARKETS</div>
          </div>
        </section>

        <section className="section section-faq" id="faq">
          <div className="container faq-container">
            <div className="faq-intro">
              <SectionLabel>Questions, answered</SectionLabel>
              <h2>Read the<br /><span>fine print.</span></h2>
              <a className="card-link" href={LINKS.docs} target="_blank" rel="noreferrer">Full documentation <ArrowUpRight size={15} /></a>
            </div>
            <div className="faq-list">
              {FAQS.map(([question, answer], index) => {
                const open = openFaq === index;
                return (
                  <div className={open ? 'faq-item open' : 'faq-item'} key={question}>
                    <button className="faq-question" type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? -1 : index)}>
                      <span><small>0{index + 1}</small>{question}</span><ChevronDown size={19} />
                    </button>
                    <div className="faq-answer"><p>{answer}</p></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-top">
          <Brand href="#top" compact />
          <div className="footer-status" data-status={status}><span className={hero.live ? 'pulse-dot' : 'pulse-dot off'} /> {hero.footer}</div>
          <div className="footer-links">
            <a href={LINKS.dashboard}>Dashboard <ArrowUpRight size={13} /></a>
            <a href={LINKS.repo} target="_blank" rel="noreferrer">GitHub <Github size={13} /></a>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 Vigil Protocol. MIT License.</span>
          <span>Session-aware collateral risk for tokenized equity.</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}
