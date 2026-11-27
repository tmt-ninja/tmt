import './page-outline.css';
import { ChevronDown, List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { text } from './strings.js';
import { useMedia } from './use-media.js';
import type { SectionSummary } from './bootstrap.js';
import { sectionMark, sectionTotals } from './section-view.js';

/** A page's visible headings (structured blocks or HTML), kept in the trusted parent; the page view
 * and the shared reader (#6470) render it. */
export function PageOutline({
  headings,
  locate,
  compact = false,
  sections,
  collapsedRail = false,
}: {
  headings: readonly { id: string; title: string; level: number }[];
  locate(id: string): { top(): number; scrollTo(keyboard: boolean): void } | undefined;
  compact?: boolean;
  /** The page's counted sections by heading ID (#6619): a mark and count beside each, and the
   * total in the title row. A heading without one is an explanatory heading and gets no mark. */
  sections?: readonly SectionSummary[];
  /** The shell around the page has its side menu collapsed (#6833): on a wide screen the outline is
   * a strip of bars at the right edge that floats the whole list while a pointer is over it. */
  collapsedRail?: boolean;
}) {
  const bySection = new Map((sections ?? []).map((section) => [section.id, section]));
  const totals = sections?.length ? sectionTotals(sections) : undefined;
  const phone = useMedia('(max-width: 640px)');
  const wide = useMedia('(min-width: 901px)');
  const strip = collapsedRail && wide;
  const [floating, setFloating] = useState(false);
  const stripButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!strip) setFloating(false);
  }, [strip]);
  const [preference, setPreference] = useState<boolean | undefined>(() => {
    try {
      const saved = localStorage.getItem('tmt:colab:outline');
      return saved === null ? undefined : saved === 'open';
    } catch {
      return undefined;
    }
  });
  // Without the gutter (a compact HTML outline above the phone width) the list is a transient
  // menu under its top-bar button: it opens only on a click, closes on a pick, Escape or a click
  // outside, and is never restored open. The remembered state applies to the gutter and the phone
  // bar (#6470).
  const menu = compact && !phone;
  const [menuOpen, setMenuOpen] = useState(false);
  const expanded = menu ? menuOpen : (preference ?? (!phone && !compact));
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu || !menuOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggle.current?.focus();
    };
    const pointerdown = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    // A click in the page's own frame reaches only the frame; the parent sees its window lose focus.
    const blur = () => setMenuOpen(false);
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown, true);
      window.removeEventListener('blur', blur);
    };
  }, [menu, menuOpen]);
  const [current, setCurrent] = useState(0);
  const jump = useRef<{
    id: string;
    headingTop: number;
    settledAt?: number;
    timer?: number;
  } | null>(null);
  useEffect(() => () => window.clearTimeout(jump.current?.timer), []);
  // A click leaves the toggle focused without a frame, until the keyboard is used on it.
  const [pointer, setPointer] = useState(false);
  // Whether more of a long list is below its visible part, which the bottom edge fades.
  const list = useRef<HTMLOListElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => setMore(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, [expanded, floating, headings]);
  useEffect(() => {
    if (headings.length < 3) return;
    const update = () => {
      const root = document.documentElement;
      const end =
        root.scrollHeight > innerHeight + 1 && scrollY + innerHeight >= root.scrollHeight - 2;
      const selection = jump.current;
      if (selection) {
        const index = headings.findIndex((heading) => heading.id === selection.id);
        const top = locate(selection.id)?.top();
        // The heading can also move inside a frame without changing the window's scroll position.
        const moved =
          selection.settledAt !== undefined &&
          (Math.abs(scrollY - selection.settledAt) > 2 ||
            (top !== undefined && Math.abs(top - selection.headingTop) > 2));
        // Keep the clicked heading at the landing position even if rounding put it below the edge.
        // At the document bottom, the normal end rule picks the last heading in view.
        const landedAtEnd = end && selection.settledAt !== undefined;
        if (index >= 0 && !moved && !landedAtEnd) {
          if (top !== undefined && selection.settledAt === undefined) selection.headingTop = top;
          setCurrent(index);
          return;
        }
        window.clearTimeout(selection.timer);
        jump.current = null;
      }
      const bar = document.querySelector<HTMLElement>('.tmt-ui-shell-bar, .tmt-ui-header');
      const edge = (bar?.getBoundingClientRect().bottom ?? 0) + (innerWidth <= 640 ? 64 : 24);
      let active = 0;
      headings.forEach((heading, index) => {
        const node = locate(heading.id);
        if (node && node.top() <= edge) active = index;
      });
      // A short last section never reaches the edge: once the page is scrolled to its end, the last
      // heading in view is current, so jumping to it marks it (#6833).
      if (end)
        headings.forEach((heading, index) => {
          const node = locate(heading.id);
          if (node && node.top() < innerHeight) active = Math.max(active, index);
        });
      setCurrent(active);
    };
    const settle = () => {
      const selection = jump.current;
      if (selection && selection.settledAt === undefined) {
        window.clearTimeout(selection.timer);
        selection.headingTop = locate(selection.id)?.top() ?? selection.headingTop;
        selection.settledAt = scrollY;
        update();
      }
    };
    const release = () => {
      if (jump.current === null) return;
      window.clearTimeout(jump.current.timer);
      jump.current = null;
      update();
    };
    const onScroll = () => {
      const selection = jump.current;
      // A real scroll settles at scrollend, even when the animation outlasts the no-scroll timer.
      if (selection?.timer !== undefined) {
        window.clearTimeout(selection.timer);
        selection.timer = undefined;
      }
      update();
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    document.addEventListener('scrollend', settle);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', release);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      document.removeEventListener('scrollend', settle);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', release);
    };
  }, [headings, locate]);
  if (headings.length < 3) return null;
  // One list of headings: in the column, the phone bar, the compact menu and the strip's float.
  function rows() {
    return (
      <ol className="page-outline-list" ref={list} data-more={more || undefined}>
        {headings.map((heading, index) => (
          <li key={heading.id} data-level={heading.level}>
            <button
              type="button"
              title={heading.title}
              aria-current={index === current ? 'location' : undefined}
              onClick={(event) => {
                const keyboard = event.detail === 0;
                const target = locate(heading.id);
                const scrollToHeading = () => {
                  setCurrent(index);
                  if (!target) return;
                  window.clearTimeout(jump.current?.timer);
                  jump.current = {
                    id: heading.id,
                    headingTop: target.top(),
                    // A jump to the current position may produce no scrollend.
                    timer: window.setTimeout(() => {
                      if (jump.current) jump.current.settledAt = scrollY;
                    }, 500),
                  };
                  target.scrollTo(keyboard);
                };
                if (strip) {
                  setFloating(false);
                  if (keyboard) stripButton.current?.focus();
                  scrollToHeading();
                } else if (menu) {
                  setMenuOpen(false);
                  toggle.current?.focus();
                  scrollToHeading();
                } else if (innerWidth <= 640) {
                  setPreference(false);
                  try {
                    localStorage.setItem('tmt:colab:outline', 'closed');
                  } catch {
                    /* Optional preference. */
                  }
                  // Let the phone list close before starting the jump and tracking its scroll.
                  requestAnimationFrame(scrollToHeading);
                } else scrollToHeading();
              }}
            >
              <OutlineRow title={heading.title} section={bySection.get(heading.id)} />
            </button>
          </li>
        ))}
      </ol>
    );
  }
  if (strip) {
    const close = (refocus: boolean) => {
      setFloating(false);
      if (refocus) stripButton.current?.focus();
    };
    return (
      <nav
        className="page-outline"
        data-strip=""
        aria-label={text.pageOutline}
        ref={nav}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') setFloating(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch' && !nav.current?.contains(document.activeElement))
            setFloating(false);
        }}
        onBlur={(event) => {
          if (!nav.current?.contains(event.relatedTarget as Node | null)) setFloating(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && floating) close(true);
        }}
      >
        <button
          ref={stripButton}
          type="button"
          className="page-outline-strip"
          aria-expanded={floating}
          aria-label={
            totals
              ? `${text.outline}, ${text.sections.outlineSummary(totals.done, totals.total)}`
              : text.outline
          }
          // A pointer's hover has opened it already; a key toggles it.
          onClick={(event) => setFloating(event.detail === 0 ? !floating : true)}
        >
          {headings.map((heading, index) => (
            <span
              key={heading.id}
              className="page-outline-bar"
              data-level={heading.level >= 3 ? 3 : 2}
              data-state={barState(bySection.get(heading.id))}
              data-current={index === current ? '' : undefined}
            />
          ))}
        </button>
        {floating && (
          <div className="page-outline-float">
            <div className="page-outline-float-head">
              {text.outline}
              {totals && (
                <span className="page-outline-progress">
                  {text.sections.outlineSummary(totals.done, totals.total)}
                </span>
              )}
            </div>
            {rows()}
          </div>
        )}
      </nav>
    );
  }
  return (
    <nav className="page-outline" aria-label={text.pageOutline} ref={nav}>
      <button
        ref={toggle}
        type="button"
        className="page-outline-toggle"
        aria-label={compact && !phone ? text.outline : undefined}
        aria-expanded={expanded}
        data-pointer={pointer || undefined}
        onPointerDown={() => setPointer(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setPointer(false);
        }}
        onBlur={() => setPointer(false)}
        onClick={() => {
          if (menu) {
            setMenuOpen(!menuOpen);
            return;
          }
          const next = !expanded;
          setPreference(next);
          try {
            localStorage.setItem('tmt:colab:outline', next ? 'open' : 'closed');
          } catch {
            /* The page stays usable without storage. */
          }
        }}
      >
        <List className="page-outline-icon" aria-hidden="true" />
        <span className="page-outline-desktop">
          {text.outline}
          {totals && (
            <span className="page-outline-progress">
              {' · '}
              {text.sections.outlineSummary(totals.done, totals.total)}
            </span>
          )}
        </span>
        <span className="page-outline-phone">{headings[current]?.title}</span>
        <span className="page-outline-count">
          {current + 1} / {headings.length}
        </span>
        <ChevronDown className="page-outline-chevron" data-expanded={expanded} aria-hidden="true" />
      </button>
      {expanded && rows()}
    </nav>
  );
}

/** One outline row: the section's mark, its title and its count; a plain heading has only its
 * title, indented as if it had a mark so titles line up. */
function OutlineRow({ title, section }: { title: string; section?: SectionSummary }) {
  if (!section) return <span className="page-outline-title">{title}</span>;
  const view = sectionMark(section);
  return (
    <>
      <span
        className="tmt-ui-state-mark page-outline-mark"
        data-shape={view.shape}
        data-tone={view.tone}
        aria-hidden="true"
      />
      <span className="page-outline-title">{title}</span>
      {/* The narrow gutter keeps the count; the mark's shape and tone say the state, named here. */}
      <span className="page-outline-section-count" title={view.word}>
        {view.short}
        <span className="tmt-ui-visually-hidden">, {view.word}</span>
      </span>
    </>
  );
}

/** A strip bar's state (#6833): done filled, in progress half, needs you or blocked in their tone,
 * not started (or a plain heading) grey. */
function barState(section?: SectionSummary): 'done' | 'half' | 'waiting' | 'blocked' | 'none' {
  if (!section) return 'none';
  const { state } = section;
  if (state === 'done') return 'done';
  if (state === 'needs-you') return 'waiting';
  if (state === 'blocked') return 'blocked';
  if (state === 'not-started' || state === 'unchecked') return 'none';
  return 'half';
}
