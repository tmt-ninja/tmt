import { useLayoutEffect, type RefObject } from 'react';
import { PANEL_CARD_MIN_WIDTH } from './panel-mode.js';

const stageSelector = '.structured-page-stage';
const markersSelector = '.structured-annotation-markers';
const stripSelector = '.page-outline-strip';
const layoutSelectors = [stageSelector, markersSelector, stripSelector].join(',');
const gap = 8;
const minimumColumn = 320;

/** Keep block markers outside the non-modal Discussion card. */
export function useStructuredDiscussionLayout(
  workspace: RefObject<HTMLDivElement | null>,
  open: boolean,
) {
  useLayoutEffect(() => {
    const area = workspace.current;
    if (!open || !area) return;
    const card = area.querySelector<HTMLElement>(
      '[data-panel="comments"][data-floating-discussion]',
    );
    if (!card) return;

    const clear = () => {
      delete area.dataset.discussionSpace;
      area.style.removeProperty('--discussion-outline-offset');
      area.style.removeProperty('--discussion-column-width');
      area.style.removeProperty('--discussion-column-start');
      area.style.removeProperty('--discussion-scroll-clearance');
    };
    const place = () => {
      // Read the unreserved layout, then apply any needed reservation before painting.
      clear();
      const stage = area.querySelector<HTMLElement>(stageSelector);
      if (!stage || card.hidden) return;
      const column = stage.getBoundingClientRect();
      const strip = area.querySelector<HTMLElement>(stripSelector);
      if (strip) {
        const offset =
          card.getBoundingClientRect().right - strip.getBoundingClientRect().left + gap;
        if (offset > 0) area.style.setProperty('--discussion-outline-offset', `${offset}px`);
      }
      const cardBounds = card.getBoundingClientRect();
      const markers = Array.from(stage.querySelectorAll(markersSelector), (row) =>
        row.getBoundingClientRect(),
      );
      const markerEnd = Math.max(...markers.map(({ right }) => right));
      if (markerEnd + gap <= cardBounds.left) return;
      // A narrower column can move a nested marker to the outer lane.
      const lane = Math.max(markerEnd - column.right, ...markers.map(({ width }) => width + gap));
      const available = cardBounds.left - column.left - lane - gap;
      if (
        window.innerWidth < PANEL_CARD_MIN_WIDTH ||
        available < Math.min(column.width, minimumColumn)
      ) {
        area.dataset.discussionSpace = 'below';
        area.style.setProperty(
          '--discussion-scroll-clearance',
          `${Math.max(0, window.innerHeight - card.getBoundingClientRect().top)}px`,
        );
        return;
      }
      // Keep the outline column and the centred stage's original starting edge: the stage is centred
      // whenever the strip's lane is held, with or without the strip drawn in it (#6951).
      const centred = area.querySelector('.page-outline[data-strip]');
      const offset = centred ? column.left - stage.parentElement!.getBoundingClientRect().left : 0;
      area.dataset.discussionSpace = 'beside';
      area.style.setProperty('--discussion-column-width', `${available}px`);
      area.style.setProperty('--discussion-column-start', `${offset}px`);
    };

    // Measure outside the resize delivery cycle.
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
    };
    // The stage can arrive after the card. Observe only changes that affect their separation.
    const mutations = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            change.target === card ||
            (change.target instanceof Element && change.target.matches(markersSelector)) ||
            [...change.addedNodes, ...change.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(layoutSelectors) || !!node.querySelector(layoutSelectors)),
            ),
        )
      )
        schedule();
    });
    let width = area.clientWidth;
    const resize = new ResizeObserver(() => {
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      schedule();
    });
    mutations.observe(area, { childList: true, subtree: true });
    mutations.observe(card, { attributes: true, attributeFilter: ['style'] });
    resize.observe(area);
    window.addEventListener('resize', schedule);
    place();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      clear();
    };
  }, [workspace, open]);
}
