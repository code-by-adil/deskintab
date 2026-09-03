import { expect, test, type Page } from '@playwright/test';
import { createCalculatorState, inputCalculator } from '../src/lib/calculator';

const cases: [string, string[], string][] = [
	['decimal arithmetic', ['0.1', 'add', '0.2', 'equals'], '0.3'],
	['ordinary negative operand', ['5', 'add', '3', 'sign', 'equals'], '2'],
	['sign preserves the decimal point', ['1.', 'sign', '5'], '-1.5'],
	['sign before entering a number', ['sign', '5'], '-5'],
	['negative second operand', ['5', 'multiply', 'sign', '2', 'equals'], '-10'],
	['adding a percentage', ['100', 'add', '15', 'percent', 'equals'], '115'],
	['subtracting a percentage', ['200', 'subtract', '10', 'percent', 'equals'], '180'],
	['multiplying by a percentage', ['200', 'multiply', '10', 'percent', 'equals'], '20'],
	['dividing by a percentage', ['200', 'divide', '10', 'percent', 'equals'], '2000'],
	['standalone percentage', ['50', 'percent'], '0.5'],
	['digit after exponential percentage', ['0.000001', 'percent', '2'], '2'],
	['decimal after exponential percentage', ['0.000001', 'percent', '.', '2'], '0.2'],
	[
		'converted operand still participates in arithmetic',
		['100', 'add', '15', 'percent', 'add', '5', 'equals'],
		'120',
	],
	['replacement operator', ['5', 'add', 'multiply', '3', 'equals'], '15'],
	['repeated equals', ['2', 'add', '3', 'equals', 'equals'], '8'],
	[
		'repeat percentage on a new number',
		['100', 'add', '15', 'percent', 'equals', '150', 'equals'],
		'172.5',
	],
	[
		'repeat percentage on the result',
		['100', 'add', '15', 'percent', 'equals', 'equals'],
		'132.25',
	],
	[
		'retain precision across equals',
		['1', 'divide', '3', 'equals', 'multiply', '3', 'equals'],
		'1',
	],
	['division by zero', ['1', 'divide', '0', 'equals'], 'Error'],
	['zero divided by zero', ['0', 'divide', '0', 'equals'], 'Error'],
	['recover after equals error', ['1', 'divide', '0', 'equals', '2', 'add', '3', 'equals'], '5'],
	['recover after chained error', ['1', 'divide', '0', 'add', '2', 'add', '3', 'equals'], '5'],
	['backspace corrects a number', ['123', 'backspace', '4'], '124'],
	['backspace removes negative last digit', ['1', 'sign', 'backspace'], '0'],
	['backspace keeps a pending operation', ['12', 'add', '34', 'backspace', 'equals'], '15'],
	['no duplicate decimal points', ['1.', '.', '5'], '1.5'],
	['bounded input', ['1234567890123'], '123456789012'],
	['clear discards pending arithmetic', ['12', 'add', 'clear', '3', 'equals'], '3'],
];

for (const [name, sequence, expected] of cases) {
	test(name, () => {
		const state = createCalculatorState();
		for (const token of sequence) {
			if (/^[\d.]+$/.test(token)) {
				for (const digit of token) inputCalculator(state, digit);
			} else inputCalculator(state, token);
		}
		expect(state.display).toBe(expected);
	});
}

async function openCalculator(page: Page) {
	await page.goto('/');
	await expect(page).toHaveTitle('Deskstead');
	await page.getByRole('button', { name: 'Launch Calculator app' }).click();
	const calculator = page.getByRole('application', {
		name: 'Calculator keyboard input',
		exact: true,
	});
	await expect(calculator).toBeVisible();
	return calculator;
}

test('cold launch accepts typing, symbols are visible, and results fit', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	// Make the original lazy-loading focus race deterministic.
	await page.route('**/Calculator/Calculator.svelte*', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 150));
		await route.continue();
	});
	const calculator = await openCalculator(page);
	const display = calculator.getByTestId('calculator-display');
	await expect(calculator).toBeFocused();
	await page.keyboard.type('100+15%=');
	await expect(display).toHaveText('115');
	for (const [name, symbol] of [
		['Add', '+'],
		['Subtract', '−'],
		['Multiply', '×'],
		['Divide', '÷'],
		['Equals', '='],
		['Toggle sign', '±'],
	]) {
		const button = calculator.getByRole('button', { name, exact: true });
		await expect(button).toBeVisible();
		await expect(button).toHaveText(symbol);
		await expect(button).toHaveCSS('opacity', '1');
	}
	await calculator.getByRole('button', { name: 'Clear', exact: true }).click();
	await page.keyboard.type('123456789012');
	await expect(display).toHaveText('123456789012');
	expect(await display.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	await page.keyboard.press('Backspace');
	await expect(display).toHaveText('12345678901');
	await calculator.getByRole('button', { name: 'Delete last digit' }).click();
	await expect(display).toHaveText('1234567890');
	await calculator.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(calculator.getByRole('button', { name: 'Add', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);

	await page.getByRole('button', { name: 'Minimize Calculator' }).click();
	await page.getByRole('button', { name: 'Launch Calculator app' }).click();
	await expect(calculator).toBeFocused();
	await page.keyboard.type('1=');
	await expect(display).toHaveText('1234567891');
	await page.getByRole('button', { name: 'Launch Finder app' }).click();
	await page.getByRole('textbox', { name: 'Search this folder' }).fill('123');
	await expect(display).toHaveText('1234567891');
	expect(errors).toEqual([]);
});

test('copy button, shortcut, and Edit menu copy the result', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const calculator = await openCalculator(page);
	await page.keyboard.type('6*7=');
	await calculator.getByRole('button', { name: 'Copy result', exact: true }).click();
	await expect(calculator.getByText('Copied', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('42');
	await page.keyboard.type('8+1=');
	await page.keyboard.press('ControlOrMeta+c');
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('9');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page
		.locator('.menu-parent')
		.getByRole('button', { name: 'Copy Result', exact: true })
		.click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('9');
});

test('clipboard failure is visible and does not break input', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: async () => {
					throw new DOMException('Denied', 'NotAllowedError');
				},
			},
			configurable: true,
		});
	});
	const calculator = await openCalculator(page);
	await calculator.getByRole('button', { name: 'Copy result', exact: true }).click();
	await expect(calculator.getByText('Could not copy', { exact: true })).toBeVisible();
	await page.keyboard.type('2+3=');
	await expect(calculator.getByTestId('calculator-display')).toHaveText('5');
});

test('compact and short viewports keep the result and keypad within the window', async ({
	page,
}) => {
	const calculator = await openCalculator(page);
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 568, height: 320 },
	]) {
		await page.setViewportSize(viewport);
		await calculator.getByRole('button', { name: 'Clear', exact: true }).click();
		await page.keyboard.type('123456789012');
		const display = calculator.getByTestId('calculator-display');
		await expect(display).toHaveText('123456789012');
		expect(await display.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
		const windowBox = await calculator.boundingBox();
		for (const button of await calculator.getByRole('button').all()) {
			const box = await button.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(windowBox!.x);
			expect(box!.x + box!.width).toBeLessThanOrEqual(windowBox!.x + windowBox!.width + 1);
			expect(box!.y + box!.height).toBeLessThanOrEqual(windowBox!.y + windowBox!.height + 1);
		}
		await calculator.getByRole('button', { name: 'Clear', exact: true }).click();
		for (const name of ['6', 'Multiply', '7', 'Equals'])
			await calculator.getByRole('button', { name, exact: true }).click();
		await expect(display).toHaveText('42');
	}
});
