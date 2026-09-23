import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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

async function readTaskVaultSource(workspaceId: string, taskId: string) {
  const dataDir = process.env.KANLEAF_E2E_DATA_DIR;
  if (!dataDir) throw new Error('KANLEAF_E2E_DATA_DIR is not available');
  const workspaceRoot = join(dataDir, 'vaults', workspaceId);
  const paths = await readdir(workspaceRoot, { recursive: true });
  for (const relativePath of paths) {
    if (!relativePath.endsWith('.md')) continue;
    const source = await readFile(join(workspaceRoot, relativePath), 'utf8');
    if (source.includes(`Kanleaf ID: ${taskId}`)) return source;
  }
  throw new Error(`Could not find Markdown for Task ${taskId}`);
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
  const email = `e2e-${suffix}@example.com`;
  await page.getByLabel('Email').fill(email);
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
  const createdWorkspaceResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/workspaces'
    );
  });
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  const { id: workspaceId } = (await (
    await createdWorkspaceResponse
  ).json()) as { id: string };
  await expect(page).toHaveURL(/\/setup\/invite$/);
  await page.getByLabel('Email').fill(`invitee-${suffix}@example.com`);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel('Issued invitation token')).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  const workspaceSelect = page.getByRole('button', {
    name: /^Switch workspace, current workspace /,
  });
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
  await expect(
    page.getByRole('dialog', {
      name: 'Studio Workspace Workspace settings',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await expect(workspaceSelect).toContainText('Studio Workspace');
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
  const taskSettingsNavigation = workspaceSettingsNavigation.getByRole(
    'region',
    { name: 'Task Settings' },
  );
  await expect(taskSettingsNavigation.getByRole('button')).toHaveCount(1);
  await expect(
    workspaceSettingsNavigation.getByRole('button', { name: 'States' }),
  ).toHaveCount(0);
  await expect(
    workspaceSettingsNavigation.getByRole('button', { name: 'Labels' }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Property values' }),
  ).toBeVisible();
  await expect(page.getByText('Icon', { exact: true })).toHaveCount(0);
  const propertiesGeometry = await settingsPageGeometry(page);
  await expectSameSettingsGeometry(page, propertiesGeometry);

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
  await page.getByLabel('Name').fill('Type');
  await chooseSelectOption(page, 'Property type', 'Single select');
  await page.getByLabel('Property description').fill('Kind of work.');
  await page.getByRole('button', { name: 'Add option' }).click();
  const optionEditor = page.getByRole('dialog', { name: 'Add option' });
  await optionEditor.getByRole('textbox', { name: 'Option name' }).fill('Bug');
  await optionEditor.getByRole('checkbox', { name: 'Set as default' }).check();
  await optionEditor.getByRole('button', { name: 'Add option' }).click();
  await page.getByRole('button', { name: 'Create property' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(
    page.getByRole('list', { name: 'Custom properties' }),
  ).toContainText('Type');
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/settings/workspace/properties$`),
  );
  await expect(
    page.getByRole('list', { name: 'Custom properties' }),
  ).toContainText('Type');

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
    page.getByRole('region', { name: 'Project handbook Library note' }),
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
    page.getByRole('region', {
      name: 'Architecture decisions Library note',
    }),
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
    page.getByRole('region', {
      name: 'Architecture decisions Library note',
    }),
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

  await page.getByRole('button', { name: 'New Library note' }).click();
  await page.getByLabel('Note title').fill('Drag persistence check');
  await page.getByRole('button', { name: 'Create note' }).click();
  const dragHandle = page.getByRole('button', {
    name: 'Reorder Drag persistence check',
  });
  const parentRow = page
    .getByRole('treeitem', { name: 'Project handbook' })
    .locator('..');
  const handleBounds = await dragHandle.boundingBox();
  const parentBounds = await parentRow.boundingBox();
  if (!handleBounds || !parentBounds) {
    throw new Error('Library drag rows must have measurable bounds');
  }
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    parentBounds.x + parentBounds.width / 2,
    parentBounds.y + parentBounds.height / 2,
    { steps: 4 },
  );
  await expect(parentRow).toHaveAttribute('data-drop-intent', 'inside');
  const pageMoved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'PUT' &&
      /\/api\/workspaces\/[^/]+\/documents\/[^/]+\/move$/.test(path)
    );
  });
  await page.mouse.up();
  expect((await pageMoved).ok()).toBe(true);
  await expect(
    page.getByRole('treeitem', { name: 'Drag persistence check' }),
  ).toHaveAttribute('aria-level', '2');
  await page.reload();
  await expect(
    page.getByRole('treeitem', { name: 'Drag persistence check' }),
  ).toHaveAttribute('aria-level', '2');

  await page
    .getByRole('button', { name: 'Actions for Drag persistence check' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
  const deleteDialog = page.getByRole('alertdialog', {
    name: 'Delete “Drag persistence check”?',
  });
  await expect(deleteDialog).toBeVisible();
  const pageDeleted = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      /\/api\/workspaces\/[^/]+\/documents\/[^/]+\/delete$/.test(path)
    );
  });
  await deleteDialog
    .getByRole('button', { name: 'Delete permanently' })
    .click();
  expect((await pageDeleted).ok()).toBe(true);
  await expect(
    page.getByRole('treeitem', { name: 'Drag persistence check' }),
  ).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('treeitem', { name: 'Drag persistence check' }),
  ).not.toBeVisible();

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
  const createdTaskResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      new RegExp(`/api/workspaces/${workspaceId}/tasks$`).test(path)
    );
  });
  await taskTitleInput.press('Enter');
  const createdTask = (await (await createdTaskResponse).json()) as {
    id: string;
  };
  await expect(page).toHaveURL(
    new RegExp(
      `/w/${workspaceIdentifier}/p/${projectIdentifier}/work-items\\?task=\\d+$`,
    ),
  );
  const taskDetail = page.getByRole('region', { name: 'Task detail' });
  await expect(taskDetail.getByLabel('Task title')).toHaveValue(
    'Complete the v0.1 workflow',
  );
  await expect(
    taskDetail.getByRole('combobox', { name: 'Type', exact: true }),
  ).toContainText('Bug');

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
    chooseSelectOption(page, 'State', 'In Progress'),
  );
  await expectTaskPatch(page, () =>
    chooseSelectOption(page, 'Priority', 'Critical'),
  );
  await page.getByLabel('Edit assignees').click();
  await expectTaskPatch(page, () =>
    page.getByRole('menuitemcheckbox', { name: 'Kanleaf Tester' }).click(),
  );
  await page.keyboard.press('Escape');
  await expectTaskPatch(page, () =>
    page.getByLabel('Due date').fill('2026-09-30'),
  );
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
    .getByRole('option')
    .filter({ hasText: 'Complete the v0.1 workflow' });
  await expect(taskRow).toHaveCSS('min-height', '50px');
  await expect(taskRow.locator('.task-row-title')).toHaveCSS(
    'font-size',
    '15px',
  );
  await expect(taskRow.locator('.task-state-icon')).toHaveCSS('width', '30px');
  await expect(taskRow.locator('.task-state-icon')).toHaveCSS('height', '30px');
  await expect(taskRow.locator('.task-row-reference')).toHaveCount(0);
  await expect(taskRow.getByText('Critical')).toBeVisible();
  await taskRow.locator('.task-row-main').click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceIdentifier}/my-work\\?task=\\d+$`),
  );
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(page.getByRole('button', { name: 'Close task' })).toBeVisible();
  await expect(taskRow).toBeVisible();
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

  const taskToolbar = page.getByLabel('Task view controls');
  const taskSearch = page.getByLabel('Search tasks');
  await expect(taskSearch).toHaveAttribute('aria-keyshortcuts', '/');
  await page.keyboard.press('/');
  await expect(taskSearch).toBeFocused();
  await taskSearch.blur();
  await expect(taskToolbar.getByLabel('Layout')).toContainText('List');
  const filterControl = taskToolbar.getByLabel('Filter tasks');
  const filterLabel = filterControl.locator('.view-control-label');
  await expect(filterLabel).toBeVisible();
  const filterAlignment = await filterControl.evaluate((control) => {
    const icon = control.querySelector('svg');
    const label = control.querySelector('.view-control-label');
    if (!icon || !label) throw new Error('Filter control content is missing');
    const iconBox = icon.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    return Math.abs(
      iconBox.top + iconBox.height / 2 - (labelBox.top + labelBox.height / 2),
    );
  });
  expect(filterAlignment).toBeLessThan(2);
  await expect(
    taskToolbar.getByRole('combobox', { name: 'Group by', exact: true }),
  ).toContainText('State');
  await expect(taskToolbar.getByLabel('Sort by')).toContainText('Manual');
  await expect(taskToolbar.getByLabel('Visible task fields')).toContainText(
    'Properties',
  );
  await expect(taskToolbar.getByLabel('Save View')).toContainText('Save View');

  await page.setViewportSize({ width: 580, height: 700 });
  await expect(taskToolbar.getByLabel('Layout')).toBeVisible();
  await expect(
    taskToolbar.getByLabel('Layout').locator('.select-value'),
  ).toBeHidden();
  await expect(
    taskToolbar.getByLabel('Filter tasks').locator('.view-control-label'),
  ).toBeHidden();
  await expect(
    taskToolbar.getByLabel('Save View').locator('.view-control-label'),
  ).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'New task' }).locator('.task-new-label'),
  ).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('button', { name: 'Filter tasks' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Critical' }).click();
  await page.keyboard.press('Escape');
  await chooseSelectOption(page, 'Layout', 'Table');
  await page.getByRole('button', { name: 'Save View' }).click();
  await page.getByLabel('Name').fill('Urgent work');
  await page.getByRole('radio', { name: /Shared/ }).click();
  await page.getByRole('button', { name: 'Create View' }).click();
  await expect(page.getByRole('region', { name: 'Urgent work' })).toBeVisible();
  const savedViewUrl = page.url();
  await expect(page).toHaveURL(
    new RegExp(`/${workspaceIdentifier}/views/[^/?]+$`),
  );
  await page.getByRole('button', { name: 'My Work' }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));
  await page.goBack();
  await expect(page).toHaveURL(savedViewUrl);
  await expect(page.getByRole('region', { name: 'Urgent work' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${workspaceIdentifier}/my-work$`));

  await page.reload();
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  await expect(page.getByLabel('State')).toContainText('In Progress');
  await expect(
    page.getByRole('combobox', { name: 'Type', exact: true }),
  ).toContainText('Bug');
  await expect(page.getByLabel('Priority')).toHaveAttribute(
    'data-value',
    'critical',
  );
  await expect(page.getByLabel('Due date')).toHaveValue('2026-09-30');
  await expect(page.getByLabel('Start date')).toHaveValue('2026-09-01');
  await expect(
    page.getByRole('spinbutton', { name: 'Story points' }),
  ).toHaveValue('3');
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();
  await page.getByRole('button', { name: 'Source' }).click();
  const reloadedTaskSource = page.locator(
    '.cm-content[contenteditable="true"]',
  );
  await expect(reloadedTaskSource).toContainText('# Architecture');
  await expect(reloadedTaskSource).toContainText('Filesystem Markdown');
  await expect
    .poll(async () => {
      const source = await readTaskVaultSource(workspaceId, createdTask.id);
      return (
        source.includes('State:\n  - In Progress\n') &&
        source.includes('Type: Bug\n') &&
        source.includes('Priority:\n  - Critical\n') &&
        source.includes(`Assignees:\n  - ${email}\n`) &&
        source.includes('Start date: 2026-09-01\n') &&
        source.includes('Due date: 2026-09-30\n') &&
        source.includes('Story points: 3\n') &&
        source.includes('# Architecture') &&
        source.includes('Filesystem Markdown')
      );
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Reading' }).click();

  await page.getByRole('button', { name: 'Urgent work' }).click();
  await expect(page.getByLabel('Layout')).toHaveAttribute(
    'data-value',
    'table',
  );
  await expect(page.getByRole('table')).toContainText(
    'Complete the v0.1 workflow',
  );
  await expect(page.getByRole('columnheader', { name: 'Task' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'State' })).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Priority' }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Assignees' }),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Due' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Labels' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('columnheader', { name: 'Updated' })).toHaveCount(
    0,
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
    page.getByRole('region', { name: 'Project focus' }),
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
    page.getByRole('region', { name: 'Project focus' }),
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
    page.getByRole('region', { name: 'Project focus' }),
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
    page.getByRole('region', { name: 'Project handbook Library note' }),
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

test('preserves open Task state through overlay and responsive resizing', async ({
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
  const taskSurface = page.locator('.collection-pane');
  const closedTaskSurfaceBounds = await taskSurface.boundingBox();
  const closedShellBounds = await page
    .locator('.workspace-shell')
    .boundingBox();
  expect(closedTaskSurfaceBounds).not.toBeNull();
  expect(closedShellBounds).not.toBeNull();
  expect(
    Math.round(closedTaskSurfaceBounds!.x + closedTaskSurfaceBounds!.width),
  ).toBe(Math.round(closedShellBounds!.x + closedShellBounds!.width));
  await firstRow.click();
  await expect(page.getByLabel('Task title')).toHaveValue(firstTask.title);
  const taskDetail = page.getByRole('region', { name: 'Task detail' });
  const openTaskSurfaceBounds = await taskSurface.boundingBox();
  const openTaskDetailBounds = await taskDetail.boundingBox();
  expect(openTaskSurfaceBounds).toEqual(closedTaskSurfaceBounds);
  expect(openTaskDetailBounds).not.toBeNull();
  expect(openTaskDetailBounds!.x).toBeGreaterThan(openTaskSurfaceBounds!.x);
  expect(openTaskDetailBounds!.x).toBeLessThan(
    openTaskSurfaceBounds!.x + openTaskSurfaceBounds!.width,
  );
  expect(
    Math.round(openTaskDetailBounds!.x + openTaskDetailBounds!.width),
  ).toBe(Math.round(openTaskSurfaceBounds!.x + openTaskSurfaceBounds!.width));
  expect(openTaskDetailBounds!.width).toBeGreaterThan(
    closedShellBounds!.width * 0.5,
  );
  expect(openTaskDetailBounds!.width).toBeGreaterThanOrEqual(560);
  expect(openTaskDetailBounds!.width).toBeLessThanOrEqual(1100);
  await expect(
    page.getByRole('separator', { name: 'Resize task detail' }),
  ).toBeVisible();
  const pinnedProperties = taskDetail.locator('.task-pinned-properties');
  await expect
    .poll(() =>
      pinnedProperties.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);

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

  await secondRow.click({ position: { x: 40, y: 12 } });

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

  const taskSurfaceBeforeDrawerResize = await taskSurface.boundingBox();
  const detailResizeHandle = page.getByRole('separator', {
    name: 'Resize task detail',
  });
  await detailResizeHandle.focus();
  await detailResizeHandle.press('End');
  const detailAtMinimum = await taskDetail.boundingBox();
  expect(detailAtMinimum).not.toBeNull();
  expect(detailAtMinimum!.width).toBeGreaterThanOrEqual(560);
  expect(await taskSurface.boundingBox()).toEqual(
    taskSurfaceBeforeDrawerResize,
  );
  const pinnedItemsAtMinimum = pinnedProperties.locator(
    ':scope > [data-task-property]',
  );
  const firstPinnedBounds = await pinnedItemsAtMinimum.nth(0).boundingBox();
  const thirdPinnedBounds = await pinnedItemsAtMinimum.nth(2).boundingBox();
  expect(firstPinnedBounds).not.toBeNull();
  expect(thirdPinnedBounds).not.toBeNull();
  expect(thirdPinnedBounds!.y).toBeGreaterThan(firstPinnedBounds!.y);
  await expect
    .poll(() =>
      pinnedProperties.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  const detailBeforeResize = await taskDetail.boundingBox();
  await drag('Resize task detail', -96);
  const detailAfterResize = await taskDetail.boundingBox();
  expect(detailBeforeResize).not.toBeNull();
  expect(detailAfterResize).not.toBeNull();
  expect(detailAfterResize!.width).toBeGreaterThan(detailBeforeResize!.width);
  expect(await taskSurface.boundingBox()).toEqual(
    taskSurfaceBeforeDrawerResize,
  );
  await drag('Resize navigation', 48);
  await chooseSelectOption(page, 'Layout', 'List');
  await expect(
    page.getByRole('separator', { name: 'Resize collection' }),
  ).toHaveCount(0);

  await expect(source).toContainText('# Unsaved resize draft');
  await expect(page.getByLabel('Add comment')).toHaveValue(
    'Activity draft survives resizing',
  );
  await expect(taskDetail).toHaveAttribute('data-resize-continuity', 'detail');
  await expect(editor).toHaveAttribute('data-resize-continuity', 'editor');
  await expect(shell).toHaveAttribute('data-resize-continuity', 'shell');
  const storedPaneLayout = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
  );
  expect(storedPaneLayout).toMatchObject({
    navigationWidth: 274,
    collectionWidth: 360,
    taskDetailDrawerWidth: Math.round(detailAfterResize!.width),
  });
  expect(storedPaneLayout).not.toHaveProperty('detailWidth');

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
  await expect(taskSurface).toBeVisible();
  await expect(
    page.getByRole('separator', { name: 'Resize task detail' }),
  ).toHaveCount(0);
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
  const narrowTaskSurfaceBounds = await taskSurface.boundingBox();
  const detailBeforeDrawer = await taskDetail.boundingBox();
  const topBarBounds = await page.locator('.workspace-topbar').boundingBox();
  expect(narrowTaskSurfaceBounds).not.toBeNull();
  expect(detailBeforeDrawer).not.toBeNull();
  expect(topBarBounds).not.toBeNull();
  expect(Math.round(detailBeforeDrawer!.x)).toBe(
    Math.round(narrowTaskSurfaceBounds!.x),
  );
  expect(Math.round(detailBeforeDrawer!.width)).toBe(
    Math.round(narrowTaskSurfaceBounds!.width),
  );
  expect(Math.round(detailBeforeDrawer!.y)).toBe(
    Math.round(topBarBounds!.y + topBarBounds!.height),
  );
  await expect(taskDetail).toHaveCSS('border-top-left-radius', '0px');

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

  await page.setViewportSize({ width: 520, height: 700 });
  await expect(taskDetail).toBeVisible();
  await expect
    .poll(() =>
      pinnedProperties.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  const mobilePinnedItems = pinnedProperties.locator(
    ':scope > [data-task-property]',
  );
  const mobileFirstPinnedBounds = await mobilePinnedItems.nth(0).boundingBox();
  const mobileThirdPinnedBounds = await mobilePinnedItems.nth(2).boundingBox();
  expect(mobileFirstPinnedBounds).not.toBeNull();
  expect(mobileThirdPinnedBounds).not.toBeNull();
  expect(mobileThirdPinnedBounds!.y).toBeGreaterThan(
    mobileFirstPinnedBounds!.y,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(520);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(taskList).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveValue(secondTask.title);
  await expect(source).toContainText('# Unsaved resize draft');
  await expect(page.getByLabel('Add comment')).toHaveValue(
    'Activity draft survives resizing',
  );
  await expect(taskDetail).toHaveAttribute('data-resize-continuity', 'detail');
  await expect(editor).toHaveAttribute('data-resize-continuity', 'editor');
  await expect(
    page.getByRole('separator', { name: 'Resize task detail' }),
  ).toBeVisible();
  await expect(taskDetail).toHaveCSS('border-top-left-radius', '7px');
  expect(workspaceRequests).toEqual([]);
});

test('keeps Board geometry and scroll state beneath the Task detail overlay', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const email = `task-overlay-${suffix}@example.com`;
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
  const firstTask = await createTask('Overlay board A');
  const secondTask = await createTask('Overlay board B');

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('playwright-password');
  await page.locator('button[type="submit"]', { hasText: 'Sign in' }).click();
  await page.getByRole('button', { name: 'All tasks' }).click();
  await expect(
    page.locator('.task-row-main', { hasText: firstTask.title }),
  ).toBeVisible();
  await expect(
    page.locator('.task-row-main', { hasText: secondTask.title }),
  ).toBeVisible();
  await chooseSelectOption(page, 'Layout', 'Board');
  await page.waitForLoadState('networkidle');

  const board = page.locator('.task-board');
  const taskSurface = page.locator('.collection-pane');
  const shell = page.locator('.workspace-shell');
  await expect(board).toBeVisible();
  await shell.evaluate((element) => {
    Reflect.set(element, '__kanleafOverlayContinuity', 'shell');
  });
  await taskSurface.evaluate((element) => {
    Reflect.set(element, '__kanleafOverlayContinuity', 'task-surface');
  });
  await board.evaluate((element) => {
    Reflect.set(element, '__kanleafOverlayContinuity', 'board');
    element.scrollLeft = 80;
    element.scrollTop = 20;
  });
  const boardBounds = await board.boundingBox();
  const taskSurfaceBounds = await taskSurface.boundingBox();
  const boardScroll = await board.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  expect(boardBounds).not.toBeNull();
  expect(taskSurfaceBounds).not.toBeNull();
  expect(boardScroll.left).toBeGreaterThan(0);

  const taskListRequests: string[] = [];
  page.on('request', (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      outgoing.method() === 'GET' &&
      url.pathname === `/api/workspaces/${account.workspaceId}/tasks`
    ) {
      taskListRequests.push(url.pathname);
    }
  });

  await page
    .locator('.board-task', { hasText: firstTask.title })
    .dispatchEvent('click');
  const drawer = page.getByRole('region', { name: 'Task detail' });
  await expect(drawer.getByLabel('Task title')).toHaveValue(firstTask.title);
  await drawer.evaluate((element) => {
    Reflect.set(element, '__kanleafOverlayContinuity', 'drawer');
  });
  const drawerScroll = await drawer
    .locator('.detail-scroll')
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
  expect(drawerScroll).toBeGreaterThan(0);
  expect(
    await shell.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('shell');
  expect(
    await taskSurface.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('task-surface');
  expect(await board.boundingBox()).toEqual(boardBounds);
  expect(
    await board.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('board');
  expect(
    await board.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    })),
  ).toEqual(boardScroll);
  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds).not.toBeNull();
  expect(drawerBounds!.width).toBeGreaterThan(
    (await shell.boundingBox())!.width * 0.5,
  );
  expect(drawerBounds!.width).toBeGreaterThanOrEqual(560);
  expect(drawerBounds!.width).toBeLessThanOrEqual(1100);
  expect(drawerBounds!.x).toBeGreaterThan(taskSurfaceBounds!.x);
  expect(drawerBounds!.x).toBeLessThan(
    taskSurfaceBounds!.x + taskSurfaceBounds!.width,
  );
  expect(Math.round(drawerBounds!.x + drawerBounds!.width)).toBe(
    Math.round(taskSurfaceBounds!.x + taskSurfaceBounds!.width),
  );
  await expect(drawer).toHaveCSS('border-top-left-radius', '7px');
  await expect(drawer).toHaveCSS('border-top-right-radius', '0px');
  const detailResizeHandle = page.getByRole('separator', {
    name: 'Resize task detail',
  });
  await expect(detailResizeHandle).toBeVisible();
  const resizeBounds = await detailResizeHandle.boundingBox();
  expect(resizeBounds).not.toBeNull();
  const resizeStartX = resizeBounds!.x + resizeBounds!.width / 2;
  const resizeY = resizeBounds!.y + Math.min(resizeBounds!.height / 2, 120);
  await page.mouse.move(resizeStartX, resizeY);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(resizeStartX - (96 * step) / 12, resizeY);
  }
  await page.mouse.up();
  const resizedDrawerBounds = await drawer.boundingBox();
  expect(resizedDrawerBounds).not.toBeNull();
  expect(resizedDrawerBounds!.width).toBeGreaterThan(drawerBounds!.width);
  expect(await board.boundingBox()).toEqual(boardBounds);
  expect(await taskSurface.boundingBox()).toEqual(taskSurfaceBounds);
  await page
    .locator('.board-task', { hasText: secondTask.title })
    .click({ position: { x: 20, y: 12 } });
  await expect(drawer.getByLabel('Task title')).toHaveValue(secondTask.title);
  expect(
    await drawer.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('drawer');
  expect(
    await board.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('board');

  await drawer.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
  const deleteDialog = page.getByRole('alertdialog', {
    name: `Delete ${secondTask.title} permanently?`,
  });
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deleteDialog).not.toBeVisible();
  await expect(drawer).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  expect(
    await board.evaluate((element) =>
      Reflect.get(element, '__kanleafOverlayContinuity'),
    ),
  ).toBe('board');
  expect(await board.boundingBox()).toEqual(boardBounds);

  await page
    .locator('.board-task', { hasText: firstTask.title })
    .click({ position: { x: 20, y: 12 } });
  await expect(drawer.getByLabel('Task title')).toHaveValue(firstTask.title);
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(
    Math.round(resizedDrawerBounds!.width),
  );
  expect(taskListRequests).toEqual([]);

  await page.reload();
  await expect(drawer.getByLabel('Task title')).toHaveValue(firstTask.title);
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(
    Math.round(resizedDrawerBounds!.width),
  );
  await page.waitForLoadState('networkidle');
  taskListRequests.length = 0;
  const reloadedTaskSurfaceBounds = await taskSurface.boundingBox();
  await page.getByRole('separator', { name: 'Resize task detail' }).dblclick();
  const resetDrawerBounds = await drawer.boundingBox();
  expect(resetDrawerBounds).not.toBeNull();
  expect(resetDrawerBounds!.width).toBeLessThan(resizedDrawerBounds!.width);
  expect(resetDrawerBounds!.width).toBeGreaterThan(
    (await shell.boundingBox())!.width * 0.5,
  );
  expect(await taskSurface.boundingBox()).toEqual(reloadedTaskSurfaceBounds);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ),
  ).not.toHaveProperty('taskDetailDrawerWidth');
  await drawer.getByRole('button', { name: 'Close task' }).click();
  await expect(drawer).not.toBeVisible();
  await chooseSelectOption(page, 'Layout', 'Board');
  await expect(board).toBeVisible();

  await page.setViewportSize({ width: 960, height: 640 });
  await expect(shell).toHaveClass(/is-narrow-window/);
  await expect(board).toBeVisible();
  await expect(taskSurface).toBeVisible();
  await expect.poll(() => board.boundingBox()).not.toBeNull();
  await expect.poll(() => taskSurface.boundingBox()).not.toBeNull();
  const narrowBoardBounds = await board.boundingBox();
  const narrowTaskSurfaceBounds = await taskSurface.boundingBox();
  await page.locator('.board-task', { hasText: firstTask.title }).click();
  await expect(drawer.getByLabel('Task title')).toHaveValue(firstTask.title);
  await expect(
    page.getByRole('separator', { name: 'Resize task detail' }),
  ).toHaveCount(0);
  await expect(drawer).toHaveCSS('border-top-left-radius', '0px');
  const narrowDrawerBounds = await drawer.boundingBox();
  const topBarBounds = await page.locator('.workspace-topbar').boundingBox();
  expect(narrowBoardBounds).not.toBeNull();
  expect(narrowTaskSurfaceBounds).not.toBeNull();
  expect(narrowDrawerBounds).not.toBeNull();
  expect(topBarBounds).not.toBeNull();
  expect(await board.boundingBox()).toEqual(narrowBoardBounds);
  expect(Math.round(narrowDrawerBounds!.x)).toBe(
    Math.round(narrowTaskSurfaceBounds!.x),
  );
  expect(Math.round(narrowDrawerBounds!.width)).toBe(
    Math.round(narrowTaskSurfaceBounds!.width),
  );
  expect(Math.round(narrowDrawerBounds!.y)).toBe(
    Math.round(topBarBounds!.y + topBarBounds!.height),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(960);
  await drawer.getByRole('button', { name: 'Close task' }).click();
  await expect(drawer).not.toBeVisible();
  expect(taskListRequests).toEqual([]);
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

  const shell = page.locator('.workspace-shell');
  const workspacePopover = page.getByRole('dialog', {
    name: 'Workspace Switcher',
  });
  const expandedWorkspaceSwitcher = page.getByRole('button', {
    name: `Switch workspace, current workspace ${account.workspaceName}`,
  });
  const collapseNavigation = page.getByRole('button', {
    name: 'Collapse navigation',
  });
  const [workspaceSwitcherBox, navigationToggleBox] = await Promise.all([
    expandedWorkspaceSwitcher.boundingBox(),
    collapseNavigation.boundingBox(),
  ]);
  expect(workspaceSwitcherBox).not.toBeNull();
  expect(navigationToggleBox).not.toBeNull();
  expect(workspaceSwitcherBox?.x ?? 0).toBeLessThan(
    navigationToggleBox?.x ?? 0,
  );
  expect(
    (workspaceSwitcherBox?.x ?? 0) + (workspaceSwitcherBox?.width ?? 0),
  ).toBeLessThan(navigationToggleBox?.x ?? 0);

  await expandedWorkspaceSwitcher.click();
  await expect(workspacePopover).toBeVisible();
  await expect(workspacePopover.getByText(email)).toBeVisible();
  await expect(
    workspacePopover.getByRole('button', { name: 'New workspace' }),
  ).toBeVisible();
  await expect(
    workspacePopover.getByRole('button', { name: 'Import workspace' }),
  ).toBeVisible();
  await expect(
    workspacePopover.getByRole('button', {
      name: 'Workspace invitations',
    }),
  ).toBeVisible();
  await expect(shell).toHaveAttribute('data-navigation-mode', 'expanded');
  expect(localWorkspaceRequests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(expandedWorkspaceSwitcher).toBeFocused();

  await collapseNavigation.click();
  await expect(workspacePopover).not.toBeVisible();
  const desktopRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  await expect(desktopRail).toBeVisible();
  await expect(shell).toHaveAttribute('data-navigation-mode', 'rail');
  await expect(page.locator('.navigation-pane-rail')).toHaveCSS(
    'width',
    '44px',
  );
  const railWorkspaceSwitcher = desktopRail.getByRole('button', {
    name: `Switch workspace, current workspace ${account.workspaceName}`,
  });
  await expect(railWorkspaceSwitcher).toBeVisible();
  await expect(railWorkspaceSwitcher).not.toContainText(account.workspaceName);
  await railWorkspaceSwitcher.click();
  await expect(workspacePopover).toBeVisible();
  await expect(shell).toHaveAttribute('data-navigation-mode', 'rail');
  await expect(
    desktopRail.getByRole('button', { name: 'Expand navigation' }),
  ).toBeVisible();
  expect(localWorkspaceRequests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(railWorkspaceSwitcher).toBeFocused();
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
    page.getByRole('button', {
      name: `Switch workspace, current workspace ${account.workspaceName}`,
    }),
  ).toContainText(account.workspaceName);
  await expect(
    fullNavigation.getByRole('button', { name: 'Work items' }),
  ).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await page.setViewportSize({ width: 960, height: 640 });
  const narrowRail = page.getByRole('navigation', {
    name: 'Workspace navigation rail',
  });
  const narrowWorkspaceSwitcher = narrowRail.getByRole('button', {
    name: `Switch workspace, current workspace ${account.workspaceName}`,
  });
  await expect(narrowWorkspaceSwitcher).not.toContainText(
    account.workspaceName,
  );
  await narrowWorkspaceSwitcher.click();
  await expect(workspacePopover).toBeVisible();
  await expect(shell).toHaveAttribute('data-navigation-mode', 'rail');
  await page.keyboard.press('Escape');
  await expect(narrowWorkspaceSwitcher).toBeFocused();
  await narrowRail.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer).toBeVisible();
  const drawerWorkspaceSwitcher = drawer.getByRole('button', {
    name: `Switch workspace, current workspace ${account.workspaceName}`,
  });
  await expect(drawerWorkspaceSwitcher).toContainText(account.workspaceName);
  await expect(
    drawer.getByRole('button', { name: 'Switch account' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inbox' })).toHaveCount(1);
  await drawerWorkspaceSwitcher.click();
  await expect(workspacePopover).toBeVisible();
  await expect(drawer).toBeVisible();
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
  await expect(
    page.getByRole('button', {
      name: /^Switch workspace, current workspace /,
    }),
  ).toContainText(owner.workspaceName);
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
  await expect(
    page.getByRole('button', {
      name: /^Switch workspace, current workspace /,
    }),
  ).toContainText(owner.workspaceName);
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

test('synchronizes Task comments between live browser sessions', async ({
  browser,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `live-owner-${suffix}@example.com`);
  const memberEmail = `live-member-${suffix}@example.com`;
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
      data: { title: 'Realtime review' },
    },
  );
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as {
    id: string;
    task_number: number;
  };

  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await ownerPage.addInitScript(
      (token) => localStorage.setItem('kanleaf.session-token', token),
      owner.token,
    );
    await memberPage.addInitScript(
      (token) => localStorage.setItem('kanleaf.session-token', token),
      member.token,
    );
    const taskPath = `/w/${owner.workspaceIdentifier}/tasks?task=${task.task_number}`;
    await Promise.all([ownerPage.goto(taskPath), memberPage.goto(taskPath)]);
    await expect(ownerPage.getByLabel('Task title')).toHaveValue(
      'Realtime review',
    );
    await expect(memberPage.getByLabel('Task title')).toHaveValue(
      'Realtime review',
    );
    await expect(ownerPage.getByLabel('Add comment')).toBeVisible();
    await expect(memberPage.getByLabel('Add comment')).toBeVisible();
    await ownerPage.locator('.workspace-shell').evaluate((element) => {
      element.setAttribute('data-live-session', 'owner');
    });

    const commentBody = 'Visible in both sessions without a reload.';
    await memberPage.getByLabel('Add comment').fill(commentBody);
    const commentSaved = memberPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/tasks/${task.id}/comments`),
    );
    await memberPage
      .getByRole('button', { name: 'Comment', exact: true })
      .click();
    expect((await commentSaved).status()).toBe(201);

    await expect(
      ownerPage.locator('.activity-comment').filter({ hasText: commentBody }),
    ).toBeVisible();
    await expect(ownerPage.locator('.workspace-shell')).toHaveAttribute(
      'data-live-session',
      'owner',
    );
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
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
