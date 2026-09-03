export function normalizeWorkspacePath(input: string, base = '/') {
	const source = input.startsWith('/') ? input : `${base}/${input}`;
	const parts: string[] = [];

	for (const part of source.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}

	return `/${parts.join('/')}`;
}

export function workspaceDirname(path: string) {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === '/') return '/';
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
}

export function workspaceBasename(path: string) {
	const normalized = normalizeWorkspacePath(path);
	return normalized === '/' ? '/' : normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function workspaceExtension(path: string) {
	const name = workspaceBasename(path);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}
