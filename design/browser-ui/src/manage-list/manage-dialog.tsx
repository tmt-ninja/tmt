import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  UiTheme,
  useLayerController,
  type UiThemeMode,
} from '../ui/index.js';
import './manage-list.css';

export interface BrowserManageDialogProps {
  title: string;
  description?: string;
  theme: UiThemeMode;
  children: ReactNode;
  actions: ReactNode;
  initialFocus?(): HTMLElement | null;
  focusFallback?(): HTMLElement | null;
  onClose(): void;
}
/** Shared management sheet; the host owns its commands and dismissal policy. */
export function BrowserManageDialog({
  title,
  description,
  theme,
  children,
  actions,
  initialFocus,
  focusFallback,
  onClose,
}: BrowserManageDialogProps) {
  const controller = useLayerController({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    canClose: ({ originalEvent }) => originalEvent?.isTrusted === true,
  });
  return (
    <UiTheme theme={theme}>
      <Dialog controller={controller}>
        <DialogContent
          className="tmt-ui-manage-dialog"
          showCloseButton={false}
          initialFocus={initialFocus}
          focusFallback={focusFallback}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Button
            className="tmt-ui-manage-close"
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={(event) => {
              if (event.isTrusted) onClose();
            }}
          >
            <X aria-hidden="true" />
          </Button>
          {children}
          <DialogFooter>{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    </UiTheme>
  );
}
