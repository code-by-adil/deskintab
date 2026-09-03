import type {
	BufferEncoding,
	CpOptions,
	FileContent,
	FsStat,
	IFileSystem,
	MkdirOptions,
	RmOptions,
} from 'just-bash/browser';
import { normalizeWorkspacePath, workspaceDirname } from './path';
import { copyWorkspacePath, lstatIfExists, workspaceService, zenfs } from './workspace';
import { AppError } from '../errors';

function toFsStat(stats: Awaited<ReturnType<typeof zenfs.promises.stat>>): FsStat {
	return {
		isFile: stats.isFile(),
		isDirectory: stats.isDirectory(),
		isSymbolicLink: stats.isSymbolicLink(),
		mode: Number(stats.mode),
		size: Number(stats.size),
		mtime: stats.mtime,
		dev: stats.dev,
		ino: stats.ino,
	};
}

export class WorkspaceFileSystem implements IFileSystem {
	async #changed() {
		await workspaceService.refresh();
	}

	resolvePath(base: string, path: string) {
		return normalizeWorkspacePath(path, base);
	}

	getAllPaths() {
		return workspaceService.getAllPaths();
	}

	async readFile(path: string, options?: { encoding?: BufferEncoding | null } | BufferEncoding) {
		await workspaceService.ready();
		const encoding = (typeof options === 'string' ? options : options?.encoding) ?? 'utf8';
		return zenfs.promises.readFile(normalizeWorkspacePath(path), encoding);
	}

	async readFileBuffer(path: string) {
		await workspaceService.ready();
		const value = await zenfs.promises.readFile(normalizeWorkspacePath(path));
		return new Uint8Array(value);
	}

	async writeFile(
		path: string,
		content: FileContent,
		options?: { encoding?: BufferEncoding } | BufferEncoding,
	) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			const normalized = normalizeWorkspacePath(path);
			await zenfs.promises.mkdir(workspaceDirname(normalized), { recursive: true });
			await zenfs.promises.writeFile(normalized, content, options);
			await this.#changed();
		});
	}

	async appendFile(
		path: string,
		content: FileContent,
		options?: { encoding?: BufferEncoding } | BufferEncoding,
	) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			const normalized = normalizeWorkspacePath(path);
			await zenfs.promises.mkdir(workspaceDirname(normalized), { recursive: true });
			await zenfs.promises.appendFile(normalized, content, options);
			await this.#changed();
		});
	}

	async exists(path: string) {
		return workspaceService.exists(path);
	}

	async stat(path: string) {
		await workspaceService.ready();
		return toFsStat(await zenfs.promises.stat(normalizeWorkspacePath(path)));
	}

	async lstat(path: string) {
		await workspaceService.ready();
		return toFsStat(await zenfs.promises.lstat(normalizeWorkspacePath(path)));
	}

	async mkdir(path: string, options?: MkdirOptions) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.mkdir(normalizeWorkspacePath(path), { recursive: options?.recursive });
			await this.#changed();
		});
	}

	async readdir(path: string) {
		await workspaceService.ready();
		return zenfs.promises.readdir(normalizeWorkspacePath(path));
	}

	async readdirWithFileTypes(path: string) {
		await workspaceService.ready();
		const entries = await zenfs.promises.readdir(normalizeWorkspacePath(path), {
			withFileTypes: true,
		});
		return entries.map((entry) => ({
			name: entry.name,
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory(),
			isSymbolicLink: entry.isSymbolicLink(),
		}));
	}

	async rm(path: string, options?: RmOptions) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.rm(normalizeWorkspacePath(path), options);
			await this.#changed();
		});
	}

	async cp(source: string, destination: string, options?: CpOptions) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			try {
				await copyWorkspacePath(
					normalizeWorkspacePath(source),
					normalizeWorkspacePath(destination),
					options,
				);
			} finally {
				await this.#changed();
			}
		});
	}

	async mv(source: string, destination: string) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			const from = normalizeWorkspacePath(source),
				to = normalizeWorkspacePath(destination);
			const [sourceStat, destinationStat] = await Promise.all([
				zenfs.promises.lstat(from),
				lstatIfExists(to),
			]);
			if (destinationStat?.dev === sourceStat.dev && destinationStat.ino === sourceStat.ino) return;
			let backup: string | null = null;
			try {
				// ZenFS rename removes the replaced inode even if another name uses it.
				// Move linked targets aside, then unlink that one name after promotion.
				if (destinationStat?.isFile() && destinationStat.nlink > 1 && !sourceStat.isDirectory()) {
					do {
						backup = `${workspaceDirname(to)}/.move-${crypto.randomUUID()}`;
					} while (await lstatIfExists(backup));
					await zenfs.promises.rename(to, backup);
				}
				try {
					await zenfs.promises.rename(from, to);
				} catch (error) {
					if (backup) {
						try {
							await zenfs.promises.rename(backup, to);
						} catch {
							throw new AppError(
								'MOVE_RECOVERY_REQUIRED',
								`Move failed. The original destination is preserved at ${backup}.`,
								`Move ${backup} back to ${to} to restore it.`,
							);
						}
					}
					throw error;
				}
				workspaceService.notifyMove(from, to);
				if (backup) {
					try {
						await zenfs.promises.unlink(backup);
					} catch {
						throw new AppError(
							'MOVE_CLEANUP_FAILED',
							`Moved ${from} to ${to}, but the previous destination also remains at ${backup}.`,
							`Remove ${backup} to finish cleanup.`,
						);
					}
				}
			} finally {
				await this.#changed();
			}
		});
	}

	async chmod(path: string, mode: number) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.chmod(normalizeWorkspacePath(path), mode);
		});
	}

	async symlink(target: string, linkPath: string) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.symlink(target, normalizeWorkspacePath(linkPath));
			await this.#changed();
		});
	}

	async link(existingPath: string, newPath: string) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.link(
				normalizeWorkspacePath(existingPath),
				normalizeWorkspacePath(newPath),
			);
			await this.#changed();
		});
	}

	async readlink(path: string) {
		await workspaceService.ready();
		return zenfs.promises.readlink(normalizeWorkspacePath(path));
	}

	async realpath(path: string) {
		await workspaceService.ready();
		return zenfs.promises.realpath(normalizeWorkspacePath(path));
	}

	async utimes(path: string, atime: Date, mtime: Date) {
		return workspaceService.mutate(async () => {
			await workspaceService.ready();
			await zenfs.promises.utimes(normalizeWorkspacePath(path), atime, mtime);
			await this.#changed();
		});
	}
}
