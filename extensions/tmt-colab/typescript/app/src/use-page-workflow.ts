import { useEffect, useRef, useState } from 'react';
import { onPage } from './work-band-live.js';
import { runPageOperations, type PageOperation } from './page-operations.js';
import { operationStatus } from './page-operation-status.js';
import { rememberPages } from './quick-switcher-source.js';
import { SaveNotApplied, SaveRefused } from './save.js';
import { text } from './strings.js';
import type { PageSnapshot, PageSummary, PageTransport, PageView } from './transport.js';
import { moveBetweenParents, parentRefusal } from './work-tree.js';

/** The open page's owner operations and their verified/uncertain outcomes. */
export function usePageWorkflow(
  transport: PageTransport,
  snapshot: PageSnapshot,
  view: PageView,
  space?: string,
) {
  const [verifiedArchive, setVerifiedArchive] = useState<{ pageId: string; value: boolean }>();
  const archiveOverride =
    verifiedArchive?.pageId === snapshot.id ? verifiedArchive.value : undefined;
  const archived = archiveOverride ?? view.archived ?? snapshot.archived ?? false;
  const wasArchived = useRef(archived);
  const [archiveAnnouncement, setArchiveAnnouncement] = useState('');
  const [pageOperation, setPageOperation] = useState<PageOperation>();
  const [pageOperationBusy, setPageOperationBusy] = useState(false);
  const [pageOperationNotice, setPageOperationNotice] = useState<{
    text: string;
    failed: boolean;
  }>();
  const [choosingParent, setChoosingParent] = useState(false);
  const [parentPages, setParentPages] = useState<readonly PageSummary[]>();
  const [moveFailure, setMoveFailure] = useState<{ target: string; title: string }>();
  const [moveUncertain, setMoveUncertain] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const activePage = useRef(snapshot.id);
  const pageGeneration = useRef(0);
  const moveLock = useRef(false);
  const operationLock = useRef(false);
  if (activePage.current !== snapshot.id) {
    activePage.current = snapshot.id;
    pageGeneration.current += 1;
    moveLock.current = false;
    operationLock.current = false;
  }
  const generation = pageGeneration.current;
  const isCurrent = () => pageGeneration.current === generation;
  useEffect(() => {
    if (archiveOverride !== undefined && view.archived === archiveOverride)
      setVerifiedArchive(undefined);
  }, [archiveOverride, view.archived]);
  useEffect(() => {
    if (archived && !wasArchived.current) setArchiveAnnouncement(text.archiveAnnouncement);
    wasArchived.current = archived;
  }, [archived]);
  useEffect(() => {
    setChoosingParent(false);
    setMoveFailure(undefined);
    setMoveUncertain(false);
    setMoveBusy(false);
    setPageOperation(undefined);
    setPageOperationBusy(false);
    setPageOperationNotice(undefined);
  }, [snapshot.id]);
  useEffect(() => {
    if (!choosingParent) return;
    const abort = new AbortController();
    setParentPages(undefined);
    transport.spaceHome(abort.signal).then(
      (home) => {
        if (!abort.signal.aborted) setParentPages(home.pages);
      },
      () => {
        if (!abort.signal.aborted) setParentPages(undefined);
      },
    );
    return () => abort.abort();
  }, [choosingParent, transport]);
  const attachToParent = async (target: string) => {
    await onPage(transport, target, async (binding) => {
      if (!binding.work) throw new Error('This page cannot be changed here.');
      await binding.work('subpage.attach', { pageId: snapshot.id });
    });
  };
  const refreshParentPages = async () => {
    const home = await transport.spaceHome();
    rememberPages(transport, space, home.pages);
    if (isCurrent()) setParentPages(home.pages);
    return home.pages;
  };
  const movePage = async (target: string, title: string): Promise<string | undefined> => {
    if (moveLock.current) return text.workBand.moveUnknown;
    moveLock.current = true;
    setMoveBusy(true);
    try {
      const pages = await refreshParentPages();
      if (!isCurrent()) return undefined;
      const current = pages.find((page) => page.id === snapshot.id);
      if (
        !current ||
        !pages.some((page) => page.id === target && !page.archived && page.pageType !== 'shell') ||
        parentRefusal(snapshot.id, target, pages)
      )
        return text.workBand.moveUnknown;
      const result = await moveBetweenParents(
        current.summary?.parent?.page,
        target,
        async (parent, action) => {
          await onPage(transport, parent, async (binding) => {
            if (!binding.work) throw new Error('This page cannot be changed here.');
            await binding.work(action, { pageId: snapshot.id });
          });
        },
      );
      if (!isCurrent()) return undefined;
      if (result === 'attached') {
        setMoveFailure(undefined);
        setMoveUncertain(false);
        await refreshParentPages().catch(() => {});
        return undefined;
      }
      if (result === 'detached') {
        const latest = await refreshParentPages();
        if (!isCurrent()) return undefined;
        const now = latest.find((page) => page.id === snapshot.id);
        if (!now || now.summary?.parent) return text.workBand.moveUnknown;
        setMoveFailure({ target, title });
        setMoveUncertain(false);
        return undefined;
      }
      return text.workBand.moveUnknown;
    } catch {
      return text.workBand.moveUnknown;
    } finally {
      if (isCurrent()) {
        moveLock.current = false;
        setMoveBusy(false);
      }
    }
  };
  const retryMove = async () => {
    if (!moveFailure || moveLock.current) return;
    moveLock.current = true;
    setMoveBusy(true);
    try {
      const pages = await refreshParentPages();
      if (!isCurrent()) return;
      const current = pages.find((page) => page.id === snapshot.id);
      if (current?.summary?.parent?.page === moveFailure.target) {
        setMoveFailure(undefined);
        return;
      }
      if (
        !current ||
        current.summary?.parent ||
        !pages.some(
          (page) => page.id === moveFailure.target && !page.archived && page.pageType !== 'shell',
        ) ||
        parentRefusal(snapshot.id, moveFailure.target, pages)
      ) {
        setMoveFailure(undefined);
        setMoveUncertain(true);
        return;
      }
      await attachToParent(moveFailure.target);
      if (!isCurrent()) return;
      setMoveFailure(undefined);
      await refreshParentPages().catch(() => {});
    } catch (failure) {
      if (!isCurrent()) return;
      if (!(failure instanceof SaveRefused || failure instanceof SaveNotApplied)) {
        setMoveFailure(undefined);
        setMoveUncertain(true);
      }
    } finally {
      if (isCurrent()) {
        moveLock.current = false;
        setMoveBusy(false);
      }
    }
  };
  const runLifecycle = async () => {
    if (!pageOperation || !transport.management || operationLock.current) return;
    operationLock.current = true;
    const kind = pageOperation;
    const page = {
      id: snapshot.id,
      title: view.title || snapshot.title,
      sharing: snapshot.sharing,
    };
    setPageOperationBusy(true);
    const result = await runPageOperations(transport.management, [page], kind);
    if (!isCurrent()) return;
    operationLock.current = false;
    setPageOperationBusy(false);
    setPageOperation(undefined);
    setPageOperationNotice(operationStatus(result, kind, 1));
    if (result.done.length && !result.awaiting.length)
      setVerifiedArchive({ pageId: snapshot.id, value: kind === 'page.archive' });
    if (result.done.length || result.failed?.failure.code === 'UNKNOWN') {
      try {
        rememberPages(transport, space, (await transport.spaceHome()).pages);
      } catch {
        /* The next read refreshes the list. */
      }
    }
  };
  return {
    archived,
    archiveAnnouncement,
    pageOperation,
    setPageOperation,
    pageOperationBusy,
    pageOperationNotice,
    choosingParent,
    setChoosingParent,
    parentPages,
    moveFailure,
    moveUncertain,
    moveBusy,
    movePage,
    retryMove,
    runLifecycle,
  };
}
