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

async function settingsPageGeometry(page: Page) {
  const settings = page.getByRole('region', { name: 'Workspace settings' });
  const articleLocator = settings.locator('.settings-article:visible');
  await expect(articleLocator).toBeVisible();
  await expect
    .poll(() =>
      articleLocator.evaluate((article) => {
        const rect = article.getBoundingClientRect();
        return article.isConnected && rect.width > 0 && rect.x > 0;
      }),
    )
    .toBe(true);
  return articleLocator.evaluate((article) => {
    const header = article.querySelector('.settings-header');
    const title = article.querySelector('h1');
    if (!header || !title) throw new Error('Settings page header is missing');
    const articleRect = article.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      articleX: articleRect.x,
      headerX: headerRect.x,
      headerWidth: headerRect.width,
      titleX: titleRect.x,
      titleY: titleRect.y,
    };
  });
}

async function expectSameSettingsGeometry(
  page: Page,
  expected: Awaited<ReturnType<typeof settingsPageGeometry>>,
) {
  await expect
    .poll(async () => {
      const actual = await settingsPageGeometry(page);
      return (
        Math.abs(actual.articleX - expected.articleX) < 0.5 &&
        Math.abs(actual.headerX - expected.headerX) < 0.5 &&
        Math.abs(actual.headerWidth - expected.headerWidth) < 0.5 &&
        Math.abs(actual.titleX - expected.titleX) < 0.5 &&
        Math.abs(actual.titleY - expected.titleY) < 0.5
      );
    })
    .toBe(true);
}

async function expectNestedDialogLayering(page: Page, popup: Locator) {
  await expect(popup).toBeVisible();
  await expect(page.locator('.app-dialog-backdrop')).toBeVisible();
  const layers = await page.evaluate(() => {
    const zIndex = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing modal layer: ${selector}`);
      return Number.parseInt(getComputedStyle(element).zIndex, 10);
    };

    return [
      zIndex('.settings-dialog-backdrop'),
      zIndex('.settings-dialog-viewport'),
      zIndex('.app-dialog-backdrop'),
      zIndex('.app-dialog-viewport'),
    ];
  });
  expect(layers).toEqual([...layers].sort((left, right) => left - right));
  expect(new Set(layers).size).toBe(layers.length);

  await expect
    .poll(() =>
      popup.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return Boolean(topmost && element.contains(topmost));
      }),
    )
    .toBe(true);
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
  await page.getByRole('button', { name: 'Settings for Studio' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/general$`),
  );
  await expect(
    page.getByRole('heading', { name: 'General', level: 1 }),
  ).toBeVisible();
  await page.getByLabel('Workspace name').fill('Studio Workspace');
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByText('Workspace updated')).toBeVisible();
  await expect(workspaceSelect).toContainText('Studio Workspace');
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await page.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await expect(
    page.getByRole('button', { name: 'Switch account' }),
  ).toContainText('Kanleaf Tester');
  await workspaceSelect.click();
  await page
    .getByRole('button', { name: 'Settings for Studio Workspace' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profile' })).not.toBeVisible();
  await page.setViewportSize({ width: 800, height: 640 });
  await page.getByRole('button', { name: 'Members' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/members$`),
  );
  await expect(page.getByText(`invitee-${suffix}@example.com`)).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.workspace-members-settings')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await expect(
    page.getByRole('button', { name: 'Invitations' }),
  ).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page
    .getByLabel('Email address')
    .fill(`second-invitee-${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel('Issued invitation token')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByText(`second-invitee-${suffix}@example.com`),
  ).toBeVisible();
  await page.getByRole('button', { name: 'States' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/states$`),
  );
  await page.getByPlaceholder('State name').fill('Review');
  await chooseSelectOption(page, 'State group', 'In progress');
  await page.getByRole('button', { name: 'Add state' }).click();
  await expect(
    page.getByRole('list', { name: 'Active task states' }),
  ).toContainText('Review');
  const statesGeometry = await settingsPageGeometry(page);
  await page.getByRole('button', { name: 'Labels' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/labels$`),
  );
  await expect(
    page.getByRole('list', { name: 'Active task labels' }),
  ).toBeVisible();
  await expectSameSettingsGeometry(page, statesGeometry);
  await page.getByRole('button', { name: 'Task types' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/task-types$`),
  );
  await page.getByPlaceholder('Type name').fill('Bug');
  await page.getByRole('button', { name: 'Choose Task type icon' }).click();
  await page.getByRole('button', { name: 'Bug', exact: true }).click();
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(
    page.getByRole('list', { name: 'Active task types' }),
  ).toContainText('Bug');
  await expectSameSettingsGeometry(page, statesGeometry);
  await page.getByRole('button', { name: 'Properties' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  const workspaceSettings = page.getByRole('region', {
    name: 'Workspace settings',
  });
  const workspaceSettingsNavigation = workspaceSettings.getByRole(
    'navigation',
    { name: 'Workspace settings sections' },
  );
  const propertiesNavigationItem = workspaceSettingsNavigation.getByRole(
    'button',
    { name: 'Properties' },
  );
  const propertiesArticle = workspaceSettings.locator(
    '.settings-article:visible',
  );
  await expectSameSettingsGeometry(page, statesGeometry);

  await propertiesArticle.getByRole('button', { name: 'New property' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties/new$`),
  );
  await expect(workspaceSettings).toBeVisible();
  await expect(propertiesNavigationItem).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('heading', { name: 'Create property' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(workspaceSettings).toBeVisible();

  await propertiesArticle.getByRole('button', { name: 'New property' }).click();
  await page.getByLabel('Name').fill('Story points');
  await chooseSelectOption(page, 'Property type', 'Number');
  await page.getByLabel('Description').fill('Relative delivery effort.');
  await page.getByRole('button', { name: 'Create property' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(
    page.getByRole('list', { name: 'Custom properties' }),
  ).toContainText('Story points');
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(
    page.getByRole('heading', { name: 'Create property' }),
  ).not.toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );

  await page.getByRole('button', { name: 'Story points', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties/[^/?]+$`),
  );
  const propertyDetailUrl = page.url();
  await expect(
    page.getByRole('heading', { name: 'Edit Story points' }),
  ).toBeVisible();
  await expect(workspaceSettings).toBeVisible();
  await expect(propertiesNavigationItem).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(
    page.getByRole('heading', { name: 'Properties', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(propertyDetailUrl);
  await page.getByRole('button', { name: 'Back to Properties' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(workspaceSettings).toBeVisible();

  await page.getByRole('button', { name: 'Story points', exact: true }).click();
  await expect(page).toHaveURL(propertyDetailUrl);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Edit Story points' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to Properties' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await page.goForward();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(workspaceSettings).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).not.toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));

  const narrowRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await expect(narrowRail).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigationDrawer = page.getByRole('dialog', {
    name: 'Workspace navigation',
  });
  await expect(navigationDrawer).toBeVisible();
  await expect(
    navigationDrawer.getByRole('navigation', { name: 'Workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inbox' })).toHaveCount(1);
  await navigationDrawer.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Kanleaf');
  await expect(page.getByLabel('Project ID')).toHaveValue('kanleaf');
  await page.getByRole('button', { name: 'Choose Project icon' }).click();
  await page.getByRole('button', { name: 'Rocket' }).click();
  await chooseSelectOption(page, 'Project visibility', 'Public');
  await page.getByRole('button', { name: 'Create Project' }).click();
  await expect(page.getByRole('heading', { name: 'Kanleaf' })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/p/[^/]+$`),
  );
  await expect(navigationDrawer).not.toBeVisible();
  await expect(narrowRail).toBeVisible();
  const projectIdentifier = new URL(page.url()).pathname.split('/')[4];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const desktopRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await expect(desktopRail).toBeVisible();
  await expect(page.locator('.navigation-pane-rail')).toHaveCSS(
    'width',
    '44px',
  );
  await expect(
    desktopRail.getByRole('button', { name: 'Saved Views' }),
  ).toBeVisible();
  await desktopRail.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }),
  ).toBeVisible();

  await page
    .locator('.project-header-actions')
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/settings/general$`,
    ),
  );
  const projectSettings = page.getByRole('region', {
    name: 'Project settings',
  });
  await expect(
    projectSettings.locator('.settings-navigation-body > nav'),
  ).toBeVisible();
  const projectNavigationGap = await projectSettings.evaluate((settings) => {
    const header = settings.querySelector('.settings-navigation-header');
    const navigation = settings.querySelector(
      '.settings-navigation-body > nav',
    );
    if (!header || !navigation) {
      throw new Error('Shared Project settings navigation is missing');
    }
    return (
      navigation.getBoundingClientRect().top -
      header.getBoundingClientRect().bottom
    );
  });
  expect(projectNavigationGap).toBeGreaterThanOrEqual(0);
  expect(projectNavigationGap).toBeLessThan(32);
  await page.getByLabel('Description').fill('Kanleaf Core delivery project.');
  await chooseSelectOption(
    page,
    'Visibility',
    'Public — Workspace Members can discover and join',
  );
  await page.getByRole('button', { name: 'Save general settings' }).click();
  await expect(page.getByText('Project details saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Danger zone' }).click();
  const archiveTrigger = page.getByRole('button', { name: 'Archive Project' });
  await archiveTrigger.click();
  const archiveDialog = page.getByRole('alertdialog', {
    name: 'Archive Kanleaf?',
  });
  await expectNestedDialogLayering(page, archiveDialog);
  await expect(
    archiveDialog.getByRole('button', { name: 'Cancel' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(archiveDialog).not.toBeVisible();
  await expect(projectSettings).toBeVisible();
  await expect(archiveTrigger).toBeFocused();
  await page.getByRole('button', { name: 'Features' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/settings/features$`,
    ),
  );
  const cyclesSwitch = page.getByRole('switch', { name: 'Cycles' });
  if ((await cyclesSwitch.getAttribute('aria-checked')) !== 'true') {
    await cyclesSwitch.click();
  }
  await expect(cyclesSwitch).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save features' }).click();
  await expect(page.getByText('Project features saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Project' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}$`),
  );
  await expect(page.getByText('Kanleaf Core delivery project.')).toBeVisible();

  const projectNavigation = page.locator('.project-subnav');
  await projectNavigation.getByRole('button', { name: 'Work items' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}/work-items$`),
  );
  await chooseSelectOption(page, 'Layout', 'Board');
  await projectNavigation.getByRole('button', { name: 'Library' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}/library$`),
  );
  await expect(page.locator('.document-detail-pane')).toBeVisible();
  await page.getByRole('button', { name: 'New Library note' }).click();
  await page.getByLabel('Note title').fill('Project handbook');
  const pageCreated = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      /\/api\/workspaces\/[^/]+\/documents$/.test(path)
    );
  });
  await page.getByRole('button', { name: 'Create note' }).click();
  const createdPage = (await (await pageCreated).json()) as {
    id: string;
    document_number: number;
  };
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/library\\?page=\\d+$`,
    ),
  );
  await page.goto(
    `/w/${workspaceIdentifier}/p/${projectIdentifier}/library/${createdPage.id}#legacy-page`,
  );
  await expect(page).toHaveURL(
    `/w/${workspaceIdentifier}/p/${projectIdentifier}/library?page=${createdPage.document_number}#legacy-page`,
  );
  await expect(
    page
      .locator('.document-detail-header')
      .getByRole('heading', { name: 'Project handbook' }),
  ).toBeVisible();
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
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}/cycles$`),
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
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/cycles/[^/?]+$`,
    ),
  );
  await page.reload();
  await expect(page).toHaveURL(cycleUrl);
  await expect(
    page.getByRole('heading', { name: 'Cycle 1', level: 2 }),
  ).toBeVisible();

  await projectNavigation.getByRole('button', { name: 'Modules' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}/modules$`),
  );
  await page.getByRole('button', { name: 'New module' }).click();
  await page.getByLabel('Module name').fill('Core');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Core', level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/modules/[^/?]+$`,
    ),
  );

  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Work items' })
    .click();

  await page.getByRole('button', { name: 'New task' }).click();
  const taskTitleInput = page.getByLabel('Task title');
  await taskTitleInput.fill('Complete the v0.1 workflow');
  await taskTitleInput.press('Enter');
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/work-items\\?task=\\d+$`,
    ),
  );
  const taskDetail = page.getByRole('region', { name: 'Task detail' });
  await expect(taskDetail.getByLabel('Task title')).toHaveValue(
    'Complete the v0.1 workflow',
  );

  await addTaskProperty(page, 'Story points');
  const storyPoints = page.getByLabel('Story points');
  await storyPoints.fill('3');
  const propertyUpdated = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'PUT' &&
      /\/api\/workspaces\/[^/]+\/tasks\/[^/]+\/properties\/[^/]+$/.test(path)
    );
  });
  await storyPoints.press('Enter');
  expect((await propertyUpdated).ok()).toBe(true);
  await expect(storyPoints).toHaveValue('3');

  await addTaskProperty(page, 'Cycle');
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Cycle', 'Cycle 1'),
  );
  await expect(page.getByRole('combobox', { name: 'Cycle' })).toHaveAttribute(
    'data-value',
    /.+/,
  );
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
  await chooseSelectOption(page, 'Project', 'Inbox');
  const moveTaskDialog = page.getByRole('alertdialog', {
    name: 'Move this Task?',
  });
  await expect(moveTaskDialog).toBeVisible();
  await expectTaskPatch(page, () =>
    moveTaskDialog.getByRole('button', { name: 'Move Task' }).click(),
  );

  await page.getByRole('button', { name: 'My Work' }).click();
  const taskRow = page
    .locator('.task-row-main')
    .filter({ hasText: 'Complete the v0.1 workflow' });
  await taskRow.click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/my-work\\?task=\\d+$`),
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
    new RegExp(`/w/${workspaceIdentifier}/p/${projectIdentifier}/views$`),
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
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/views/[^/?]+$`,
    ),
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
    .getByRole('button', { name: 'Settings for Studio Workspace' })
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
  await page.getByRole('button', { name: 'Import workspace' }).click();
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

test('preserves open Task state through pane and responsive resizing', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const email = `resize-${suffix}@example.com`;
  const account = await register(request, email);
  const headers = { authorization: `Bearer ${account.token}` };
  const createTask = async (title: string) => {
    const response = await request.post(
      `${serverUrl}/api/workspaces/${account.workspaceId}/tasks`,
      { headers, data: { title } },
    );
    expect(response.status()).toBe(201);
    return (await response.json()) as {
      id: string;
      task_number: number;
      title: string;
    };
  };
  const firstTask = await createTask('Resize continuity A');
  const secondTask = await createTask('Resize continuity B');

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.locator('button[type="submit"]', { hasText: 'Sign in' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/my-work$`),
  );
  await page.getByRole('button', { name: 'All tasks' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/tasks$`),
  );

  const firstRow = page
    .locator('.task-row-main')
    .filter({ hasText: firstTask.title });
  const secondRow = page
    .locator('.task-row-main')
    .filter({ hasText: secondTask.title });
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();
  await firstRow.click();
  await expect(page.getByLabel('Task title')).toHaveValue(firstTask.title);

  let releaseResolver = () => undefined;
  const holdResolver = new Promise<void>((resolve) => {
    releaseResolver = resolve;
  });
  await page.route(
    `**/api/workspaces/${account.workspaceId}/tasks/by-number/${secondTask.task_number}`,
    async (route) => {
      await holdResolver;
      await route.continue();
    },
  );
  const shell = page.locator('.workspace-shell');
  const navigation = page.locator('.navigation-pane');
  const taskList = page.locator('.task-list');
  await shell.evaluate((element) => {
    element.setAttribute('data-resize-continuity', 'shell');
  });
  await navigation.evaluate((element) => {
    element.setAttribute('data-resize-continuity', 'navigation');
  });
  await taskList.evaluate((element) => {
    element.setAttribute('data-resize-continuity', 'task-list');
  });

  await secondRow.click();

  await expect(page).toHaveURL(
    new RegExp(
      `/w/${account.workspaceIdentifier}/tasks\\?task=${secondTask.task_number}$`,
    ),
  );
  await expect(page.getByText('Opening your workspace…')).toHaveCount(0);
  await expect(shell).toHaveAttribute('data-resize-continuity', 'shell');
  await expect(navigation).toHaveAttribute(
    'data-resize-continuity',
    'navigation',
  );
  await expect(taskList).toHaveAttribute('data-resize-continuity', 'task-list');
  await expect(page.getByLabel('Task title')).toHaveValue(secondTask.title);
  const routeResolved = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(
          `/api/workspaces/${account.workspaceId}/tasks/by-number/${secondTask.task_number}`,
        ) && response.request().method() === 'GET',
  );
  releaseResolver();
  expect((await routeResolved).ok()).toBe(true);
  await page.unroute(
    `**/api/workspaces/${account.workspaceId}/tasks/by-number/${secondTask.task_number}`,
  );

  await page.route(
    `**/api/workspaces/${account.workspaceId}/tasks/${secondTask.id}/document`,
    async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort();
      } else {
        await route.continue();
      }
    },
  );
  await page.getByRole('button', { name: 'Source' }).click();
  const source = page.locator('.cm-content[contenteditable="true"]');
  await source.fill('# Unsaved resize draft');
  await expect(page.getByText('Save failed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add comment')).toBeVisible();
  await page.getByLabel('Add comment').fill('Activity draft survives resizing');
  const editor = page.locator('.cm-editor');
  const taskDetail = page.getByRole('region', { name: 'Task detail' });
  await editor.evaluate((element) => {
    element.setAttribute('data-resize-continuity', 'editor');
  });
  await taskDetail.evaluate((element) => {
    element.setAttribute('data-resize-continuity', 'detail');
  });
  await chooseSelectOption(page, 'Layout', 'Table');

  const workspaceRequests: string[] = [];
  page.on('request', (outgoing) => {
    const path = new URL(outgoing.url()).pathname;
    if (path.startsWith(`/api/workspaces/${account.workspaceId}/`)) {
      workspaceRequests.push(`${outgoing.method()} ${path}`);
    }
  });

  const drag = async (name: string, delta: number) => {
    const separator = page.getByRole('separator', { name });
    await expect(separator).toBeVisible();
    const bounds = await separator.boundingBox();
    expect(bounds).not.toBeNull();
    const startX = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + Math.min(bounds!.height / 2, 120);
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(startX + (delta * step) / 12, y);
    }
    await page.mouse.up();
  };

  await drag('Resize detail', -72);
  await drag('Resize navigation', 48);
  await chooseSelectOption(page, 'Layout', 'List');
  await drag('Resize collection', 64);

  await expect(source).toContainText('# Unsaved resize draft');
  await expect(page.getByLabel('Add comment')).toHaveValue(
    'Activity draft survives resizing',
  );
  await expect(taskDetail).toHaveAttribute('data-resize-continuity', 'detail');
  await expect(editor).toHaveAttribute('data-resize-continuity', 'editor');
  await expect(shell).toHaveAttribute('data-resize-continuity', 'shell');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ),
  ).toMatchObject({
    navigationWidth: 274,
    collectionWidth: 424,
    detailWidth: 512,
  });

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const desktopRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await expect(desktopRail).toBeVisible();
  await expect(
    page.getByRole('separator', { name: 'Resize navigation' }),
  ).toHaveCount(0);
  await expect(source).toContainText('# Unsaved resize draft');
  await expect(page.getByLabel('Add comment')).toHaveValue(
    'Activity draft survives resizing',
  );
  await desktopRail.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(
    page.getByRole('separator', { name: 'Resize navigation' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ),
  ).toMatchObject({ navigationWidth: 274, navigationCollapsed: false });
  await expect(taskDetail).toHaveAttribute('data-resize-continuity', 'detail');
  await expect(editor).toHaveAttribute('data-resize-continuity', 'editor');

  await page.setViewportSize({ width: 960, height: 640 });
  await expect(taskDetail).toBeVisible();
  await expect(taskList).not.toBeVisible();
  const narrowRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  const openNavigation = narrowRail.getByRole('button', {
    name: 'Open navigation',
  });
  await expect(openNavigation).toBeVisible();
  await expect
    .poll(async () => Math.round((await taskDetail.boundingBox())?.x ?? -1))
    .toBe(44);
  const detailBeforeDrawer = await taskDetail.boundingBox();
  expect(detailBeforeDrawer).not.toBeNull();

  await openNavigation.click();
  const navigationDrawer = page.getByRole('dialog', {
    name: 'Workspace navigation',
  });
  await expect(navigationDrawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inbox' })).toHaveCount(1);
  await expect(
    navigationDrawer.getByRole('button', { name: 'Switch account' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document
          .elementFromPoint(22, 100)
          ?.closest('.navigation-drawer-popup') !== null,
    ),
  ).toBe(true);
  expect(await taskDetail.boundingBox()).toEqual(detailBeforeDrawer);
  await expect(source).toContainText('# Unsaved resize draft');
  await page.keyboard.press('Escape');
  await expect(navigationDrawer).not.toBeVisible();
  await expect(openNavigation).toBeFocused();

  await openNavigation.click();
  await page.locator('.navigation-drawer-backdrop').click({
    position: { x: 8, y: 8 },
  });
  await expect(navigationDrawer).not.toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openNavigation.click();
  await expect(navigationDrawer).toBeVisible();
  await expect(page.locator('.navigation-drawer-popup')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await page.keyboard.press('Escape');
  await expect(navigationDrawer).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(taskList).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveValue(secondTask.title);
  await expect(source).toContainText('# Unsaved resize draft');
  await expect(page.getByLabel('Add comment')).toHaveValue(
    'Activity draft survives resizing',
  );
  await expect(taskDetail).toHaveAttribute('data-resize-continuity', 'detail');
  await expect(editor).toHaveAttribute('data-resize-continuity', 'editor');
  expect(workspaceRequests).toEqual([]);
});

test('keeps project navigation available through the rail and narrow drawer', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const email = `navigation-${suffix}@example.com`;
  const account = await register(request, email);
  const headers = { authorization: `Bearer ${account.token}` };
  const projectResponse = await request.post(
    `${serverUrl}/api/workspaces/${account.workspaceId}/projects`,
    {
      headers,
      data: {
        name: 'Rail Project',
        identifier: 'rail-project',
        icon: 'rocket',
      },
    },
  );
  expect(projectResponse.status()).toBe(201);

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.locator('button[type="submit"]', { hasText: 'Sign in' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/my-work$`),
  );
  await expect(
    page.getByRole('button', { name: 'Rail Project' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  const localWorkspaceRequests: string[] = [];
  page.on('request', (outgoing) => {
    const path = new URL(outgoing.url()).pathname;
    if (path.startsWith(`/api/workspaces/${account.workspaceId}/`)) {
      localWorkspaceRequests.push(`${outgoing.method()} ${path}`);
    }
  });

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const desktopRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await expect(desktopRail).toBeVisible();
  await expect(page.locator('.navigation-pane-rail')).toHaveCSS(
    'width',
    '44px',
  );
  for (const destination of ['Inbox', 'My Work', 'All tasks', 'Library']) {
    await expect(
      desktopRail.getByRole('button', { name: destination }),
    ).toBeVisible();
  }

  await desktopRail.getByRole('button', { name: 'Saved Views' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'No Saved Views yet' }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await desktopRail.getByRole('button', { name: 'Projects' }).click();
  expect(localWorkspaceRequests).toEqual([]);
  await page.getByRole('menuitem', { name: 'Rail Project' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/p/rail-project$`),
  );

  const activeProject = desktopRail.getByRole('button', {
    name: 'Rail Project',
  });
  await expect(activeProject).toHaveAttribute('aria-current', 'page');
  await activeProject.click();
  await page.getByRole('menuitem', { name: 'Work items' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/p/rail-project/work-items$`),
  );

  await desktopRail.getByRole('button', { name: 'Expand navigation' }).click();
  const fullNavigation = page.getByRole('navigation', { name: 'Workspace' });
  await expect(fullNavigation).toBeVisible();
  await expect(
    fullNavigation.getByRole('button', { name: 'Work items' }),
  ).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await page.setViewportSize({ width: 960, height: 640 });
  const narrowRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await narrowRail.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Active workspace')).toContainText(
    account.workspaceName,
  );
  await expect(
    drawer.getByRole('button', { name: 'Switch account' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inbox' })).toHaveCount(1);
  await drawer.getByRole('button', { name: 'Active workspace' }).click();
  await page
    .getByRole('button', { name: `Settings for ${account.workspaceName}` })
    .click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await narrowRail.getByRole('button', { name: 'Open navigation' }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Inbox' }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/w/${account.workspaceIdentifier}/inbox$`),
  );
  await expect(
    narrowRail.getByRole('button', { name: 'Inbox' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    desktopRail.getByRole('button', { name: 'Expand navigation' }),
  ).toBeVisible();
  await desktopRail.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(fullNavigation).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
  const taskTitleInput = page.getByLabel('Task title');
  await taskTitleInput.fill(firstTask);
  await taskTitleInput.press('Enter');
  const source = page.locator('.cm-content[contenteditable="true"]');
  await source.fill('# Account one\n\nSaved while switching accounts.');

  await page.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('button', { name: 'Add another account' }).click();
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
  await page.getByRole('button', { name: new RegExp(firstEmail) }).click();
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
  await page.getByRole('button', { name: new RegExp(secondEmail) }).click();
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

test('returns a new account to a direct invitation before explicit acceptance', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `direct-owner-${suffix}@example.com`);
  const inviteeEmail = `direct-invitee-${suffix}@example.com`;
  const issuedResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/invitations`,
    {
      headers: { authorization: `Bearer ${owner.token}` },
      data: { email: inviteeEmail, role: 'member' },
    },
  );
  expect(issuedResponse.status()).toBe(201);
  const issued = (await issuedResponse.json()) as {
    token: string;
    delivery: 'disabled';
    invitation_url: string;
  };
  expect(issued.delivery).toBe('disabled');
  expect(issued.invitation_url).toContain(`/invite#token=${issued.token}`);

  let acceptRequests = 0;
  page.on('request', (outgoing) => {
    if (outgoing.url().endsWith('/api/invitations/accept-token')) {
      acceptRequests += 1;
    }
  });
  await page.goto(`/invite#token=${issued.token}`);
  await expect(
    page.getByRole('heading', { name: owner.workspaceName }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create account' }),
  ).toBeVisible();
  expect(acceptRequests).toBe(0);

  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(inviteeEmail);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.getByLabel('Confirm password').fill('playwright-password');
  const registeredResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/auth/register'),
  );
  await page.getByRole('button', { name: 'Register' }).click();
  const registration = await registeredResponse;
  expect(registration.status()).toBe(201);
  const registered = (await registration.json()) as { token: string };

  await expect(
    page.getByRole('button', { name: 'Complete account setup' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Complete account setup' }).click();
  await expect(page).toHaveURL(/\/setup\/account$/);
  await page.getByRole('button', { name: 'Use default preferences' }).click();
  await expect(page).toHaveURL(new RegExp(`/invite#token=${issued.token}$`));
  await expect(
    page.getByRole('button', { name: 'Join workspace' }),
  ).toBeVisible();
  expect(acceptRequests).toBe(0);

  const beforeAcceptance = await request.get(`${serverUrl}/api/workspaces`, {
    headers: { authorization: `Bearer ${registered.token}` },
  });
  expect(beforeAcceptance.status()).toBe(200);
  expect(await beforeAcceptance.json()).toEqual([]);

  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${owner.workspaceIdentifier}/my-work$`),
  );
  expect(acceptRequests).toBe(1);
  await expect(page.getByLabel('Active workspace')).toContainText(
    owner.workspaceName,
  );
});

test('keeps an existing account on the invitation through sign in', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `login-owner-${suffix}@example.com`);
  const inviteeEmail = `login-invitee-${suffix}@example.com`;
  await register(request, inviteeEmail);
  const issuedResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/invitations`,
    {
      headers: { authorization: `Bearer ${owner.token}` },
      data: { email: inviteeEmail, role: 'member' },
    },
  );
  expect(issuedResponse.status()).toBe(201);
  const issued = (await issuedResponse.json()) as { token: string };

  let acceptRequests = 0;
  page.on('request', (outgoing) => {
    if (outgoing.url().endsWith('/api/invitations/accept-token')) {
      acceptRequests += 1;
    }
  });
  await page.goto(`/invite#token=${issued.token}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/forgot-password#returnTo=${encodeURIComponent(`/invite#token=${issued.token}`)}$`,
    ),
  );
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/invite#token=${issued.token}$`));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(inviteeEmail);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page
    .locator('form.auth-form')
    .getByRole('button', { name: 'Sign in' })
    .last()
    .click();

  await expect(page).toHaveURL(new RegExp(`/invite#token=${issued.token}$`));
  await expect(
    page.getByRole('button', { name: 'Join workspace' }),
  ).toBeVisible();
  expect(acceptRequests).toBe(0);
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${owner.workspaceIdentifier}/my-work$`),
  );
  expect(acceptRequests).toBe(1);
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
