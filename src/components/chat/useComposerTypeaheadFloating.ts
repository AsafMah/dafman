import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { nextTick, onBeforeUnmount, type ComponentPublicInstance } from 'vue';

const VIEWPORT_PADDING_PX = 8;
const CARET_GAP_PX = 8;

type TemplateRefElement = Element | ComponentPublicInstance | null;

function toHTMLElement(element: TemplateRefElement): HTMLElement | null {
  if (element instanceof HTMLElement) return element;

  if (!element || !('$el' in element)) return null;

  const componentRoot = element.$el as unknown;

  return componentRoot instanceof HTMLElement ? componentRoot : null;
}

export function useComposerTypeaheadFloating() {
  let cleanup: (() => void) | null = null;
  let floatingElement: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;

  function stop(): void {
    cleanup?.();
    cleanup = null;
    floatingElement = null;
    anchor = null;
  }

  async function update(anchorElement: HTMLElement, menuElement: HTMLElement): Promise<void> {
    const { x, y } = await computePosition(anchorElement, menuElement, {
      strategy: 'fixed',
      placement: 'top-start',
      middleware: [
        offset(CARET_GAP_PX),
        flip({ padding: VIEWPORT_PADDING_PX }),
        shift({ padding: VIEWPORT_PADDING_PX }),
      ],
    });

    if (floatingElement !== menuElement) return;

    menuElement.style.left = `${x}px`;
    menuElement.style.top = `${y}px`;
  }

  function setFloatingElement(
    element: TemplateRefElement,
    anchorElement: HTMLElement | null,
  ): void {
    const htmlElement = toHTMLElement(element);

    // Vue re-invokes this function ref on every patch of the teleported menu
    // (each keystroke re-renders the option list). Bail when nothing moved so
    // we don't tear down + respin the autoUpdate RAF loop and flash the menu
    // back to (0,0) before floating-ui re-resolves.
    if (htmlElement === floatingElement && anchorElement === anchor) return;

    stop();

    if (!htmlElement || !anchorElement) return;

    floatingElement = htmlElement;
    anchor = anchorElement;
    htmlElement.style.position = 'fixed';
    htmlElement.style.left = '0';
    htmlElement.style.top = '0';

    cleanup = autoUpdate(
      anchorElement,
      htmlElement,
      () => void update(anchorElement, htmlElement),
      {
        animationFrame: true,
      },
    );
    void nextTick(() => update(anchorElement, htmlElement));
  }

  onBeforeUnmount(stop);

  return { setFloatingElement };
}
