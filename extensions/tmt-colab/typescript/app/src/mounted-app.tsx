import { BrowserAction } from '@tmt/browser-ui/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { AppHeader } from './app-header.js';
import { inShell } from './entry.js';
import { startMounted, type MountedRuntime } from './mounted-runtime.js';
import { text } from './strings.js';
import { NoticeCard } from './notice-card.js';
import { SessionLimitError } from './session-limit-error.js';
import { SessionLimitBody } from './session-limit.js';
import { UpdateNotice } from './update-notice.js';

/** A standalone tab (outside the TMT web app) owns its paired Colab until this unmounts. */
export function MountedApp() {
  const [runtime, setRuntime] = useState<MountedRuntime | null>(null);
  useEffect(() => {
    const started = startMounted();
    setRuntime(started);
    return () => started.close();
  }, []);
  return runtime ? <MountedView runtime={runtime} /> : <MountedNotice state="loading" />;
}

/** The paired Colab a runtime holds: its notice while it opens or fails, then its pages. */
export function MountedView({ runtime }: { runtime: MountedRuntime }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  return (
    <>
      {snapshot.state === 'ready' ? (
        <RouterProvider router={snapshot.router} />
      ) : (
        <MountedNotice
          state={snapshot.state}
          limit={snapshot.state === 'failed' ? snapshot.limit : undefined}
        />
      )}
      <UpdateNotice />
    </>
  );
}

/** Presentation shared by the mounted lifecycle and the screen layout fixture. */
export function MountedNotice({
  state,
  limit,
}: {
  state: 'loading' | 'failed' | 'ready';
  /** Why a failed open was refused, when the device is at its Remote session limit. */
  limit?: SessionLimitError;
}) {
  const title = state !== 'failed' ? text.registering : limit ? text.sessionLimitTitle : text.error;
  // Inside the TMT web app the shell's bar already names Colab while it opens, and a quick open
  // shows no card at all: the card appears only after 400 ms (#5954).
  const shell = inShell();
  const [late, setLate] = useState(!shell);
  useEffect(() => {
    if (late || state !== 'loading') return;
    const timer = setTimeout(() => setLate(true), 400);
    return () => clearTimeout(timer);
  }, [late, state]);
  if (state === 'loading' && !late) return null;
  return (
    <>
      {(state === 'failed' || !shell) && (
        <AppHeader linked={false} title={state === 'failed' ? title : 'Opening space'} />
      )}
      <main>
        <NoticeCard
          state={state === 'failed' ? 'blocked' : 'opening'}
          eyebrow="Paired space"
          title={title}
          actions={
            state === 'failed' ? (
              <BrowserAction
                type="button"
                variant="text"
                label={text.reload}
                onActivate={() => location.reload()}
              />
            ) : undefined
          }
        >
          {state === 'failed' &&
            (limit ? (
              <SessionLimitBody refused limit={limit.limit} settingsUrl={limit.settingsUrl} />
            ) : (
              <p>{text.registrationFailed}</p>
            ))}
        </NoticeCard>
      </main>
    </>
  );
}
