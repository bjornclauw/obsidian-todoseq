/**
 * @jest-environment jsdom
 */

import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import {
  KeyboardInsetWatcher,
  KEYBOARD_OPEN_THRESHOLD_PX,
} from '../src/utils/keyboard-inset';

/** Flush MutationObserver callbacks (they run as microtasks). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('KeyboardInsetWatcher', () => {
  beforeAll(() => {
    installObsidianDomMocks();
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
  });

  it('reports the inset from the documentElement --keyboard-height style', async () => {
    const watcher = new KeyboardInsetWatcher();
    const onChange = jest.fn();
    const stop = watcher.start(window, onChange);

    document.documentElement.setCssProps({
      '--keyboard-height': '320px',
    });
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(320);
    expect(watcher.getInset()).toBe(320);

    document.documentElement.style.removeProperty('--keyboard-height');
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(0);

    stop();
  });

  it('ignores insets below the open threshold', async () => {
    const watcher = new KeyboardInsetWatcher();
    const onChange = jest.fn();
    const stop = watcher.start(window, onChange);

    document.documentElement.setCssProps({
      '--keyboard-height': `${KEYBOARD_OPEN_THRESHOLD_PX - 1}px`,
    });
    await flush();

    expect(watcher.getInset()).toBe(0);
    stop();
  });

  it('stops reporting after stop()', async () => {
    const watcher = new KeyboardInsetWatcher();
    const onChange = jest.fn();
    const stop = watcher.start(window, onChange);
    stop();

    document.documentElement.setCssProps({
      '--keyboard-height': '320px',
    });
    await flush();

    expect(onChange).not.toHaveBeenCalled();
    expect(watcher.getInset()).toBe(0);
  });
});
