import { BrowserIconAction } from '@tmt/browser-ui/react';
import { Link } from '@tanstack/react-router';
import { Moon, Sun } from 'lucide-react';
import { useContext, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { ColabHeader } from './colab-header.js';
import {
  storedWorkPath,
  subscribeWorkTab,
  WORK_HOME_PATH,
  WORK_LIST_PATH,
} from './list-history.js';
import { SharedTopBar } from './shared-top-bar.js';
import { text } from './strings.js';
import { getTheme, setThemeChoice, subscribeTheme } from './theme.js';

export function WorkReturnLink({
  name,
  project,
  children,
}: {
  name: string;
  project?: string;
  children: ReactNode;
}) {
  const to = useSyncExternalStore(subscribeWorkTab, storedWorkPath, () => WORK_HOME_PATH);
  if (project === undefined) {
    return (
      <Link to={to} aria-label={name} title={name}>
        {children}
      </Link>
    );
  }
  const props = { className: 'colab-scope-crumb', title: name, children };
  return to === WORK_LIST_PATH ? (
    <Link {...props} to={WORK_LIST_PATH} search={{ project: [project] }} />
  ) : (
    <Link {...props} to={WORK_HOME_PATH} search={{ project }} />
  );
}

/** The header of a Colab route that is not a loaded page: its title in the shared bar's title slot,
 * or the module's own header outside it. */
export function AppHeader({
  linked = true,
  title = text.pages,
  titleVisible = true,
  remote,
  headerRef,
  headingSuffix,
  workView,
  page = false,
}: {
  linked?: boolean;
  title?: string;
  titleVisible?: boolean;
  remote?: { deviceName?: string };
  headerRef?: Ref<HTMLElement>;
  headingSuffix?: ReactNode;
  workView?: 'home' | 'list';
  /** The title names a page (a shell page), not a Colab section. */
  page?: boolean;
}) {
  const sharedBar = useContext(SharedTopBar);
  return (
    <ColabHeader
      title={
        workView === undefined ? title : text.workHome[workView === 'home' ? 'homeTab' : 'listTab']
      }
      titleVisible={titleVisible}
      page={page || workView !== undefined}
      crumb={
        workView === undefined ? undefined : (
          <span className="colab-work-view-prefix">{text.workHome.title}</span>
        )
      }
      headerRef={headerRef}
      remote={remote}
      headingSuffix={headingSuffix}
      home={
        linked ? (brand, name) => <WorkReturnLink name={name}>{brand}</WorkReturnLink> : undefined
      }
      actions={sharedBar ? undefined : <ThemeButton />}
    />
  );
}
function ThemeButton() {
  const dark = useSyncExternalStore(subscribeTheme, getTheme) === 'dark';
  return (
    <span className="theme">
      <BrowserIconAction
        type="button"
        variant="text"
        label={text.theme}
        icon={dark ? <Moon /> : <Sun />}
        onActivate={() => {
          setThemeChoice(getTheme() === 'dark' ? 'light' : 'dark');
        }}
      />
    </span>
  );
}
