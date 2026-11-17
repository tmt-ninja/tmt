import { SiteHeader, SiteFooter } from "../shared/SiteChrome.js";
import { landingChrome } from "../shared/landing-chrome.js";
import { useState } from "react";
import { useAtom } from "jotai";
import { LocalLink } from "../components/LocalLink";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { languageOf } from "../lang/languages";
import { useLang } from "../lang/useLang";
import { useStrings } from "../lang/useStrings";
import { themeAtom, type ThemeChoice } from "../state/theme";
import "./v9.css";
import { BrandMark } from "../components/BrandMark";
import asset1 from "./assets/v9-1.svg";
import { HeroTunnel } from "./HeroTunnel";
import asset3 from "./assets/v9-3.svg";
import asset4 from "./assets/v9-4.svg";
import asset5 from "./assets/v9-5.svg";
import asset6 from "./assets/v9-6.svg";
import asset7 from "./assets/v9-7.svg";

const INSTALL = "curl -fsSL https://github.com/pj-tmt/tmt/releases/latest/download/install.sh | sh";
const EXAMPLE = 'tmt talk reviewer "Review this patch" --detach';
const THEMES: ThemeChoice[] = ["system", "light", "dark"];
function HomeControls() {
  const { landing } = useStrings();
  const [theme, setTheme] = useAtom(themeAtom);
  return (
    <div className="home-controls">
      <LanguageSwitcher variant="bar" />
      <button
        type="button"
        aria-label={landing.theme.replace("{theme}", theme)}
        onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      >
        {theme === "dark" ? "●" : theme === "light" ? "○" : "◐"}
      </button>
    </div>
  );
}
function TopInstall({
  command = INSTALL,
  label,
  id,
}: {
  command?: string;
  label?: string;
  id?: string;
}) {
  const { home, landing } = useStrings();
  const [copied, setCopied] = useState(false);
  return (
    <div className="top-install" id={id}>
      <span>{label ?? home.install}</span>
      <code>{command}</code>
      <button
        type="button"
        aria-label={landing.copyCommand}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? landing.copied : landing.copy}
      </button>
    </div>
  );
}
// Direct port of Ben's approved v9 study; all illustration data is authored,
// static and illustrative. MDX chapters remain in source, outside public rendering.
export function HomePage() {
  const { lang } = useLang();
  const chrome = landingChrome("~/", languageOf(lang).prefix);
  return (
    <div className="v9-home" lang={languageOf(lang).htmlLang}>
      <SiteHeader config={chrome}>
        <HomeControls />
      </SiteHeader>
      <HomeContent />
      <SiteFooter config={chrome} />
    </div>
  );
}
function HomeContent() {
  const { landing } = useStrings();
  // The captions inside the English example terminal are in the page's language.
  const pageLang = languageOf(useLang().lang).htmlLang;
  const [copied, setCopied] = useState(false);
  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(EXAMPLE);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <main>
      <section className="hero" id="top">
        <HeroTunnel />
        <div className="hero-inner content">
          <TopInstall id="install" />
          <BrandMark className="hero-mark" size={112} />
          <p className="eyebrow">
            <span className="signal"></span>
            <span>{landing.eyebrow}</span>
          </p>
          <h1>
            Terminal
            <br />
            Tunnel<span className="title-period">.</span>
          </h1>
          <p className="hero-statement">{landing.statement}</p>
          <p className="hero-description">{landing.description}</p>
          <div className="hero-actions">
            <LocalLink className="button primary" to="/" hash="install">
              <span>{landing.getStarted}</span>
              <img className="icon" src={asset3} alt="" />
            </LocalLink>
            <LocalLink className="text-link" to="/" hash="workflow">
              <span>{landing.seeWorkflow}</span>
              <img className="icon" src={asset3} alt="" />
            </LocalLink>
          </div>
          <div className="hero-footnote">
            <span>{landing.heroSteps[0]}</span>
            <span className="line"></span>
            <span>{landing.heroSteps[1]}</span>
            <span className="line"></span>
            <span>{landing.heroSteps[2]}</span>
          </div>
        </div>
      </section>

      <section className="compatibility">
        <div className="content compatibility-inner">
          <span>{landing.compatibility}</span>
          <div>
            <span>Codex</span>
            <span>Claude Code</span>
            <span>Gemini</span>
            <span className="muted">{landing.andMore}</span>
          </div>
        </div>
      </section>

      <section id="workflow" className="workflow content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{landing.workflowEyebrow}</p>
            <h2>{landing.workflowTitle}</h2>
          </div>
          <div className="workflow-summary">
            <p>{landing.workflowDescription}</p>
            <p className="workflow-reach">{landing.workflowReach}</p>
          </div>
        </div>
        <div className="terminal-demo">
          <div className="terminal-top">
            <span>
              <i></i>
              <i></i>
              <i></i>
            </span>
            <span>~/project</span>
            <span className="example-label">{landing.exampleSession}</span>
          </div>
          <div className="terminal-body" lang="en">
            <p className="workflow-step" lang={pageLang}>
              {landing.workflowSteps[0]}
            </p>
            <div className="terminal-command">
              <span className="prompt">$</span>
              <span>tmt this reviewer</span>
            </div>
            <p className="workflow-step" lang={pageLang}>
              {landing.workflowSteps[1]}
            </p>
            <div className="terminal-command">
              <span className="prompt">$</span>
              <span>
                tmt talk reviewer <span className="string">"Review this patch"</span> --detach
              </span>
              <button
                className="icon-button"
                id="copy-command"
                aria-label={landing.copyExample}
                title={landing.copyExample}
                type="button"
                onClick={() => copyExample()}
              >
                <img className="icon" src={asset4} alt="" />
              </button>
            </div>
            <div className="terminal-output">
              <span className="status-mark">↗</span> reviewer{" "}
              <span className="muted">· request sent</span>
              <br />
              <span className="indent muted">
                Keep working. Pick up the result when you're ready.
              </span>
            </div>
            <p className="workflow-step" lang={pageLang}>
              {landing.workflowSteps[2]}
            </p>
            <div className="terminal-command">
              <span className="prompt">$</span>
              <span>
                tmt result <span className="example-id">7f3a1c94</span>
              </span>
            </div>
            <div className="terminal-output terminal-reply">
              <span className="status-mark">✓</span> <span>reviewer</span>
              <span className="muted"> · completed</span>
              <div className="reply-text">
                Reviewed the patch.
                <br />
                One missing error path. See the review for details.
              </div>
            </div>
          </div>
          <div className="terminal-bottom">
            <span>
              <span className="signal"></span>
              {landing.exchangeLocal}
            </span>
            <span>{landing.exchangeFlow}</span>
          </div>
        </div>
        <div className="principles">
          <article>
            <img className="feature-icon" src={asset5} alt="" />
            <h3>{landing.keepToolsTitle}</h3>
            <p>{landing.keepToolsDescription}</p>
          </article>
          <article>
            <img className="feature-icon" src={asset6} alt="" />
            <h3>{landing.handoffTitle}</h3>
            <p>{landing.handoffDescription}</p>
          </article>
          <article>
            <img className="feature-icon" src={asset7} alt="" />
            <h3>{landing.closeLoopTitle}</h3>
            <p>{landing.closeLoopDescription}</p>
          </article>
        </div>
        <div className="workflow-install">
          <h3>{landing.installTitle}</h3>
          <p>{landing.installDescription}</p>
          <TopInstall />
        </div>
      </section>

      <section id="squad" className="study-product content rich-section">
        <div className="section-heading squad-heading">
          <div>
            <p className="eyebrow">{landing.opsEyebrow}</p>
            <h2>
              <span>Ops</span>
              <span className="squad-heading-line">{landing.opsTagline}</span>
            </h2>
          </div>
          <p>{landing.opsDescription}</p>
        </div>
        <div
          lang="en"
          id="squad-demo"
          className="rich-mock squad-board"
          aria-label="Illustrative multiple-squad management dashboard"
        >
          <div className="mock-toolbar">
            <span>
              <b className="tiny-mark">▚</b> tmt ops squad{" "}
              <span className="mock-muted">/ workspace</span>
            </span>
            <span className="mock-muted">ILLUSTRATIVE DATA</span>
          </div>
          <div className="team-overview">
            <div className="team-tile team-active">
              <div>
                <strong>launch</strong>
                <span>↗</span>
              </div>
              <p>
                3 members <span className="waiting-label">◆ 1 needs you</span>
              </p>
              <div className="team-tile-foot">
                <span className="working-label">● 2 working</span>
                <span>5m ~9.2k tok</span>
              </div>
            </div>
            <div className="team-tile">
              <div>
                <strong>research</strong>
                <span>↗</span>
              </div>
              <p>
                2 members <span className="working-label">● 2 working</span>
              </p>
              <div className="team-tile-foot">
                <span>exploring</span>
                <span>5m 4.6k tok</span>
              </div>
            </div>
            <div className="team-tile">
              <div>
                <strong>docs</strong>
                <span>↗</span>
              </div>
              <p>
                2 members <span className="error-label">✗ 1 blocked</span>
              </p>
              <div className="team-tile-foot">
                <span>reviewing</span>
                <span>5m 1.8k tok</span>
              </div>
            </div>
          </div>
          <div className="workspace-strip">
            <span>
              launch <b>/ MEMBERS</b>
            </span>
            <span>
              tokens · 5m <strong>~9.2k</strong>
              <small>1 without data</small>
            </span>
          </div>
          <div className="squad-layout">
            <div className="squad-work">
              <div className="board-summary">
                <div className="avatar">L</div>
                <div>
                  <strong>
                    lead <em>● working</em>
                  </strong>
                  <span>Prepare the next release</span>
                </div>
                <span className="small-tag">5m –</span>
              </div>
              <div className="board-labels">
                <span>MEMBER / TASK</span>
                <span>STATE · TOKENS / 5m</span>
              </div>
              <div className="board-row">
                <span className="row-index">01</span>
                <div>
                  <strong>
                    builder <em>Codex</em>
                  </strong>
                  <p>Build the release preview</p>
                </div>
                <span className="working-label">
                  ● working<strong className="token-reading">5.8k</strong>
                </span>
              </div>
              <div className="board-row waiting-row">
                <span className="row-index">02</span>
                <div>
                  <strong>
                    reviewer <em>Claude</em>
                  </strong>
                  <p>Check the narrow layout</p>
                  <div className="inline-request">
                    ◆ Ready for your review <span>↗</span>
                  </div>
                </div>
                <span className="waiting-label">
                  needs you<strong className="token-reading">3.4k</strong>
                </span>
              </div>
              <div className="board-row">
                <span className="row-index">03</span>
                <div>
                  <strong>
                    tester <em>Gemini</em>
                  </strong>
                  <p>Verify the keyboard flow</p>
                </div>
                <span className="mock-muted">
                  ○ ready<strong className="token-reading">0</strong>
                </span>
              </div>
              <div className="board-footer">
                <span>3 members + lead</span>
                <span>~ partial observed total</span>
              </div>
            </div>
            <aside className="lead-notes">
              <div className="panel-label">
                LEAD'S NOTES <span>↗</span>
              </div>
              <h3>
                The next step
                <br />
                is clear.
              </h3>
              <div className="note-line">
                <span>✓</span>
                <p>Scope agreed</p>
              </div>
              <div className="note-line">
                <span>✓</span>
                <p>Work assigned</p>
              </div>
              <div className="note-line active-note">
                <span>→</span>
                <p>Review the preview</p>
              </div>
              <div className="note-rule"></div>
              <p className="aside-note">you → lead → members</p>
              <div className="mini-avatars">
                <span>B</span>
                <span>R</span>
                <span>T</span>
              </div>
            </aside>
          </div>
        </div>
        <LocalLink className="study-chapter" to="/" hash="squad-demo">
          {landing.exploreOps} <span>↗</span>
        </LocalLink>
        <TopInstall command="tmt extension install ops" label={landing.installOps} />
      </section>
      <section id="colab" className="study-product content rich-section">
        <div className="section-heading colab-heading">
          <div>
            <p className="eyebrow">{landing.colabEyebrow}</p>
            <h2>
              <span>Colab</span>
              <span className="squad-heading-line">{landing.colabTagline}</span>
            </h2>
          </div>
          <p>
            {landing.colabDescription}
            <br />
            <small>{landing.colabNote}</small>
          </p>
        </div>
        <div
          lang="en"
          id="colab-demo"
          className="rich-mock document-board"
          aria-label="Concept illustration of browser annotation reaching a terminal agent and a reply returning to the same thread"
        >
          <div className="browser-chrome">
            <span className="browser-dots">● ● ●</span>
            <span>colab / release-plan</span>
            <span>↗</span>
          </div>
          <div className="mock-toolbar">
            <span>
              <b className="tiny-mark">▧</b> Release plan{" "}
              <span className="mock-muted">/ shared page</span>
            </span>
            <div className="collaborators">
              <span className="presence">B</span>
              <span className="presence agent-presence">A</span>
              <span className="mock-muted">CONCEPT PREVIEW</span>
            </div>
          </div>
          <div className="document-layout">
            <article className="shared-document">
              <div className="doc-kicker">PROJECT / LAUNCH</div>
              <h3>
                A smaller release.
                <br />A clearer first step.
              </h3>
              <p className="doc-intro">
                The plan, the conversation,
                <br />
                and the work — in one place.
              </p>
              <div className="document-divider"></div>
              <div className="doc-section-label">01 / RELEASE CHECKLIST</div>
              <p className="marked-line">
                Check the mobile layout before release.<sup>1</sup>
              </p>
              <div className="annotation-tooltip">
                ◇ Discuss <span>01</span>
              </div>
              <p className="editing-line">
                Keep the preview focused.<span className="edit-caret"></span>
                <span className="editor-tag">agent</span>
              </p>
              <div className="document-skeleton">
                <i></i>
                <i></i>
              </div>
              <div className="doc-check-row">
                <span>☑ Preview</span>
                <span>□ Mobile</span>
                <span>□ Release</span>
              </div>
              <div className="document-meta">
                <span>local ↔ remote · across harnesses</span>
                <span>↗</span>
              </div>
            </article>
            <aside className="document-comments">
              <div className="panel-label">
                ◇ Discussion <span>✓ &nbsp; ×</span>
              </div>
              <div className="comment-anchor">↳ Check the mobile layout before release.</div>
              <div className="comment-entry">
                <span className="comment-avatar">B</span>
                <div>
                  <strong>
                    you <small>browser</small>
                  </strong>
                  <p>
                    <span className="agent-mention">@reviewer</span> Can you check this at 390px?
                  </p>
                </div>
              </div>
              <div className="comment-entry agent-entry">
                <span className="comment-avatar">A</span>
                <div>
                  <strong>
                    reviewer <small>terminal</small>
                  </strong>
                  <p>
                    Checked at 390px.
                    <br />
                    The layout fits. No horizontal overflow.
                  </p>
                  <span className="comment-link">✓ Reply returned to this annotation</span>
                </div>
              </div>
              <div className="comment-compose">
                <span>Reply to reviewer…</span>
                <span>↑</span>
              </div>
            </aside>
          </div>
          <div className="terminal-bridge">
            <div className="terminal-bridge-heading">
              <span>
                <b>›_</b> reviewer / laptop
              </span>
              <span>TERMINAL</span>
            </div>
            <div className="terminal-bridge-content">
              <div>
                <span className="bridge-label">BROWSER → AGENT</span>
                <code>◆ ben · release-plan / annotation 01</code>
                <p>Can you check this at 390px?</p>
              </div>
              <div>
                <span className="bridge-label">AGENT → SAME THREAD</span>
                <code>✓ tmt reply · 7f3a1c94</code>
                <p>Checked at 390px. The layout fits.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="section-tail">
          <LocalLink className="study-chapter" to="/" hash="colab-demo">
            {landing.exploreColab} <span>↗</span>
          </LocalLink>
          <small>{landing.colabStatus}</small>
        </div>
        <TopInstall command="tmt extension install colab --skills" label={landing.installColab} />
      </section>

      <section id="start" className="start-section">
        <div className="content start-inner">
          <BrandMark size={78} />
          <p className="eyebrow">{landing.nextEyebrow}</p>
          <h2>{landing.nextTitle}</h2>
          <LocalLink className="button primary" to="/" hash="install">
            <span>{landing.getStarted}</span>
            <img className="icon" src={asset1} alt="" />
          </LocalLink>
        </div>
      </section>
      <div className="copy-status" role="status">
        {copied ? landing.commandCopied : ""}
      </div>
    </main>
  );
}
