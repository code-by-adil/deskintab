// Content revisions stay valid across reloads and include changes made by Terminal.
export async function textRevision(content: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
