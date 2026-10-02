import { expect, test } from '@playwright/test';

test('does not show a native focus ring after Meta on a mouse-focused scroller', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="navigation-pane ui-scroll-area" style="width: 240px; height: 160px; margin: 40px">
        <div class="ui-scroll-area-viewport" tabindex="0" aria-label="Navigation scroll" style="overflow: auto">
          <div class="ui-scroll-area-content" style="height: 400px; padding: 20px">
            <button type="button" class="nav-button">Home</button>
          </div>
        </div>
      </div>
    `;
  });
  const viewport = page.getByLabel('Navigation scroll');
  await viewport.click({ position: { x: 120, y: 100 } });
  await expect(viewport).toBeFocused();
  await page.keyboard.press('Meta');
  await expect(page.locator('html')).toHaveAttribute(
    'data-input-modality',
    'pointer',
  );
  // Window focus restoration can preserve :focus-visible independently of the
  // app's pointer modality. Reproduce that browser state as well as the keypress.
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.ui-scroll-area-viewport',
  });
  await session.send('CSS.forcePseudoState', {
    nodeId,
    forcedPseudoClasses: ['focus-visible'],
  });
  await expect(viewport).toHaveCSS('outline-style', 'none');
  await session.send('CSS.forcePseudoState', {
    nodeId,
    forcedPseudoClasses: [],
  });
  const home = page.getByRole('button', { name: 'Home', exact: true });
  await home.focus();
  await page.keyboard.press('Meta');
  const buttonNode = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.nav-button',
  });
  await session.send('CSS.forcePseudoState', {
    nodeId: buttonNode.nodeId,
    forcedPseudoClasses: ['focus-visible'],
  });
  await expect(home).toHaveCSS('outline-style', 'none');
  await session.send('CSS.forcePseudoState', {
    nodeId: buttonNode.nodeId,
    forcedPseudoClasses: [],
  });
  await session.detach();
  await viewport.focus();
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
  await expect(home).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Shift+Tab');
  await expect(viewport).toBeFocused();
  await expect(viewport).toHaveCSS('outline-style', 'solid');
  await expect(viewport).toHaveCSS('outline-offset', '-2px');
});

test('keeps scrollbar reveal states and nested wheel chaining precise', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="ui-scroll-area" style="width: 200px; height: 160px; margin: 40px">
        <div class="ui-scroll-area-viewport">
          <div class="ui-scroll-area-content" style="height: 400px">
            <button type="button">Focusable content</button>
          </div>
        </div>
        <div class="ui-scroll-area-scrollbar" data-hovering data-orientation="vertical">
          <div class="ui-scroll-area-thumb" style="height: 40px"></div>
        </div>
      </div>
      <div class="ui-native-scrollbar" style="width: 200px; height: 160px; margin: 40px; overflow: auto">
        <div style="height: 400px">Native fallback content</div>
      </div>
      <div class="ui-scroll-area" data-orientation="horizontal" style="width: 200px; height: 160px; margin: 40px">
        <div id="nested-horizontal" class="ui-scroll-area-viewport" style="overflow: auto">
          <div class="ui-scroll-area-content" style="width: 500px; height: 140px; padding: 10px">
            <div class="ui-scroll-area" data-orientation="vertical" style="width: 150px; height: 100px">
              <div id="nested-vertical" class="ui-scroll-area-viewport" style="overflow: auto">
                <div class="ui-scroll-area-content" style="height: 300px">Nested vertical content</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const root = page.locator('.ui-scroll-area').first();
  const scrollbar = page.locator('.ui-scroll-area-scrollbar');

  await expect(scrollbar).toHaveCSS('opacity', '0');
  await root.hover({ position: { x: 20, y: 80 } });
  await expect(scrollbar).toHaveCSS('opacity', '0');

  await scrollbar.hover({ position: { x: 5, y: 40 } });
  await expect(scrollbar).toHaveCSS('opacity', '1');

  await page.getByRole('button', { name: 'Focusable content' }).focus();
  await expect(scrollbar).toHaveCSS('opacity', '1');

  const native = page.locator('.ui-native-scrollbar');
  await native.hover({ position: { x: 20, y: 80 } });
  await expect(native).not.toHaveAttribute('data-scrollbar-hovering');

  await native.hover({ position: { x: 196, y: 80 } });
  await expect(native).toHaveAttribute('data-scrollbar-hovering', '');

  await native.evaluate((element) => {
    element.scrollTop = 40;
  });
  await expect(native).toHaveAttribute('data-scrollbar-scrolling', '');
  await expect(native).not.toHaveAttribute('data-scrollbar-scrolling', {
    timeout: 1_000,
  });

  const nestedHorizontal = page.locator('#nested-horizontal');
  await page.locator('#nested-vertical').hover();
  await page.mouse.wheel(120, 0);
  await expect
    .poll(() => nestedHorizontal.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});
