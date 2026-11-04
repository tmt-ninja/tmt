import { expect, it, vi } from 'vite-plus/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeTrustedHandler, trustedActivation } from '../src/ui/trusted-activation.js';

it('refuses synthetic pointer and key activations, including a synthetic click after a synthetic key', () => {
  const click = new Event('click');
  const key = new Event('keydown');
  expect(trustedActivation(click)).toBe(false);
  expect(trustedActivation(click, key)).toBe(false);
});

it('runs the caller key handler before the trust gate and keeps preventDefault', () => {
  const calls: string[] = [];
  const event = new Event('keydown', { cancelable: true });
  composeTrustedHandler(
    (received: Event) => {
      calls.push('caller');
      received.preventDefault();
    },
    (received: Event) => {
      calls.push('gate');
      expect(received.defaultPrevented).toBe(true);
    },
  )(event);
  expect(calls).toEqual(['caller', 'gate']);
});

it('runs a caller click handler without letting a synthetic click pass the gate', () => {
  const calls: string[] = [];
  const event = new Event('click', { cancelable: true });
  composeTrustedHandler(
    () => calls.push('caller'),
    (received: Event) => {
      calls.push('gate');
      if (!trustedActivation(received)) received.preventDefault();
    },
  )(event);
  expect(calls).toEqual(['caller', 'gate']);
  expect(event.defaultPrevented).toBe(true);
});

it('forwards caller key handlers on both trusted menu components', async () => {
  const received: { onKeyDown?: (event: unknown) => void }[] = [];
  vi.doMock('../src/ui/dropdown-menu.js', () => ({
    DropdownMenuItem: (props: { onKeyDown?: (event: unknown) => void }) => {
      received.push(props);
      return null;
    },
    DropdownMenuCheckboxItem: (props: { onKeyDown?: (event: unknown) => void }) => {
      received.push(props);
      return null;
    },
  }));
  const { TrustedMenuItem, TrustedMenuCheckboxItem } = await import('../src/ui/trusted-menu.js');
  const caller = vi.fn();
  for (const component of [TrustedMenuItem, TrustedMenuCheckboxItem]) {
    renderToStaticMarkup(createElement(component, { onKeyDown: caller }));
  }
  for (const props of received) {
    props.onKeyDown?.({ nativeEvent: { isTrusted: false }, key: 'Enter', defaultPrevented: false });
  }
  expect(received).toHaveLength(2);
  expect(caller).toHaveBeenCalledTimes(2);
  vi.doUnmock('../src/ui/dropdown-menu.js');
});
