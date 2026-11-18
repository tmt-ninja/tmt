import './page-outline.css';
import { ChevronDown, List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { text } from './strings.js';
import { useMedia } from './use-media.js';

/** A page's visible headings (structured blocks or HTML), kept in the trusted parent; the page view
 * and the shared reader (#6470) render it. */
export function PageOutline({
  headings,
  locate,
  compact = false,
}: {
  headings: readonly { id: string; title: string; level: number }[];
  locate(id: string): { top(): number; scrollTo(): void } | undefined;
  compact?: boolean;
}) {
  const phone = useMedia('(max-width: 640px)');
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
  }, [expanded, headings]);
  useEffect(() => {
    if (headings.length < 3) return;
    const update = () => {
      const bar = document.querySelector<HTMLElement>('.tmt-ui-shell-bar, .tmt-ui-header');
      const edge = (bar?.getBoundingClientRect().bottom ?? 0) + (innerWidth <= 640 ? 64 : 24);
      let active = 0;
      headings.forEach((heading, index) => {
        const node = locate(heading.id);
        if (node && node.top() <= edge) active = index;
      });
      setCurrent(active);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [headings, locate]);
  if (headings.length < 3) return null;
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
        <span className="page-outline-desktop">{text.outline}</span>
        <span className="page-outline-phone">{headings[current]?.title}</span>
        <span className="page-outline-count">
          {current + 1} / {headings.length}
        </span>
        <ChevronDown className="page-outline-chevron" data-expanded={expanded} aria-hidden="true" />
      </button>
      {expanded && (
        <ol className="page-outline-list" ref={list} data-more={more || undefined}>
          {headings.map((heading, index) => (
            <li key={heading.id} data-level={heading.level}>
              <button
                type="button"
                aria-current={index === current ? 'location' : undefined}
                onClick={() => {
                  const target = locate(heading.id);
                  setCurrent(index);
                  if (menu) {
                    setMenuOpen(false);
                    toggle.current?.focus();
                    target?.scrollTo();
                  } else if (innerWidth <= 640) {
                    setPreference(false);
                    try {
                      localStorage.setItem('tmt:colab:outline', 'closed');
                    } catch {
                      /* Optional preference. */
                    }
                    // Closing the phone list changes the target's position in the page.
                    requestAnimationFrame(() => target?.scrollTo());
                  } else target?.scrollTo();
                }}
              >
                {heading.title}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
