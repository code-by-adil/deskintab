import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WEBMCP_TEST_PORT ?? 5187);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error('WEBMCP_TEST_PORT must be a port between 1024 and 65535.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: './tests',
	outputDir: '/tmp/os-webmcp-playwright-results',
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		baseURL,
		viewport: { width: 1440, height: 900 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
