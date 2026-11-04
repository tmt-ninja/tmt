import type { ComponentProps } from 'react';
import { Button, UiTheme } from '../src/ui/index.js';

type ButtonProps = ComponentProps<typeof Button>;
export const buttonVariants: NonNullable<ButtonProps['variant']>[] = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
];
export const buttonSizes: NonNullable<ButtonProps['size']>[] = [
  'default',
  'xs',
  'sm',
  'lg',
  'icon',
  'icon-xs',
  'icon-sm',
  'icon-lg',
];

/** Every Button variant and size in both palettes and both themes, for the contrast audit (#5821). */
export function UiContrastFrame() {
  return (
    <main className="gallery-main" aria-label="Button contrast">
      {(['current', 'b'] as const).map((palette) =>
        (['light', 'dark'] as const).map((theme) => (
          <section
            key={`${palette}-${theme}`}
            data-tmt-palette={palette === 'b' ? 'b' : undefined}
            data-theme={theme}
            aria-label={`${palette} ${theme}`}
          >
            {/* The theme comes from data-theme, as on a page with the site's theme switch, while UiTheme
                follows the system: the audit runs under a light system, so a control that leaves its
                ink to the UA (buttontext) shows black on the dark surface, as Ben found. */}
            <UiTheme theme="system">
              <div
                data-contrast-grid=""
                className="tmt:bg-background tmt:text-foreground"
                style={{ display: 'grid', gap: 8, padding: 16 }}
              >
                {buttonVariants.map((variant) => (
                  <div key={variant} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {buttonSizes.map((size) => (
                      <Button
                        key={size}
                        type="button"
                        variant={variant}
                        size={size}
                        data-contrast={`${palette} ${theme} ${variant} ${size}`}
                      >
                        {size.startsWith('icon') ? 'A' : `${variant} ${size}`}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </UiTheme>
          </section>
        )),
      )}
    </main>
  );
}
