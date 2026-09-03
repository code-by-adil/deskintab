import { expect, test } from '@playwright/test';

test('restoring a maximized window restores dock behavior', async ({ page }) => {
	await page.goto('/');
	const finder = page.locator('[data-app-id="finder"]');
	const dock = page.locator('.dock-container');
	await expect(finder.locator('.finder-shell')).toBeVisible();

	await page.getByRole('button', { name: 'Zoom Finder', exact: true }).click();
	await page.mouse.move(1100, 400);
	await expect(finder).toHaveClass(/maximized/);
	await expect(dock).toHaveClass(/dock-hidden/);

	await page.getByRole('button', { name: 'Minimize Finder', exact: true }).click();
	await expect(finder).toBeHidden();
	await expect(dock).not.toHaveClass(/dock-hidden/);
	await page.getByRole('button', { name: 'Launch Finder app', exact: true }).click();
	await page.mouse.move(1100, 400);
	await expect(finder).toHaveClass(/maximized/);
	await expect(dock).toHaveClass(/dock-hidden/);

	await page.getByRole('button', { name: 'Zoom Finder', exact: true }).click();
	await expect(finder).not.toHaveClass(/maximized/);
	await expect(dock).not.toHaveClass(/dock-hidden/);
});

for (const [command, title] of [
	['New Folder', 'New folder'],
	['New Document', 'New document'],
] as const) {
	test(`desktop ${command} reaches Finder after it has been closed`, async ({ page }) => {
		await page.goto('/');
		const finder = page.locator('[data-app-id="finder"]');
		await expect(finder.locator('.finder-shell')).toBeVisible();
		await page.getByRole('button', { name: 'Close Finder', exact: true }).click();
		await expect(finder).toHaveCount(0);

		await page.mouse.click(1000, 500, { button: 'right' });
		await page.getByRole('button', { name: command, exact: true }).click();
		await expect(finder.getByRole('heading', { name: title, exact: true })).toBeVisible();
		await finder.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(finder.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
	});
}

test('Control Center supports keyboard controls and keeps a manual theme choice', async ({
	page,
}) => {
	await page.goto('/');
	const toggle = page.getByRole('button', { name: 'Control Center', exact: true });
	await toggle.click();
	const controls = page.locator('#control-center');
	const lightMode = controls.getByRole('button', { name: 'Light mode', exact: true });
	const darkMode = controls.getByRole('button', { name: 'Dark mode', exact: true });
	await expect(lightMode).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(darkMode).toBeFocused();
	await expect(controls.getByRole('button', { name: 'Animations', exact: true })).toHaveCount(0);
	await expect(controls.getByText('Accent color', { exact: true })).toHaveCount(0);
	await expect(controls.locator('button button')).toHaveCount(0);

	await lightMode.click();
	await expect(lightMode).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('body')).toHaveClass('light');
	await darkMode.click();
	await expect(darkMode).toHaveAttribute('aria-pressed', 'true');
	await expect(lightMode).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('body')).toHaveClass('dark');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(
				() => JSON.parse(localStorage.getItem('macos:preferences')!).wallpaper.canControlTheme,
			),
		)
		.toBe(false);
	await page.keyboard.press('Escape');
	await expect(controls).toHaveCount(0);
	await expect(toggle).toBeFocused();

	await page.reload();
	await toggle.click();
	await expect(darkMode).toHaveAttribute('aria-pressed', 'true');
	await page.setViewportSize({ width: 390, height: 844 });
	const bounds = await controls.boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
	await controls.getByRole('button', { name: 'Open Wallpapers', exact: true }).click();
	await expect(controls).toHaveCount(0);
	await expect(page.locator('[data-app-id="wallpapers"]')).toBeVisible();
});

for (const stored of [
	'{broken',
	JSON.stringify({ theme: null, wallpaper: { id: 'missing' }, reduced_motion: 'yes' }),
]) {
	test(`invalid saved preferences recover without blocking the desktop: ${stored}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript((value) => {
			localStorage.setItem('macos:preferences', value);
		}, stored);
		await page.goto('/');
		await expect(page.locator('[data-app-id="finder"] .finder-shell')).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => JSON.parse(localStorage.getItem('macos:preferences')!).wallpaper.id),
			)
			.toBe('ventura');
		expect(errors).toEqual([]);
	});
}

for (const storage of ['legacy', 'current', 'both'] as const) {
	test(`retired notch settings are removed without changing other preferences: ${storage}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		const emojiRequests: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/emojis/')) emojiRequests.push(request.url());
		});
		await page.addInitScript((source) => {
			localStorage.setItem(
				'macos:preferences',
				JSON.stringify({
					...(source !== 'legacy' ? { show_notch: true } : {}),
					reduced_motion: true,
					theme: { scheme: 'dark', primaryColor: 'blue' },
					wallpaper: { id: 'ventura', canControlTheme: false },
				}),
			);
			if (source !== 'current') localStorage.setItem('macos:setting:should-show-notch', 'true');
		}, storage);
		await page.goto('/');

		for (let visit = 0; visit < 2; visit++) {
			if (visit > 0) await page.reload();
			await expect(page.locator('[data-app-id="finder"] .finder-shell')).toBeVisible();
			await expect(page.locator('.notch')).toHaveCount(0);
			await expect(page.getByRole('img', { name: 'Wink emoji' })).toHaveCount(0);
			await page.getByRole('button', { name: 'Control Center', exact: true }).click();
			const controls = page.locator('#control-center');
			await expect(controls).toBeVisible();
			await expect(controls.getByRole('button', { name: 'Notch', exact: true })).toHaveCount(0);
			await expect(
				controls.getByRole('button', { name: 'Dark mode', exact: true }),
			).toHaveAttribute('aria-pressed', 'true');
			await expect(controls.getByRole('button', { name: 'Animations', exact: true })).toHaveCount(
				0,
			);
			await expect(
				controls.getByRole('button', { name: 'Open Wallpapers', exact: true }),
			).toBeVisible();
			await expect
				.poll(() =>
					page.evaluate(() => {
						const saved = JSON.parse(localStorage.getItem('macos:preferences')!);
						return {
							hasNotch: Object.hasOwn(saved, 'show_notch'),
							legacy: localStorage.getItem('macos:setting:should-show-notch'),
							reducedMotion: saved.reduced_motion,
							theme: saved.theme,
							wallpaperId: saved.wallpaper.id,
							canControlTheme: saved.wallpaper.canControlTheme,
						};
					}),
				)
				.toEqual({
					hasNotch: false,
					legacy: null,
					reducedMotion: true,
					theme: { scheme: 'dark', primaryColor: 'blue' },
					wallpaperId: 'ventura',
					canControlTheme: false,
				});
		}
		expect(emojiRequests).toEqual([]);
		expect(errors).toEqual([]);
	});
}
