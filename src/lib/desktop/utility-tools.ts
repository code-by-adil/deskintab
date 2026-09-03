import { tick } from 'svelte';
import {
	calculatorState,
	calculatorCalculate,
	calculatorSnapshot,
} from './calculator-state.svelte';
import { wallpaperContext, wallpaperCatalog, setAppearance } from './appearance';
import { wallpaperIds } from '../../configs/wallpapers/wallpaper.config';
import { revealDesktop } from './files';
import { AppError } from '../errors';
import { defineTool, optionalEnum, optionalBoolean, successfulResult } from '../webmcp/tool-utils';
const boolean = (input: Record<string, unknown>, key: string) =>
	input[key] === undefined ? undefined : optionalBoolean(input, key);
export const utilityTools: WebMCP.ModelContextTool[] = [
	defineTool({
		name: 'calculator_read',
		title: 'Read Calculator',
		description:
			'Read the shared Calculator display, precise numeric value, pending operation and repeat state. Does not open or change the app.',
		annotations: { readOnlyHint: true, untrustedContentHint: false },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		execute() {
			return successfulResult(calculatorSnapshot(), 'Read Calculator.');
		},
	}),
	defineTool({
		name: 'calculator_calculate',
		title: 'Calculate in Calculator',
		description:
			'Calculate using the visible Calculator state. Binary operations require operand and use current value unless value is provided. set requires value; clear resets; sign/percent/equals act on the current state. Returns the display and precise result.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			properties: {
				operation: {
					type: 'string',
					enum: [
						'set',
						'clear',
						'sign',
						'percent',
						'equals',
						'add',
						'subtract',
						'multiply',
						'divide',
					],
				},
				value: { type: 'number' },
				operand: { type: 'number' },
			},
			required: ['operation'],
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			for (const key of ['value', 'operand'])
				if (
					input[key] !== undefined &&
					(typeof input[key] !== 'number' || !Number.isFinite(input[key]))
				)
					throw new AppError('INVALID_INPUT', `${key} must be a finite number.`);
			const operation = optionalEnum(input, 'operation', [
				'set',
				'clear',
				'sign',
				'percent',
				'equals',
				'add',
				'subtract',
				'multiply',
				'divide',
			])!;
			calculatorCalculate(
				operation,
				input.value as number | undefined,
				input.operand as number | undefined,
			);
			await revealDesktop({ target: 'calculator', signal });
			await tick();
			return successfulResult(calculatorSnapshot(), `Calculator shows ${calculatorState.display}.`);
		},
	}),
	defineTool({
		name: 'wallpapers_read',
		title: 'Read wallpapers and appearance',
		description:
			'List available wallpaper IDs and read the selected wallpaper, theme matching, color scheme and reduced-motion preference.',
		annotations: { readOnlyHint: true, untrustedContentHint: false },
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		execute() {
			return successfulResult(
				{ current: wallpaperContext(), wallpapers: wallpaperCatalog() },
				'Read wallpaper choices and appearance.',
			);
		},
	}),
	defineTool({
		name: 'wallpapers_set',
		title: 'Set wallpaper and appearance',
		description:
			'Change wallpaper, theme matching, color scheme or reduced motion. Preferences persist in this browser. An explicit theme disables wallpaper theme matching. Opens Wallpapers and returns the new settings.',
		annotations: { readOnlyHint: false, untrustedContentHint: false },
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', enum: wallpaperIds },
				matchTheme: { type: 'boolean' },
				theme: { type: 'string', enum: ['light', 'dark'] },
				reducedMotion: { type: 'boolean' },
			},
			additionalProperties: false,
		},
		async execute(input, { signal }) {
			const options = {
				id: optionalEnum(input, 'id', wallpaperIds),
				matchTheme: boolean(input, 'matchTheme'),
				theme: optionalEnum(input, 'theme', ['light', 'dark']),
				reducedMotion: boolean(input, 'reducedMotion'),
			};
			if (options.theme && options.matchTheme)
				throw new AppError(
					'INVALID_INPUT',
					'Choose explicit theme or wallpaper theme matching, not both.',
				);
			if (!Object.keys(input).length)
				throw new AppError('INVALID_INPUT', 'Provide at least one appearance preference.');
			setAppearance(options);
			await revealDesktop({ target: 'wallpapers', signal });
			await tick();
			return successfulResult({ current: wallpaperContext() }, 'Updated desktop appearance.');
		},
	}),
];
