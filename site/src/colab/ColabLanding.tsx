import { useAtom } from "jotai";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Circle,
  FileText,
  Folder,
  MousePointer2,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useStrings } from "../lang/useStrings";
import { themeAtom } from "../state/theme";
import { SiteHeader, SiteFooter } from "../shared/SiteChrome.js";
import { landingChrome } from "../shared/landing-chrome.js";
import "./colab-landing.css";

// The feature sections, in order; their words are `colabLanding.features` in the strings.
const features = ["annotate", "agents", "collaborate", "organize"] as const;
const featureVisuals = {
  annotate: AnnotationVisual,
  agents: AgentsVisual,
  collaborate: CollaborationVisual,
  organize: OrganizationVisual,
};

// Each backend's command; its words are `colabLanding.deploy.backends` in the strings. The
// Firestore command only prints the deployment plan: `tmt remote deploy firestore --help`.
const backendCommands = {
  local: "tmt colab serve",
  firestore:
    "tmt remote deploy firestore --project <project-id> --region <region> --defaults --json",
  cloudflare: null,
  own: "tmt colab serve",
} as const;
type Backend = keyof typeof backendCommands;

/** Copy with one highlighted phrase: the words before it, the phrase, and the words after it. */
function Highlighted({
  copy,
  className,
}: {
  copy: { before: string; highlight: string; after: string };
  className: string;
}) {
  return (
    <>
      {copy.before}
      <mark className={className}>{copy.highlight}</mark>
      {copy.after}
    </>
  );
}

/** A title whose lines are separated by a newline in the strings. */
function Lines({ text }: { text: string }) {
  return text.split("\n").map((line, index) => (
    <span key={line}>
      {index > 0 && <br />}
      {line}
    </span>
  ));
}

function DemoHeader({ title, end }: { title: string; end?: string }) {
  return (
    <div className="cl-demo-header">
      <span className="cl-demo-icon">
        <FileText size={16} />
      </span>
      <strong>{title}</strong>
      {end && <span className="cl-demo-header-end">{end}</span>}
    </div>
  );
}

function Mention({ name, kind }: { name: string; kind: "agent" | "person" }) {
  const Icon = kind === "agent" ? Bot : UserRound;
  return (
    <span className={`cl-mention cl-mention-${kind}`} aria-label={`@${name}, ${kind}`}>
      <Icon size={12} aria-hidden="true" />@{name}
    </span>
  );
}

function MentionPicker({ selected }: { selected: "agent" | "person" }) {
  return (
    <span className="cl-compose-autocomplete" aria-hidden="true">
      <span className={`cl-picker-option ${selected === "agent" ? "cl-picker-selected" : ""}`}>
        <Bot size={12} /> <b>reviewer</b> <small>agent</small>
      </span>
      <span className={`cl-picker-option ${selected === "person" ? "cl-picker-selected" : ""}`}>
        <UserRound size={12} /> <b>Ben</b> <small>person</small>
      </span>
    </span>
  );
}

function SelectedSentence({ variant }: { variant: "annotation" | "agent" }) {
  return (
    <p className={`cl-demo-selection cl-demo-selection-${variant}`}>
      Check the mobile layout before release.
      <span className="cl-selection-drag-caret" aria-hidden="true" />
      <span className="cl-selection-pin" aria-hidden="true">
        +
      </span>
      {variant === "annotation" && (
        <MousePointer2 className="cl-demo-pointer" size={18} aria-hidden="true" />
      )}
    </p>
  );
}

function TypedRun({
  phase,
  children,
  label,
}: {
  phase: "agent" | "person" | "collab";
  children: string;
  label?: string;
}) {
  return (
    <span className={`cl-typed-run cl-typed-run-${phase}`}>
      <span className="cl-typed-text">{children}</span>
      <span className="cl-typed-caret" aria-hidden="true">
        {label && <span>{label}</span>}
      </span>
    </span>
  );
}

function AnnotationVisual() {
  return (
    <div
      className="cl-visual cl-annotation-visual"
      aria-label="A selected sentence with an annotation being composed beside it"
    >
      <DemoHeader title="Launch brief" end="Private · Live" />
      <div className="cl-annotation-body">
        <div className="cl-sample-document">
          <p className="cl-overline">PROJECT / LAUNCH</p>
          <h3>
            A smaller release.
            <br />A clearer first step.
          </h3>
          <p>The plan, the conversation, and the work stay in one place.</p>
          <div className="cl-sample-rule" />
          <p className="cl-overline">01 / RELEASE CHECKLIST</p>
          <div className="cl-selection-anchor">
            <SelectedSentence variant="annotation" />
            <div className="cl-annotation-composer">
              <span className="cl-compose-caption">ANNOTATE THE SELECTION</span>
              <p className="cl-compose-draft">
                <span className="cl-compose-line cl-compose-line-agent">
                  <span className="cl-compose-query" aria-hidden="true">
                    @
                  </span>
                  <span className="cl-compose-mention">
                    <Mention name="reviewer" kind="agent" />
                  </span>
                  <TypedRun phase="agent"> check 390px.</TypedRun>
                  <MentionPicker selected="agent" />
                </span>
                <span className="cl-compose-line cl-compose-line-person">
                  <span className="cl-compose-query" aria-hidden="true">
                    @
                  </span>
                  <span className="cl-compose-mention">
                    <Mention name="Ben" kind="person" />
                  </span>
                  <TypedRun phase="person"> review copy?</TypedRun>
                  <MentionPicker selected="person" />
                </span>
              </p>
              <div className="cl-annotation-compose-footer">
                <span>Attached to this sentence</span>
                <span className="cl-compose-send" aria-label="Send annotation preview">
                  <ArrowRight size={16} />
                </span>
              </div>
            </div>
          </div>
          <p>Keep the preview focused.</p>
          <p>Share the decision with the team.</p>
        </div>
      </div>
    </div>
  );
}

function AgentsVisual() {
  return (
    <div
      className="cl-visual cl-agents-visual"
      aria-label="Illustrated sequence: select text, mention an agent and a teammate, then receive both replies"
    >
      <DemoHeader title="Launch brief" end="Live discussion" />
      <div className="cl-agent-demo-grid">
        <div className="cl-agent-document">
          <p className="cl-overline">SHARED DOCUMENT</p>
          <h3>Launch brief</h3>
          <p>One place to plan the release together.</p>
          <div className="cl-sample-rule" />
          <p className="cl-overline">01 / RELEASE CHECKLIST</p>
          <SelectedSentence variant="agent" />
          <p className="cl-agent-document-note">The discussion starts on this sentence.</p>
        </div>
        <div className="cl-agent-thread">
          <div className="cl-agent-thread-heading">
            <p className="cl-overline">ANNOTATION / 01</p>
            <span>2 people · 1 agent</span>
          </div>
          <div className="cl-scene-message cl-scene-user">
            <div className="cl-scene-author">
              <span className="cl-scene-avatar">Y</span>
              <b>You</b>
              <small>annotated this line</small>
            </div>
            <p>
              <Mention name="reviewer" kind="agent" /> check 390px.{" "}
              <Mention name="Ben" kind="person" />
              review the copy?
            </p>
          </div>
          <div className="cl-scene-message cl-scene-agent">
            <div className="cl-scene-author">
              <span className="cl-scene-avatar cl-scene-avatar-agent">
                <Bot size={13} />
              </span>
              <b>reviewer</b>
              <small>agent</small>
            </div>
            <p>The layout fits at 390px. I left a note on the selection.</p>
          </div>
          <div className="cl-scene-message cl-scene-person">
            <div className="cl-scene-author">
              <span className="cl-scene-avatar cl-scene-avatar-person">
                <UserRound size={13} />
              </span>
              <b>Ben</b>
              <small>teammate</small>
            </div>
            <p>Copy looks good. Let’s keep the first step focused.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CollaborationVisual() {
  return (
    <div
      className="cl-visual cl-collaboration-visual"
      aria-label="Illustrated sequence: Ben reviews a task, then Maya edits the shared document"
    >
      <DemoHeader title="Release plan" end="Live document" />
      <div className="cl-collaboration-body">
        <div className="cl-editor-sample">
          <div className="cl-presence-line">
            <span className="cl-live-dot" /> Live on this page
            <span className="cl-avatar cl-collab-avatar-ben" aria-label="Ben is here">
              B
            </span>
            <span
              className="cl-avatar cl-avatar-alt cl-collab-avatar-maya"
              aria-label="Maya is here"
            >
              M
            </span>
          </div>
          <p className="cl-overline">STUDIO / Q4</p>
          <h3>Release plan</h3>
          <p>One document everyone can return to.</p>
          <div className="cl-sample-rule" />
          <p className="cl-collab-review-line">
            <Check size={16} /> Review the scope <span className="cl-collab-review-by">Ben</span>
          </p>
          <p>
            <Check size={16} /> Agree on the first cut
          </p>
          <p className="cl-editing-line" aria-label="Maya is editing">
            <Circle size={16} />
            <TypedRun phase="collab" label="Maya">
              Polish the mobile page
            </TypedRun>
          </p>
        </div>
        <div className="cl-activity-sample">
          <p className="cl-overline">IN THE DOCUMENT</p>
          <div className="cl-activity-entry cl-activity-ben">
            <span className="cl-activity-avatar">B</span>
            <div>
              <strong>Ben reviewed the scope</strong>
              <span>Ready for the first cut.</span>
              <small>Just now</small>
            </div>
          </div>
          <div className="cl-activity-entry cl-activity-maya">
            <span className="cl-activity-avatar cl-activity-avatar-maya">M</span>
            <div>
              <strong>Maya updated the plan</strong>
              <span>The change appears here for everyone with access.</span>
              <small>Live edit</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrganizationVisual() {
  return (
    <div
      className="cl-visual cl-organization-visual"
      aria-label="Pages and a project plan with checklist and decision"
    >
      <DemoHeader title="Studio pages" end="Pages" />
      <div className="cl-organization-body">
        <aside className="cl-page-list">
          <p className="cl-overline">PAGES</p>
          <div className="cl-page-row cl-page-row-active">
            <FileText size={16} />
            <span>Launch plan</span>
            <ChevronRight size={15} />
          </div>
          <div className="cl-page-row">
            <FileText size={16} />
            <span>Design review</span>
          </div>
          <div className="cl-page-row">
            <FileText size={16} />
            <span>Decision log</span>
          </div>
          <div className="cl-labels">
            <Folder size={15} /> design <span>3 pages</span>
          </div>
        </aside>
        <div className="cl-plan-sample">
          <p className="cl-overline">PROJECT / LAUNCH</p>
          <h3>Launch plan</h3>
          <p>Keep the brief, decisions, and next steps together.</p>
          <div className="cl-sample-rule" />
          <p className="cl-overline">NEXT STEPS</p>
          <div className="cl-plan-row">
            <Check size={16} /> Agree on scope <span>Done</span>
          </div>
          <div className="cl-plan-row">
            <Circle size={16} /> Check the mobile layout <span>In review</span>
          </div>
          <div className="cl-plan-row">
            <Circle size={16} /> Share the release note <span>Next</span>
          </div>
          <div className="cl-decision-sample">
            <b>Decision</b>
            <span>Ship the focused first cut.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// The install commands, in order; their labels are `colabLanding.install.steps` in the strings.
const install = [
  "curl -fsSL https://github.com/pj-tmt/tmt/releases/latest/download/install.sh | sh",
  "tmt extension install colab --skills",
  "tmt colab serve",
  'tmt colab page create --title "Launch plan" --layout column',
];

export function ColabLanding() {
  const { colabLanding: words } = useStrings();
  const [backend, setBackend] = useState<Backend>("local");
  const selectedBackend = words.deploy.backends[backend];
  const selectedCommand = backendCommands[backend];
  const chrome = landingChrome("~/colab");
  const [theme, setTheme] = useAtom(themeAtom);
  return (
    <div className="colab-landing">
      <SiteHeader config={chrome}>
        <button
          type="button"
          aria-label={words.changeTheme}
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </SiteHeader>

      <main>
        <section className="cl-hero" aria-labelledby="cl-hero-title">
          <div className="cl-hero-copy">
            <p className="cl-overline">{words.overline}</p>
            <h1 id="cl-hero-title">
              <Lines text={words.title} />
            </h1>
            <p>
              {words.intro.before}
              <span className="cl-hero-highlight">{words.intro.highlight}</span>
              {words.intro.after}
            </p>
            <div className="cl-hero-actions">
              <a className="cl-primary-link" href="#annotate">
                {words.explore} <ArrowDown size={17} />
              </a>
              <a className="cl-secondary-link" href="#install">
                {words.installAndUse} <ArrowRight size={16} />
              </a>
            </div>
          </div>
          <div className="cl-hero-visual">
            <AnnotationVisual />
          </div>
        </section>

        <nav className="cl-feature-index" aria-label={words.featureIndex}>
          {features.map((id, index) => (
            <a key={id} href={`#${id}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{words.features[index].label}</b>
              <ArrowRight size={16} />
            </a>
          ))}
        </nav>

        {features.map((id, index) => {
          const feature = words.features[index];
          const Visual = featureVisuals[id];
          const next = features[index + 1] ?? "install";
          return (
            <section key={id} className="cl-feature" id={id} aria-labelledby={`cl-${id}-title`}>
              <div className="cl-feature-copy">
                <span className="cl-feature-number">
                  {String(index + 1).padStart(2, "0")} / {String(features.length).padStart(2, "0")}
                </span>
                <h2 id={`cl-${id}-title`}>
                  {feature.title}
                  {feature.harness && <span className="cl-harness-heading">{feature.harness}</span>}
                </h2>
                <p>
                  <Highlighted copy={feature.copy} className="cl-copy-highlight" />
                </p>
                <a href={`#${next}`}>
                  {feature.next} <ArrowRight size={16} />
                </a>
              </div>
              <Visual />
            </section>
          );
        })}

        <section className="cl-install" id="install" aria-labelledby="cl-install-title">
          <div className="cl-install-intro">
            <span className="cl-feature-number">{words.install.eyebrow}</span>
            <h2 id="cl-install-title">{words.install.title}</h2>
            <p>
              <Highlighted copy={words.install.copy} className="cl-copy-highlight" />
            </p>
          </div>
          <ol className="cl-install-steps">
            {install.map((command, index) => (
              <li key={command}>
                <span className="cl-install-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{words.install.steps[index]}</h3>
                  <code>{command}</code>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="cl-deploy" id="deploy" aria-labelledby="cl-deploy-title">
          <div className="cl-deploy-intro">
            <span className="cl-feature-number">{words.deploy.eyebrow}</span>
            <h2 id="cl-deploy-title">{words.deploy.title}</h2>
            <p>
              <Highlighted copy={words.deploy.copy} className="cl-copy-highlight" />
            </p>
          </div>
          <div className="cl-deploy-details">
            <div className="cl-backend-tabs" role="tablist" aria-label={words.deploy.backendTabs}>
              {(Object.keys(backendCommands) as Backend[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={"cl-backend-tab-" + key}
                  aria-controls="cl-backend-panel"
                  aria-selected={backend === key}
                  onClick={() => setBackend(key)}
                >
                  {words.deploy.backends[key].label}
                </button>
              ))}
            </div>
            <div
              className="cl-backend-panel"
              role="tabpanel"
              id="cl-backend-panel"
              aria-labelledby={"cl-backend-tab-" + backend}
            >
              <div className="cl-deploy-command">
                <span className="cl-overline">{selectedBackend.commandLabel}</span>
                {selectedCommand ? (
                  <code>{selectedCommand}</code>
                ) : (
                  <p className="cl-deploy-unavailable">{words.deploy.noCommand}</p>
                )}
                <p>{selectedBackend.note}</p>
                {backend === "own" && (
                  <p>
                    {words.deploy.ownReferences.before}
                    <a href="https://github.com/pj-tmt/tmt/tree/main/.agents/skills/tmt-remote/references">
                      {words.deploy.ownReferences.backend}
                    </a>
                    {words.deploy.ownReferences.middle}
                    <a href="https://github.com/pj-tmt/tmt/blob/main/extensions/tmt-colab/skills/tmt-colab/SKILL.md">
                      {words.deploy.ownReferences.skill}
                    </a>
                    {words.deploy.ownReferences.after}
                  </p>
                )}
              </div>
              <table className="cl-capability-table">
                <caption>
                  {selectedBackend.label} · {selectedBackend.status}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{words.deploy.capability}</th>
                    <th scope="col">{words.deploy.colabStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {words.deploy.capabilities.map((capability, index) => (
                    <tr key={capability}>
                      <th scope="row">{capability}</th>
                      <td>{selectedBackend.capabilities[index]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cl-deploy-note">{words.deploy.note}</p>
          </div>
        </section>
      </main>
      <SiteFooter config={chrome} />
    </div>
  );
}
