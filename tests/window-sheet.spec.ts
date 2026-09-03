import { expect, test } from '@playwright/test';

test('a window sheet traps focus and returns it after a failed save', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Launch Activity app', exact: true }).click();
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Review', exact: true }).click();
	const opener = activity.getByRole('button', { name: 'New Summary…', exact: true });
	await opener.click();
	const form = activity.getByRole('dialog', { name: 'New work summary' });
	const title = form.getByRole('textbox', { name: 'Title', exact: true });
	await expect(title).toBeFocused();
	await title.press('Shift+Tab');
	await expect(form.getByRole('button', { name: 'Save Summary', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(title).toBeFocused();
	await title.fill('Summary draft');
	await page.evaluate(async () => {
		const { reviewService } = await import('/src/lib/activity/review.ts');
		reviewService.session = () =>
			new Promise((_, reject) => {
				Object.assign(window, {
					rejectSummarySave: () => reject(new Error('The saved summary changed.')),
				});
			});
	});
	await form.getByRole('button', { name: 'Save Summary', exact: true }).click();
	await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
	await expect(form).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(form).toHaveCount(1);
	await page.evaluate(() =>
		(window as unknown as { rejectSummarySave(): void }).rejectSummarySave(),
	);
	await expect(form.getByRole('alert')).toHaveText('The saved summary changed.');
	await expect(title).toHaveValue('Summary draft');
	await expect(form).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(form).toHaveCount(0);
	await expect(opener).toBeFocused();
});

test('finishing a window sheet save preserves focus in another app', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Launch Activity app', exact: true }).click();
	const activity = page.locator('[data-app-id="activity"]');
	await activity.getByRole('button', { name: 'Review', exact: true }).click();
	await activity.getByRole('button', { name: 'New Summary…', exact: true }).click();
	const form = activity.getByRole('dialog', { name: 'New work summary' });
	await form.getByRole('textbox', { name: 'Title', exact: true }).fill('Finished summary');
	await page.evaluate(async () => {
		const { reviewService } = await import('/src/lib/activity/review.ts');
		const save = reviewService.session;
		reviewService.session = async (...args) => {
			reviewService.session = save;
			await new Promise<void>((resolve) => {
				Object.assign(window, { finishSummarySave: resolve });
			});
			return save(...args);
		};
	});
	await form.getByRole('button', { name: 'Save Summary', exact: true }).click();
	await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Launch Calculator app', exact: true }).click();
	const calculator = page.locator('[data-app-id="calculator"]');
	const number = calculator.getByRole('button', { name: '7', exact: true });
	await number.click();
	await expect(number).toBeFocused();
	await page.evaluate(() =>
		(window as unknown as { finishSummarySave(): void }).finishSummarySave(),
	);
	await expect(form).toHaveCount(0);
	await expect(
		activity.getByRole('heading', { name: 'Finished summary', exact: true }),
	).toBeVisible();
	await expect(number).toBeFocused();
});
