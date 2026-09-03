import { AppError } from '../errors';

export function requiredString(
	input: Record<string, unknown>,
	key: string,
	options: { allowEmpty?: boolean; maxLength?: number } = {},
) {
	const value = input[key];
	if (typeof value !== 'string') {
		throw new AppError('INVALID_INPUT', `${key} must be a string.`);
	}
	if (!options.allowEmpty && !value.trim()) {
		throw new AppError('INVALID_INPUT', `${key} cannot be empty.`);
	}
	if (value.length > (options.maxLength ?? 200_000)) {
		throw new AppError(
			'INPUT_TOO_LARGE',
			`${key} is longer than ${options.maxLength ?? 200_000} characters.`,
		);
	}
	return value;
}

export function optionalString(
	input: Record<string, unknown>,
	key: string,
	options: { allowEmpty?: boolean; maxLength?: number } = {},
) {
	return input[key] === undefined ? undefined : requiredString(input, key, options);
}

export function absolutePath(input: Record<string, unknown>, key: string) {
	const value = requiredString(input, key, { maxLength: 2_048 });
	if (!value.startsWith('/')) {
		throw new AppError(
			'INVALID_PATH',
			`${key} must be an absolute workspace path beginning with /.`,
			'Use files_list with path / to inspect the workspace roots.',
		);
	}
	return value;
}

export function optionalAbsolutePath(input: Record<string, unknown>, key: string) {
	return input[key] === undefined ? undefined : absolutePath(input, key);
}

export function optionalInteger(
	input: Record<string, unknown>,
	key: string,
	defaultValue: number,
	minimum: number,
	maximum: number,
) {
	const value = input[key] === undefined ? defaultValue : input[key];
	if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
		throw new AppError(
			'INVALID_INPUT',
			`${key} must be an integer between ${minimum} and ${maximum}.`,
		);
	}
	return value;
}

export function optionalBoolean(input: Record<string, unknown>, key: string, defaultValue = false) {
	const value = input[key] === undefined ? defaultValue : input[key];
	if (typeof value !== 'boolean') {
		throw new AppError('INVALID_INPUT', `${key} must be true or false.`);
	}
	return value;
}

export function optionalEnum<const T extends readonly string[]>(
	input: Record<string, unknown>,
	key: string,
	values: T,
) {
	const value = input[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !values.includes(value)) {
		throw new AppError('INVALID_INPUT', `${key} must be one of: ${values.join(', ')}.`);
	}
	return value as T[number];
}

export function successfulResult(
	data: Record<string, unknown>,
	summary: string,
	images: { type: 'image'; data: string; mimeType: string }[] = [],
) {
	return {
		content: [{ type: 'text', text: summary }, ...images],
		structuredContent: { ok: true, ...data },
	};
}

export function failedResult(error: unknown) {
	let code = 'OPERATION_FAILED';
	let message = error instanceof Error ? error.message : String(error);
	let hint: string | undefined;

	if (error instanceof AppError) {
		code = error.code;
		hint = error.hint;
	} else if (/ENOENT|no such file|does not exist/i.test(message)) {
		code = 'PATH_NOT_FOUND';
		hint = 'List the parent folder to inspect the available paths.';
	} else if (/ENOTDIR|not a directory/i.test(message)) {
		code = 'NOT_A_DIRECTORY';
	} else if (/EISDIR|is a directory/i.test(message)) {
		code = 'NOT_A_FILE';
	}

	return {
		content: [{ type: 'text', text: hint ? `${message} ${hint}` : message }],
		structuredContent: {
			ok: false,
			error: { code, message, ...(hint ? { hint } : {}) },
		},
	};
}

type ToolInputSchema = {
	type: 'object';
	properties: Record<string, object>;
	required?: readonly string[];
	additionalProperties: false;
};

function validateToolInput(input: unknown, schema: ToolInputSchema) {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new AppError('INVALID_INPUT', 'Tool arguments must be an object.');
	}
	for (const key of Object.keys(input)) {
		if (!Object.hasOwn(schema.properties, key)) {
			throw new AppError('INVALID_INPUT', `Unknown argument ${key}. Check the tool input schema.`);
		}
	}
	for (const key of schema.required ?? []) {
		if (!Object.hasOwn(input, key) || input[key] === undefined) {
			throw new AppError('INVALID_INPUT', `Provide the required argument ${key}.`);
		}
	}
}

export function defineTool(
	tool: Omit<WebMCP.ModelContextTool, 'execute' | 'inputSchema'> & {
		inputSchema: ToolInputSchema;
		execute: (
			input: Record<string, unknown>,
			options: WebMCP.ToolExecuteCallbackOptions,
		) => Promise<ReturnType<typeof successfulResult>> | ReturnType<typeof successfulResult>;
	},
): WebMCP.ModelContextTool {
	return {
		...tool,
		async execute(input, options) {
			const executeOptions = {
				...options,
				signal: options?.signal ?? new AbortController().signal,
			};
			try {
				executeOptions.signal.throwIfAborted();
				validateToolInput(input, tool.inputSchema);
				return await tool.execute(input, executeOptions);
			} catch (error) {
				if (executeOptions.signal.aborted) throw executeOptions.signal.reason;
				return failedResult(error);
			}
		},
	};
}
