import { expect, test, type Page } from '@playwright/test';

async function openFinder(page: Page) {
	await page.goto('/');
	const finder = page.locator('[data-app-id="finder"]');
	await expect(finder).toBeVisible();
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Projects/Launch/Sub/needle.md', 'needle evidence');
		await workspaceService.writeText('/Projects/Launch/other.md', 'other evidence');
	});
	return finder;
}

test('Finder search selection supports rename and desktop commands', async ({ page }) => {
	const finder = await openFinder(page);
	await finder.getByRole('textbox', { name: 'Search this folder' }).fill('needle');
	const original = finder.locator('[data-path="/Projects/Launch/Sub/needle.md"]');
	await expect(original).toBeVisible();
	await original.click({ button: 'right' });
	await finder.locator('.item-menu').getByRole('button', { name: 'Rename…' }).click();
	await expect(finder.getByLabel('Name', { exact: true })).toHaveValue('needle.md');
	await finder.getByLabel('Name', { exact: true }).fill('renamed.md');
	await finder.getByRole('button', { name: 'Rename', exact: true }).click();
	const renamed = finder.locator('[data-path="/Projects/Launch/Sub/renamed.md"]');
	await expect(renamed).toBeVisible();
	await expect(original).toHaveCount(0);
	await renamed.click();
	await page.evaluate(async () => {
		const { issueDesktopCommand } = await import('/src/lib/desktop/commands.ts');
		issueDesktopCommand('finder', 'duplicate');
	});
	await expect(finder.locator('[data-path="/Projects/Launch/Sub/renamed copy.md"]')).toBeVisible();
});

test('Finder refreshes an active search after another app writes a matching file', async ({
	page,
}) => {
	const finder = await openFinder(page);
	await finder.getByRole('textbox', { name: 'Search this folder' }).fill('needle');
	await expect(finder.locator('[data-path="/Projects/Launch/Sub/needle.md"]')).toBeVisible();
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		await workspaceService.writeText('/Projects/Launch/Sub/new.md', 'needle from the agent', {
			actor: 'agent',
		});
	});
	await expect(finder.locator('[data-path="/Projects/Launch/Sub/new.md"]')).toBeVisible();
});

test('Finder ignores search results that finish after a newer query', async ({ page }) => {
	const finder = await openFinder(page);
	await page.evaluate(async () => {
		const { workspaceService } = await import('/src/lib/workspace/workspace.ts');
		const search = workspaceService.search.bind(workspaceService);
		let release: () => void;
		const delayed = new Promise<void>((resolve) => {
			release = resolve;
		});
		Object.assign(window, { releaseFinderSearch: () => release() });
		workspaceService.search = async (query, ...args) => {
			const results = await search(query, ...args);
			if (query === 'needle') {
				Object.assign(window, { finderSearchWaiting: true });
				await delayed;
			}
			return results;
		};
	});
	const searchInput = finder.getByRole('textbox', { name: 'Search this folder' });
	await searchInput.fill('needle');
	await page.waitForFunction(
		() => (window as unknown as { finderSearchWaiting?: boolean }).finderSearchWaiting,
	);
	await searchInput.fill('other');
	await expect(finder.locator('[data-path="/Projects/Launch/other.md"]')).toBeVisible();
	await page.evaluate(() =>
		(window as unknown as { releaseFinderSearch(): void }).releaseFinderSearch(),
	);
	await page.waitForTimeout(50);
	await expect(searchInput).toHaveValue('other');
	await expect(finder.locator('[data-path="/Projects/Launch/Sub/needle.md"]')).toHaveCount(0);
	await expect(finder.locator('[data-path="/Projects/Launch/other.md"]')).toBeVisible();
});
