import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { serverUrl } from './environment';

async function chooseSelectOption(
  page: Page,
  selectName: string,
  optionName: string,
) {
  const trigger = page.getByRole('combobox', {
    name: selectName,
    exact: true,
  });
  await trigger.click();
  const option = page.getByRole('option', { name: optionName, exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

async function expectTaskPatch(page: Page, action: () => Promise<void>) {
  const completed = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'PATCH' &&
      /\/api\/workspaces\/[^/]+\/tasks\/[^/]+$/.test(path)
    );
  });
  await action();
  expect((await completed).ok()).toBe(true);
}

async function addTaskProperty(page: Page, property: string) {
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page.getByLabel('Search properties')).toBeVisible();
  await page.getByLabel('Search properties').fill(property);
  await page.getByRole('button', { name: `Add ${property} property` }).click();
}

async function textGeometry(locator: Locator, text: string) {
  return locator.evaluate((element, expectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const start = node.textContent?.indexOf(expectedText) ?? -1;
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + expectedText.length);
        const textRect = range.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        return {
          top: textRect.top,
          left: textRect.left,
          height: textRect.height,
          boxBottom: elementRect.bottom,
          textBottom: textRect.bottom,
        };
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not find text geometry for ${expectedText}`);
  }, text);
}

async function registerAccountThroughSetup(
  page: Page,
  authSurface: Locator,
  email: string,
  workspaceName: string,
  workspaceIdentifier: string,
) {
  await authSurface.getByRole('button', { name: 'New account' }).click();
  await authSurface.getByLabel('Email').fill(email);
  await authSurface
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await authSurface.getByLabel('Confirm password').fill('playwright-password');
  await authSurface.getByRole('button', { name: 'Register' }).click();

  await expect(page).toHaveURL(/\/setup\/account$/);
  await page.getByRole('button', { name: 'Use default preferences' }).click();
  await expect(page).toHaveURL(/\/setup\/workspace$/);
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Workspace ID').fill(workspaceIdentifier);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page).toHaveURL(/\/setup\/invite$/);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
}

test('manages structured work and durable Markdown across reloads', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(
        `${response.status()} ${response.url()} ${response.request().postData() ?? ''}`,
      );
    }
  });
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Email').fill(`e2e-${suffix}@example.com`);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.getByLabel('Confirm password').fill('playwright-password');
  await page.getByRole('button', { name: 'Register' }).click();

  await expect(page).toHaveURL(/\/setup\/account$/);
  await page.getByLabel('Display name').fill('Kanleaf Tester');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/setup\/workspace$/);
  await page.getByRole('button', { name: 'Join a Workspace' }).click();
  await expect(page.getByLabel('Invitation token')).toBeVisible();
  await page.getByRole('button', { name: 'Create a Workspace' }).click();
  await page.getByLabel('Workspace name').fill('Studio');
  await expect(page.getByLabel('Workspace ID')).toHaveValue('studio');
  const workspaceIdentifier = `studio-${suffix}`;
  await page.getByLabel('Workspace ID').fill(workspaceIdentifier);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page).toHaveURL(/\/setup\/invite$/);
  await page.getByLabel('Email').fill(`invitee-${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel('Issued invitation token')).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  const workspaceSelect = page.getByLabel('Active workspace');
  await expect(workspaceSelect).toContainText('Studio');
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));

  await workspaceSelect.click();
  await page.getByRole('menuitem', { name: 'Settings for Studio' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/general$`),
  );
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await page.getByLabel('Workspace name').fill('Studio Workspace');
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByText('Workspace updated')).toBeVisible();
  await expect(workspaceSelect).toContainText('Studio Workspace');
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await page.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/account/profile$`),
  );
  await expect(
    page.getByRole('region', { name: 'Account settings' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Members' })).not.toBeVisible();
  await page.getByLabel('Display name').fill('Kanleaf Tester');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Switch account' }),
  ).toContainText('Kanleaf Tester');
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await workspaceSelect.click();
  await page
    .getByRole('menuitem', { name: 'Settings for Studio Workspace' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profile' })).not.toBeVisible();
  await page.setViewportSize({ width: 960, height: 640 });
  await page.getByRole('button', { name: 'States' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/states$`),
  );
  await page.getByPlaceholder('State name').fill('Review');
  await chooseSelectOption(page, 'State group', 'In progress');
  await page.getByRole('button', { name: 'Add state' }).click();
  await expect(page.getByLabel('Review name')).toBeVisible();
  await page.getByRole('button', { name: 'Task types' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/task-types$`),
  );
  await page.getByPlaceholder('Type name').fill('Bug');
  await page.getByLabel('Task type icon key').fill('bug');
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(page.getByLabel('Bug name')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).not.toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Kanleaf');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Kanleaf' })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/[^/]+$`),
  );
  const projectId = new URL(page.url()).pathname.split('/')[3];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(page.locator('.navigation-pane')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.navigation-pane')).toBeVisible();

  await page
    .locator('.project-header-actions')
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/${workspaceIdentifier}/projects/${projectId}/settings/general$`,
    ),
  );
  await page.getByLabel('Description').fill('Kanleaf Core delivery project.');
  await chooseSelectOption(
    page,
    'Visibility',
    'Open — Workspace Members can discover and join',
  );
  await page.getByRole('button', { name: 'Save general settings' }).click();
  await expect(page.getByText('Project details saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Features' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/${workspaceIdentifier}/projects/${projectId}/settings/features$`,
    ),
  );
  await page
    .locator('.feature-toggle-row')
    .filter({ hasText: 'Cycles' })
    .locator('input')
    .check();
  await page.getByRole('button', { name: 'Save features' }).click();
  await expect(page.getByText('Project features saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Project' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}$`),
  );
  await expect(page.getByText('Kanleaf Core delivery project.')).toBeVisible();

  const projectNavigation = page.locator('.project-subnav');
  await projectNavigation.getByRole('button', { name: 'Work items' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/work-items$`),
  );
  await chooseSelectOption(page, 'Layout', 'Board');
  await projectNavigation.getByRole('button', { name: 'Library' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/library$`),
  );
  await expect(page.locator('.document-detail-pane')).toBeVisible();
  await page.getByRole('button', { name: 'New Library note' }).click();
  await page.getByLabel('Note title').fill('Project handbook');
  await page.getByRole('button', { name: 'Create note' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/library/[^/?]+$`),
  );
  const pageMarkdown = `# Project handbook

This note is stored as a durable **Markdown file**.

- [x] Define the vault boundary
- [ ] Ship Live Preview

| Layer | Store |
| --- | --- |
| Note | Vault |

\`\`\`rust
let source_is_markdown = true;
\`\`\`

# Section 1
## Subsection 1
- Test nha
> Note
### Subsubsection
2`;
  const pageSource = page.locator(
    '.library-document-editor .cm-content[contenteditable="true"]',
  );
  await pageSource.fill(pageMarkdown);
  await pageSource.press('Control+Home');
  const liveTodoLine = page
    .locator('.library-document-editor .cm-line')
    .filter({ hasText: 'Ship Live Preview' });
  await liveTodoLine.click();
  await expect(liveTodoLine).toHaveClass(/cm-live-source-line/);
  await expect(liveTodoLine).toContainText('- [ ] Ship Live Preview');
  await pageSource.press('Control+Home');
  const liveHeading = page
    .locator('.library-document-editor .cm-live-heading-1')
    .filter({ hasText: 'Project handbook' });
  await expect(liveHeading).toContainText('# Project handbook');
  await expect(liveHeading).toHaveClass(/cm-activeLine/);
  const liveActiveBackground = await liveHeading.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(liveActiveBackground).toBe('rgba(0, 0, 0, 0)');
  const focusedHeadingHeight = await liveHeading.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page
    .locator('.library-document-editor .cm-line')
    .filter({ hasText: 'This note is stored' })
    .click();
  await expect(liveHeading).toHaveText('Project handbook');
  const readingHeadingHeight = await liveHeading.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(focusedHeadingHeight).toBeCloseTo(readingHeadingHeight, 1);
  const liveContentLeft = await liveHeading.evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  const liveRhythm = await Promise.all([
    textGeometry(
      page
        .locator('.library-document-editor .cm-live-heading-1')
        .filter({ hasText: 'Section 1' }),
      'Section 1',
    ),
    textGeometry(
      page.locator('.library-document-editor .cm-live-heading-2'),
      'Subsection 1',
    ),
    textGeometry(
      page
        .locator('.library-document-editor .cm-line')
        .filter({ hasText: 'Test nha' }),
      'Test nha',
    ),
    textGeometry(
      page
        .locator('.library-document-editor .cm-live-blockquote')
        .filter({ hasText: 'Note' }),
      'Note',
    ),
    textGeometry(
      page.locator('.library-document-editor .cm-live-heading-3'),
      'Subsubsection',
    ),
    textGeometry(
      page
        .locator('.library-document-editor .cm-line')
        .filter({ hasText: /^2$/ }),
      '2',
    ),
  ]);
  await page.getByRole('button', { name: 'Source' }).click();
  const sourceHeading = page
    .locator('.library-document-editor .cm-line')
    .first();
  await expect(sourceHeading).toContainText('# Project handbook');
  const sourceActiveBackground = await page
    .locator('.library-document-editor .cm-activeLine')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(sourceActiveBackground).not.toBe(liveActiveBackground);
  const sourceContentLeft = await sourceHeading.evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  await page.getByRole('button', { name: 'Reading' }).click();
  const readingHeading = page
    .getByLabel('Markdown document')
    .getByRole('heading', { name: 'Project handbook' });
  const readingContentLeft = await readingHeading.evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  const preview = page
    .getByLabel('Markdown document')
    .locator('.markdown-preview');
  const readingRhythm = await Promise.all([
    textGeometry(
      preview.locator('h1').filter({ hasText: 'Section 1' }),
      'Section 1',
    ),
    textGeometry(preview.locator('h2'), 'Subsection 1'),
    textGeometry(
      preview.locator('li').filter({ hasText: 'Test nha' }),
      'Test nha',
    ),
    textGeometry(
      preview.locator('blockquote').filter({ hasText: 'Note' }),
      'Note',
    ),
    textGeometry(preview.locator('h3'), 'Subsubsection'),
    textGeometry(preview.locator('p').filter({ hasText: /^2$/ }), '2'),
  ]);
  for (const [index, liveBlock] of liveRhythm.entries()) {
    const readingBlock = readingRhythm[index];
    expect(liveBlock.height).toBeCloseTo(readingBlock.height, 1);
    expect(liveBlock.top - liveRhythm[0].top).toBeCloseTo(
      readingBlock.top - readingRhythm[0].top,
      0,
    );
    expect(liveBlock.left).toBeCloseTo(readingBlock.left, 0);
  }
  expect(liveRhythm[0].boxBottom - liveRhythm[0].textBottom).toBeCloseTo(
    readingRhythm[0].boxBottom - readingRhythm[0].textBottom,
    1,
  );
  expect(Math.abs(sourceContentLeft - liveContentLeft)).toBeLessThan(1);
  expect(Math.abs(sourceContentLeft - readingContentLeft)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Live' }).click();
  const liveTable = page.locator(
    '.library-document-editor .cm-live-block-widget table',
  );
  await expect(liveTable).toContainText('NoteVault');
  await expect(
    page.locator('.library-document-editor .cm-live-block-widget pre'),
  ).toContainText('source_is_markdown');
  await liveTable.click();
  await expect(liveTable).not.toBeVisible();
  await expect(pageSource).toContainText('| Layer | Store |');
  await pageSource.press('Control+Home');
  await expect(liveTable).toBeVisible();
  await page.getByRole('button', { name: 'Save Markdown' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Actions for Project handbook' })
    .click();
  await page.getByRole('menuitem', { name: 'Add nested note' }).click();
  await page.getByLabel('Nested note title').fill('Architecture decisions');
  await page.getByRole('button', { name: 'Create nested note' }).click();
  await expect(
    page.getByRole('treeitem', { name: /Architecture decisions/ }),
  ).toBeVisible();

  await page.keyboard.press('Control+k');
  const commandPalette = page.getByRole('dialog', {
    name: 'Search and commands',
  });
  await expect(commandPalette).toBeVisible();
  await commandPalette
    .getByRole('combobox', { name: 'Search Kanleaf' })
    .fill('Architecture decisions');
  await commandPalette
    .getByRole('option', { name: /Architecture decisions/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Architecture decisions' }),
  ).toBeVisible();
  const nestedSource = page.locator(
    '.library-document-editor .cm-content[contenteditable="true"]',
  );
  await nestedSource.fill('Decision log');
  const nestedScroller = page.locator('.library-document-editor .cm-scroller');
  const nestedScrollerBounds = await nestedScroller.boundingBox();
  const nestedLineBounds = await page
    .locator('.library-document-editor .cm-line')
    .last()
    .boundingBox();
  expect(nestedScrollerBounds).not.toBeNull();
  expect(nestedLineBounds).not.toBeNull();
  expect(
    nestedScrollerBounds!.y + nestedScrollerBounds!.height,
  ).toBeGreaterThan(nestedLineBounds!.y + nestedLineBounds!.height + 16);
  await nestedScroller.click({
    position: {
      x: 48,
      y: nestedScrollerBounds!.height - 16,
    },
  });
  await page.keyboard.type('Recorded from trailing whitespace');
  const nestedLines = page.locator('.library-document-editor .cm-line');
  await expect(nestedLines).toHaveCount(2);
  await expect(nestedLines.first()).toHaveText('Decision log');
  await expect(nestedLines.last()).toHaveText(
    'Recorded from trailing whitespace',
  );
  await page.getByRole('button', { name: 'Save Markdown' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const nestedDocumentUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(nestedDocumentUrl);
  await expect(
    page.getByRole('heading', { name: 'Architecture decisions' }),
  ).toBeVisible();
  await expect(nestedSource).toContainText('Decision log');
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(
    page.getByRole('button', { name: 'Back to Library' }),
  ).toBeVisible();
  await expect(page.locator('.document-collection-pane')).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to Library' }).click();
  await expect(page.locator('.document-collection-pane')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  await projectNavigation.getByRole('button', { name: 'Work items' }).click();
  await chooseSelectOption(page, 'Layout', 'List');
  await projectNavigation.getByRole('button', { name: 'Cycles' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/cycles$`),
  );
  await page.getByRole('button', { name: 'New cycle' }).click();
  await page.getByLabel('Cycle name').fill('Cycle 1');
  await page.getByLabel('Start', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Due', { exact: true }).fill('2026-09-14');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cycle 1', level: 2 }),
  ).toBeVisible();
  const cycleUrl = page.url();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/cycles/[^/?]+$`),
  );
  await page.reload();
  await expect(page).toHaveURL(cycleUrl);
  await expect(
    page.getByRole('heading', { name: 'Cycle 1', level: 2 }),
  ).toBeVisible();

  await projectNavigation.getByRole('button', { name: 'Modules' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/modules$`),
  );
  await page.getByRole('button', { name: 'New module' }).click();
  await page.getByLabel('Module name').fill('Core');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Core', level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/modules/[^/?]+$`),
  );

  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Work items' })
    .click();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task title').fill('Complete the v0.1 workflow');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/${workspaceIdentifier}/projects/${projectId}/work-items\\?task=[^&]+$`,
    ),
  );
  const taskDetail = page.getByRole('region', { name: 'Task detail' });
  await expect(taskDetail.getByLabel('Task title')).toHaveValue(
    'Complete the v0.1 workflow',
  );

  await addTaskProperty(page, 'Cycle');
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Cycle', 'Cycle 1'),
  );
  await expect(page.getByLabel('Cycle')).toHaveAttribute('data-value', /.+/);
  await addTaskProperty(page, 'Modules');
  await page.getByLabel('Edit Modules').click();
  await expectTaskPatch(page, () =>
    page.getByRole('menuitemcheckbox', { name: 'Core' }).click(),
  );
  await expect(page.getByLabel('Edit Modules')).toContainText('Core');
  await page.keyboard.press('Escape');

  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'State', 'Review'),
  );
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Task type', 'Bug'),
  );
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Priority', 'Urgent'),
  );
  await page.getByLabel('Edit assignees').click();
  await expectTaskPatch(page, () =>
    page.getByRole('menuitemcheckbox', { name: 'Kanleaf Tester' }).click(),
  );
  await page.keyboard.press('Escape');
  await expectTaskPatch(page, () =>
    page.getByLabel('Due date').fill('2026-09-30'),
  );
  await addTaskProperty(page, 'Start date');
  await expectTaskPatch(page, () =>
    page.getByLabel('Start date').fill('2026-09-01'),
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Project', 'Inbox'),
  );

  await page.getByRole('button', { name: 'My Work' }).click();
  const taskRow = page
    .locator('.task-row-main')
    .filter({ hasText: 'Complete the v0.1 workflow' });
  await taskRow.click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/my-work\\?task=[^&]+$`),
  );
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(page.getByRole('button', { name: 'Close task' })).toContainText(
    'Back',
  );
  await expect(taskRow).not.toBeVisible();
  const markdown = `# Architecture

Kanleaf keeps **structured work** beside durable notes.

- [x] PostgreSQL metadata
- [x] Filesystem Markdown

| Layer | Storage |
| --- | --- |
| Task | PostgreSQL |
| Notes | Vault |`;
  const source = page.locator('.cm-content[contenteditable="true"]');
  await source.fill(markdown);
  await page.getByRole('button', { name: 'Reading' }).click();
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Notes');
  await page.getByRole('button', { name: 'Save Markdown' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const openTaskUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(openTaskUrl);
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();
  await page.getByRole('button', { name: 'Close task' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await expect(taskRow).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('button', { name: 'Filter tasks' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Urgent' }).click();
  await page.keyboard.press('Escape');
  await chooseSelectOption(page, 'Layout', 'Table');
  await page.getByRole('button', { name: 'Save View' }).click();
  await page.getByLabel('Name').fill('Urgent work');
  await page.getByRole('radio', { name: /Shared/ }).click();
  await page.getByRole('button', { name: 'Create View' }).click();
  await expect(
    page.getByRole('heading', { name: 'Urgent work' }),
  ).toBeVisible();
  const savedViewUrl = page.url();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/views/[^/?]+$`),
  );
  await page.getByRole('button', { name: 'My Work' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await page.goBack();
  await expect(page).toHaveURL(savedViewUrl);
  await expect(
    page.getByRole('heading', { name: 'Urgent work' }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));

  await page.reload();
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  await expect(page.getByLabel('State')).toContainText('Review');
  await expect(page.getByLabel('Task type')).toContainText('Bug');
  await expect(page.getByLabel('Priority')).toHaveAttribute(
    'data-value',
    'urgent',
  );
  await expect(page.getByLabel('Due date')).toHaveValue('2026-09-30');
  await expect(page.getByLabel('Start date')).toHaveValue('2026-09-01');
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();

  await page.getByRole('button', { name: 'Urgent work' }).click();
  await expect(page.getByLabel('Layout')).toHaveAttribute(
    'data-value',
    'table',
  );
  await expect(page.getByRole('table')).toContainText(
    'Complete the v0.1 workflow',
  );

  await page
    .locator('.project-nav-row')
    .getByRole('button', { name: 'Kanleaf' })
    .click();
  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/views$`),
  );
  const projectViewsSurface = page.locator('.project-views-surface');
  await expect(
    projectViewsSurface.getByRole('heading', {
      name: 'Views',
      exact: true,
    }),
  ).toBeVisible();
  await projectViewsSurface
    .getByRole('button', { name: 'Create the first View' })
    .click();
  await page.getByLabel('Name').fill('Project focus');
  await page.getByRole('radio', { name: /Shared/ }).click();
  await page.getByRole('button', { name: 'Create View' }).click();
  await expect(
    page.getByRole('heading', { name: 'Project focus' }),
  ).toBeVisible();
  const projectViewUrl = page.url();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/projects/${projectId}/views/[^/?]+$`),
  );
  await chooseSelectOption(page, 'Layout', 'Board');
  const viewSaved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'PATCH' &&
      /\/api\/workspaces\/[^/]+\/views\/[^/]+$/.test(path)
    );
  });
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect((await viewSaved).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(projectViewUrl);
  await expect(
    page.getByRole('heading', { name: 'Project focus' }),
  ).toBeVisible();
  await expect(page.getByLabel('Layout')).toHaveAttribute(
    'data-value',
    'board',
  );
  await page
    .locator('.project-nav-row')
    .getByRole('button', { name: 'Kanleaf' })
    .click();
  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  const savedViewRow = page
    .locator('.project-views-surface')
    .getByRole('button', { name: /Project focus/ });
  await expect(savedViewRow).toContainText('Board layout');
  await savedViewRow.click();
  await expect(
    page.getByRole('heading', { name: 'Project focus' }),
  ).toBeVisible();

  await page
    .locator('.project-nav-row')
    .getByRole('button', { name: 'Kanleaf' })
    .click();
  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Library' })
    .click();
  await page.getByRole('treeitem', { name: /Project handbook/ }).click();
  await expect(
    page
      .locator('.document-detail-header')
      .getByRole('heading', { name: 'Project handbook' }),
  ).toBeVisible();
  await expect(page.getByText('durable Markdown file')).toBeVisible();
  await expect(
    page.getByRole('treeitem', { name: /Architecture decisions/ }),
  ).toBeVisible();

  await workspaceSelect.click();
  await page
    .getByRole('menuitem', { name: 'Settings for Studio Workspace' })
    .click();
  await page.getByRole('button', { name: 'Storage & backup' }).click();
  await page.getByRole('button', { name: 'Scan vault' }).click();
  await expect(
    page.getByText('No external Task property changes were found.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Prepare archive' }).click();
  const downloadButton = page.getByRole('button', {
    name: 'Download archive',
  });
  await expect(downloadButton).toBeVisible();
  const [archiveDownload] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);
  const archivePath = await archiveDownload.path();
  expect(archivePath).not.toBeNull();
  await page.getByRole('button', { name: 'Back to Workspace' }).click();

  await workspaceSelect.click();
  await page.getByRole('menuitem', { name: 'Import workspace' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import Workspace' });
  await importDialog.locator('input[type="file"]').setInputFiles(archivePath!);
  await expect(
    importDialog.getByText('Studio Workspace', { exact: true }),
  ).toBeVisible();
  await expect(
    importDialog.getByText(/Access is reset for safety/),
  ).toBeVisible();
  await importDialog
    .getByRole('button', { name: 'Import as new Workspace' })
    .click();
  await expect(importDialog).not.toBeVisible();
  await expect(workspaceSelect).toContainText('Studio Workspace');
  await page.getByRole('button', { name: 'Inbox' }).click();
  await page.getByText('Complete the v0.1 workflow', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();
  expect(failedResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('switches retained accounts without crossing account data', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const firstEmail = `switch-first-${suffix}@example.com`;
  const secondEmail = `switch-second-${suffix}@example.com`;
  const firstTask = `First account note ${suffix}`;
  await page.goto('/');

  await registerAccountThroughSetup(
    page,
    page.locator('body'),
    firstEmail,
    'First account Workspace',
    `switch-first-${suffix}`,
  );
  await page.getByRole('button', { name: 'Inbox' }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task title').fill(firstTask);
  await page.getByRole('button', { name: 'Add' }).click();
  const source = page.locator('.cm-content[contenteditable="true"]');
  await source.fill('# Account one\n\nSaved while switching accounts.');

  await page.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('menuitem', { name: 'Add another account' }).click();
  const addAccount = page.getByRole('dialog', {
    name: 'Add another account',
  });
  await registerAccountThroughSetup(
    page,
    addAccount,
    secondEmail,
    'Second account Workspace',
    `switch-second-${suffix}`,
  );

  const accountTrigger = page.getByRole('button', { name: 'Switch account' });
  await expect(accountTrigger).toContainText(secondEmail);
  await page.getByRole('button', { name: 'Inbox' }).click();
  await expect(page.getByText(firstTask, { exact: true })).not.toBeVisible();

  await accountTrigger.click();
  await page
    .getByRole('menuitemradio', { name: new RegExp(firstEmail) })
    .click();
  await expect(accountTrigger).toContainText(firstEmail);
  await page.getByRole('button', { name: 'Inbox' }).click();
  await page.getByText(firstTask, { exact: true }).click();
  await expect(source).toContainText('Saved while switching accounts.');

  await page.reload();
  await expect(accountTrigger).toContainText(firstEmail);
  await page.getByRole('button', { name: 'Inbox' }).click();
  await expect(
    page
      .getByRole('listbox', { name: 'Inbox tasks' })
      .getByText(firstTask, { exact: true }),
  ).toBeVisible();

  await accountTrigger.click();
  await page
    .getByRole('menuitemradio', { name: new RegExp(secondEmail) })
    .click();
  await expect(accountTrigger).toContainText(secondEmail);
  await page.getByRole('button', { name: 'Inbox' }).click();
  await expect(page.getByText(firstTask, { exact: true })).not.toBeVisible();
});

test('keeps long pending-invitation IDs inside the narrow setup layout', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `invite-owner-${suffix}@example.com`);
  const ownerHeaders = { authorization: `Bearer ${owner.token}` };
  const identifierSuffix = suffix.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const longIdentifier = `${'a'.repeat(48 - identifierSuffix.length)}${identifierSuffix}`;
  const workspaceResponse = await request.post(`${serverUrl}/api/workspaces`, {
    headers: ownerHeaders,
    data: { name: 'Long identifier Workspace', identifier: longIdentifier },
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = (await workspaceResponse.json()) as { id: string };

  const memberEmail = `invite-member-${suffix}@example.com`;
  const memberResponse = await request.post(`${serverUrl}/api/auth/register`, {
    data: { email: memberEmail, password: 'playwright-password' },
  });
  expect(memberResponse.status()).toBe(201);
  const member = (await memberResponse.json()) as { token: string };
  const memberHeaders = { authorization: `Bearer ${member.token}` };
  const accountSetup = await request.patch(`${serverUrl}/api/account/setup`, {
    headers: memberHeaders,
    data: { display_name: 'Invited member' },
  });
  expect(accountSetup.status()).toBe(200);
  const invitation = await request.post(
    `${serverUrl}/api/workspaces/${workspace.id}/invitations`,
    {
      headers: ownerHeaders,
      data: { email: memberEmail, role: 'member' },
    },
  );
  expect(invitation.status()).toBe(201);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByLabel('Email').fill(memberEmail);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.locator('button[type="submit"]', { hasText: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/setup\/workspace$/);
  await page.getByRole('button', { name: 'Join a Workspace' }).click();

  const metadata = page
    .locator('.settings-row small')
    .filter({ hasText: `/${longIdentifier}` });
  await expect(metadata).toBeVisible();
  expect(
    await metadata.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', {
      name: `Accept invitation to Long identifier Workspace (/${longIdentifier})`,
    }),
  ).toBeVisible();
});

test('prevents a session from reading another workspace', async ({
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const first = await register(request, `owner-${suffix}@example.com`);
  const second = await register(request, `outsider-${suffix}@example.com`);

  const create = await request.post(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks`,
    {
      headers: { authorization: `Bearer ${first.token}` },
      data: { title: 'Private workspace task' },
    },
  );
  expect(create.status()).toBe(201);
  const task = (await create.json()) as { id: string };

  const forbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({
    error: { code: 'forbidden' },
  });

  const activityForbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks/${task.id}/activity`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(activityForbidden.status()).toBe(403);

  const pageResponse = await request.post(
    `${serverUrl}/api/workspaces/${first.workspaceId}/documents`,
    {
      headers: { authorization: `Bearer ${first.token}` },
      data: {
        title: 'Private workspace page',
        project_id: null,
        parent_id: null,
      },
    },
  );
  expect(pageResponse.status()).toBe(201);
  const document = (await pageResponse.json()) as { id: string };
  const documentForbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/documents/${document.id}`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(documentForbidden.status()).toBe(404);
});

test('delivers collaboration activity through the notification inbox', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `collab-owner-${suffix}@example.com`);
  const memberEmail = `collab-member-${suffix}@example.com`;
  const member = await register(request, memberEmail);
  const ownerHeaders = { authorization: `Bearer ${owner.token}` };
  const memberHeaders = { authorization: `Bearer ${member.token}` };

  const invitationResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/invitations`,
    {
      headers: ownerHeaders,
      data: { email: memberEmail, role: 'member' },
    },
  );
  expect(invitationResponse.status()).toBe(201);
  const invitation = (await invitationResponse.json()) as { id: string };
  const accepted = await request.post(
    `${serverUrl}/api/invitations/${invitation.id}/accept`,
    { headers: memberHeaders },
  );
  expect(accepted.status()).toBe(204);

  const taskResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/tasks`,
    {
      headers: ownerHeaders,
      data: { title: 'Collaborate securely' },
    },
  );
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };
  const commentResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/tasks/${task.id}/comments`,
    {
      headers: memberHeaders,
      data: {
        body: 'Please review the **authorization boundary**.',
        parent_id: null,
        mention_ids: [],
      },
    },
  );
  expect(commentResponse.status()).toBe(201);

  await page.addInitScript(
    (token) => localStorage.setItem('kanleaf.session-token', token),
    owner.token,
  );
  await page.goto('/');
  await expect(page.getByLabel('Active workspace')).toContainText(
    owner.workspaceName,
  );
  await expect(page.getByLabel('1 unread')).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page
    .getByRole('button', { name: /commented on.*Collaborate securely/ })
    .click();

  await expect(page.getByLabel('Task title')).toHaveValue(
    'Collaborate securely',
  );
  await expect(
    page.locator('.activity-comment .markdown-preview strong'),
  ).toHaveText('authorization boundary');
  await expect(page.getByLabel('1 unread')).not.toBeVisible();

  await page
    .locator('.activity-comment')
    .filter({ hasText: 'authorization boundary' })
    .getByRole('button', { name: 'Reply' })
    .click();
  await page
    .getByLabel('Add comment')
    .fill('Confirmed. The boundary is enforced.');
  const replySaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/tasks/${task.id}/comments`),
  );
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await replySaved).status()).toBe(201);
  await expect(
    page.locator('.activity-comment-reply .markdown-preview'),
  ).toContainText('Confirmed. The boundary is enforced.');

  const memberNotifications = await request.get(
    `${serverUrl}/api/notifications`,
    {
      headers: memberHeaders,
    },
  );
  expect(memberNotifications.status()).toBe(200);
  expect(await memberNotifications.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        notification_type: 'reply',
        task_id: task.id,
      }),
    ]),
  );
});

async function register(request: APIRequestContext, email: string) {
  const response = await request.post(`${serverUrl}/api/auth/register`, {
    data: { email, password: 'playwright-password' },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as {
    token: string;
    user: { active_workspace_id: null; setup_stage: 'account' };
  };
  expect(payload.user).toMatchObject({
    active_workspace_id: null,
    setup_stage: 'account',
  });
  const headers = { authorization: `Bearer ${payload.token}` };
  const localPart = email.slice(0, email.indexOf('@'));
  const workspaceIdentifier = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const workspaceName = `${localPart} Workspace`;

  const accountSetup = await request.patch(`${serverUrl}/api/account/setup`, {
    headers,
    data: { display_name: localPart },
  });
  expect(accountSetup.status()).toBe(200);
  const workspaceResponse = await request.post(`${serverUrl}/api/workspaces`, {
    headers,
    data: { name: workspaceName, identifier: workspaceIdentifier },
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = (await workspaceResponse.json()) as {
    id: string;
    identifier: string;
    name: string;
  };
  const completed = await request.post(
    `${serverUrl}/api/account/setup/complete`,
    { headers },
  );
  expect(completed.status()).toBe(200);

  return {
    token: payload.token,
    workspaceId: workspace.id,
    workspaceIdentifier: workspace.identifier,
    workspaceName: workspace.name,
  };
}
