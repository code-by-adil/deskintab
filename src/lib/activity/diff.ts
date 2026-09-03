export type DiffLine = {
	kind: 'same' | 'added' | 'removed';
	text: string;
	before: number | null;
	after: number | null;
};

// Bounded line LCS. Large documents fall back to explicitly truncated excerpts,
// never a quadratic matrix on an arbitrary workspace file.
export function textDiff(before: string, after: string) {
	const a = before.split('\n'),
		b = after.split('\n');
	if (a.length * b.length > 1_000_000 || before.length + after.length > 100_000) {
		return {
			mode: 'excerpts' as const,
			before: before.slice(0, 20_000),
			after: after.slice(0, 20_000),
			truncated: true,
			lines: [] as DiffLine[],
		};
	}
	const width = b.length + 1,
		table = new Uint16Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i * width + j] =
				a[i] === b[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
	const lines: DiffLine[] = [];
	let i = 0,
		j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			lines.push({ kind: 'same', text: a[i], before: ++i, after: ++j });
		} else if (
			i < a.length &&
			(j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])
		) {
			lines.push({ kind: 'removed', text: a[i], before: ++i, after: null });
		} else {
			lines.push({ kind: 'added', text: b[j], before: null, after: ++j });
		}
	}
	return { mode: 'lines' as const, lines, truncated: false, before: '', after: '' };
}
export function decodeText(bytes: Uint8Array) {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return /[\x00-\x08\x0e-\x1f]/.test(text) ? null : text;
	} catch {
		return null;
	}
}
