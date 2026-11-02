import { expect, test, type Page } from '@playwright/test';

const chat = (page: Page) => page.getByRole('button', { name: 'Chat · Unread', exact: true });
const comments = (page: Page) => page.getByRole('button', { name: 'Comments (2)', exact: true });
const closes = (page: Page) => page.locator('[data-closes]');

test('Esc closes the window and focus returns to the action that opened it', async ({ page }) => {
  await page.goto('/?frame=floating');
  await chat(page).click();
  const window = page.getByRole('dialog', { name: 'Chat' });
  await expect(window).toBeFocused();
  await expect(chat(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
  await expect(chat(page)).toBeFocused();
  await expect(chat(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(closes(page)).toHaveAttribute('data-closes', 'escape');
});

test('Close and Esc take the same path, and one window is open at a time', async ({ page }) => {
  await page.goto('/?frame=floating');
  await chat(page).click();
  await comments(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Discussion' })).toBeVisible();
  await expect(chat(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Close (Esc)' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(comments(page)).toBeFocused();
  await expect(closes(page)).toHaveAttribute('data-closes', 'close');
});

test('a nested menu consumes the first Esc; only the next one closes the window', async ({
  page,
}) => {
  await page.goto('/?frame=floating');
  await comments(page).click();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Discussion' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(comments(page)).toBeFocused();
});

test('a tooltip consumes the first Esc', async ({ page }) => {
  await page.goto('/?frame=floating');
  await comments(page).click();
  await page.getByRole('button', { name: 'Resolve' }).focus();
  await expect(page.getByRole('tooltip', { name: 'Resolve' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Discussion' })).toBeVisible();
});

test('Esc during IME composition never closes the window', async ({ page }) => {
  await page.goto('/?frame=floating');
  await chat(page).click();
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  // A trusted Escape while the IME composes (keyCode 229, isComposing), as an IME sends it.
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 229,
  });
  await expect(page.getByRole('dialog', { name: 'Chat' })).toBeVisible();
  await cdp.send('Input.insertText', { text: 'にほ' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`every header control sits inside the window at ${width}px, and the window fits its content`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?frame=floating&lines=3');
    await comments(page).click();
    const window = page.getByRole('dialog', { name: 'Discussion' });
    const header = window.locator('[data-slot="floating-window-header"]');
    const inner = await header.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
        top: box.top,
        bottom: box.bottom,
      };
    });
    const controls = await header.locator('button, [role="button"], span').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          text: node.textContent,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
    for (const control of controls) {
      expect(control.right, `${control.text} right edge`).toBeLessThanOrEqual(inner.right + 0.5);
      expect(control.left, `${control.text} left edge`).toBeGreaterThanOrEqual(inner.left - 0.5);
      expect(control.top, `${control.text} top`).toBeGreaterThanOrEqual(inner.top);
      expect(control.bottom, `${control.text} bottom`).toBeLessThanOrEqual(inner.bottom);
    }
    // The counter stays on one line, and the header keeps its token height.
    const counter = header.getByText('1 / 2');
    expect((await counter.boundingBox())!.height).toBeLessThan(24);
    expect(inner.bottom - inner.top).toBe(44);
    // A short thread: the window ends where its content ends, well under its maximum.
    const short = (await window.boundingBox())!;
    expect(short.height).toBeLessThan(300);
    // A long one stops at the space between the top bar and the actions, and its body scrolls.
    await page.goto('/?frame=floating&lines=80');
    await comments(page).click();
    const long = (await page.getByRole('dialog', { name: 'Discussion' }).boundingBox())!;
    const actions = (await page.getByRole('toolbar', { name: 'Page actions' }).boundingBox())!;
    expect(long.y).toBeGreaterThanOrEqual(56);
    expect(long.y + long.height).toBeLessThanOrEqual(actions.y);
    expect(long.x).toBeGreaterThanOrEqual(0);
    expect(long.x + long.width).toBeLessThanOrEqual(width);
  });
