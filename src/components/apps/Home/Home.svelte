<script lang="ts">
	import { AppError } from '🍎/lib/errors';
	import { connectAppNavigation } from '🍎/lib/desktop/navigation';

	import { onMount } from 'svelte';
	import WorkspacePacks from './WorkspacePacks.svelte';
	import HomeIcon from '~icons/mdi/home-outline';
	import ToolsIcon from '~icons/mdi/toolbox-outline';
	import PackIcon from '~icons/mdi/archive-outline';
	import AddIcon from '~icons/mdi/plus';
	import {
		homeService,
		homeDocument,
		HOME_PROFILE_PATH,
		HOME_SKILLS_ROOT,
		type HomePreferences,
		type HomeRecord,
		type SkillInput,
		type SkillRecord,
	} from '🍎/lib/home/home';
	import { workspaceService } from '🍎/lib/workspace/workspace';
	import { revealDesktop } from '🍎/lib/desktop/files';

	type Pane = 'preferences' | 'toolbox' | 'packs';
	type PreferenceDraft = Omit<HomePreferences, 'referencePaths' | 'preferredSkillPaths'> & {
		references: string;
		preferredSkills: string;
	};
	let pane = $state<Pane>('preferences');
	let profile = $state.raw<HomeRecord | null>(null);
	let preferenceDraft = $state<PreferenceDraft | null>(null);
	let preferenceBase = $state('');
	let preferenceRevision = $state<string | null>(null);
	let preferenceStale = $state(false);
	let skills = $state.raw<Array<{ name: string; description: string; path: string }>>([]);
	let warnings = $state.raw<Array<{ path: string; message: string }>>([]);
	let truncated = $state(false);
	let skill = $state.raw<SkillRecord | null>(null);
	let skillDraft = $state<SkillInput | null>(null);
	let skillBase = $state('');
	let skillStale = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let opening = $state(false);
	let packBusy = $state(false);
	let error = $state('');
	let notice = $state('');
	let briefText = $state('');
	let alive = true;
	let refreshGeneration = 0;

	const preferencesDirty = $derived(
		preferenceDraft !== null && JSON.stringify(preferenceDraft) !== preferenceBase,
	);
	const skillDirty = $derived(skillDraft !== null && JSON.stringify(skillDraft) !== skillBase);
	const dirty = $derived(preferencesDirty || skillDirty);
	const busy = $derived(loading || saving || opening || packBusy);
	const currentStale = $derived(pane === 'preferences' ? preferenceStale : skillStale);

	function setPreferences(record: HomeRecord) {
		profile = record;
		const value = record.data.preferences;
		preferenceDraft = {
			displayName: value.displayName,
			instructions: value.instructions,
			language: value.language,
			timeZone: value.timeZone,
			outputFolder: value.outputFolder,
			references: value.referencePaths.join('\n'),
			preferredSkills: value.preferredSkillPaths.join('\n'),
		};
		preferenceBase = JSON.stringify(preferenceDraft);
		preferenceRevision = record.revision;
		preferenceStale = false;
	}
	function setSkill(record: SkillRecord) {
		skill = record;
		skillDraft = {
			name: record.name,
			description: record.description,
			instructions: record.instructions,
		};
		skillBase = JSON.stringify(skillDraft);
		skillStale = false;
	}
	function lines(value: string) {
		return [
			...new Set(
				value
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean),
			),
		];
	}
	function guardNavigation() {
		if (!dirty && !busy) return true;
		error = busy
			? 'Wait for this operation to finish.'
			: 'Save or discard your edits before leaving this form.';
		return false;
	}
	function choosePane(next: Pane) {
		if (next === pane || !guardNavigation()) return;
		pane = next;
		error = '';
		notice = '';
	}
	async function refresh() {
		if (saving || opening) return;
		const generation = ++refreshGeneration;
		const currentSkillPath = skill?.path;
		try {
			const [profileResult, catalogResult] = await Promise.allSettled([
				homeService.read(),
				homeService.listSkills(),
			]);
			if (!alive || generation !== refreshGeneration || saving || opening) return;
			briefText = '';
			if (profileResult.status === 'fulfilled') {
				const nextProfile = profileResult.value;
				if (preferencesDirty) {
					profile = nextProfile;
					preferenceStale = nextProfile.revision !== preferenceRevision;
				} else setPreferences(nextProfile);
			} else {
				preferenceStale = preferenceDraft !== null;
				error =
					profileResult.reason instanceof Error
						? profileResult.reason.message
						: 'Your Home profile could not be read.';
			}
			if (catalogResult.status === 'fulfilled') {
				const catalog = catalogResult.value;
				skills = catalog.skills;
				warnings = catalog.warnings;
				truncated = catalog.truncated;
				if (!skill && skillDraft && skillDirty) {
					const draftPath = `${HOME_SKILLS_ROOT}/${skillDraft.name}/SKILL.md`;
					skillStale = skills.some((item) => item.path === draftPath);
				}
			} else
				error =
					catalogResult.reason instanceof Error
						? catalogResult.reason.message
						: 'Your Toolbox could not be read.';
			if (currentSkillPath) {
				try {
					const nextSkill = await homeService.readSkill(currentSkillPath);
					if (
						!alive ||
						generation !== refreshGeneration ||
						saving ||
						opening ||
						skill?.path !== currentSkillPath
					)
						return;
					if (skillDirty) skillStale = nextSkill.revision !== skill.revision;
					else setSkill(nextSkill);
				} catch (cause) {
					if (!alive || generation !== refreshGeneration) return;
					skillStale = true;
					error = cause instanceof Error ? cause.message : 'The skill file could not be read.';
				}
			}
		} catch (cause) {
			if (!alive || generation !== refreshGeneration) return;
			if (preferencesDirty) preferenceStale = true;
			error = cause instanceof Error ? cause.message : 'Home could not be read.';
		} finally {
			if (alive && generation === refreshGeneration) loading = false;
		}
	}
	async function savePreferences(event?: SubmitEvent) {
		event?.preventDefault();
		if (!preferenceDraft || busy || preferenceStale) return;
		saving = true;
		refreshGeneration++;
		error = '';
		notice = '';
		try {
			const { references, preferredSkills, ...value } = preferenceDraft;
			const result = await homeService.save(
				{
					...value,
					referencePaths: lines(references),
					preferredSkillPaths: lines(preferredSkills),
				},
				preferenceRevision,
				{ actor: 'human' },
			);
			if (!alive) return;
			setPreferences(result);
			briefText = '';
			notice = 'Preferences saved for your next agent session.';
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : 'Preferences could not be saved.';
		} finally {
			if (alive) {
				saving = false;
				void refresh();
			}
		}
	}
	async function chooseSkill(path: string) {
		if (!guardNavigation()) return;
		opening = true;
		refreshGeneration++;
		error = '';
		notice = '';
		try {
			const record = await homeService.readSkill(path);
			if (alive) setSkill(record);
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : 'The skill could not be opened.';
		} finally {
			if (alive) opening = false;
		}
	}
	function newSkill() {
		if (!guardNavigation()) return;
		skill = null;
		skillDraft = { name: '', description: '', instructions: '' };
		skillBase = JSON.stringify(skillDraft);
		skillStale = false;
		error = '';
		notice = '';
	}
	async function saveSkill(event: SubmitEvent) {
		event.preventDefault();
		if (!skillDraft || busy || skillStale) return;
		saving = true;
		refreshGeneration++;
		error = '';
		notice = '';
		try {
			const result = await homeService.saveSkill({ ...skillDraft }, skill?.revision ?? null, {
				actor: 'human',
			});
			if (!alive) return;
			setSkill(result);
			briefText = '';
			notice = 'Skill saved in your Toolbox.';
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : 'The skill could not be saved.';
		} finally {
			if (alive) {
				saving = false;
				void refresh();
			}
		}
	}
	async function discard() {
		if (busy) return;
		error = '';
		notice = '';
		if (pane === 'toolbox') {
			skillDraft = null;
			skill = null;
			skillBase = '';
			skillStale = false;
		} else {
			preferenceDraft = null;
			preferenceBase = '';
			preferenceStale = false;
		}
		loading = true;
		await refresh();
	}
	async function showBrief() {
		if (!guardNavigation()) return;
		opening = true;
		error = '';
		try {
			const context = await homeService.getContext();
			if (alive) briefText = context.briefText;
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : 'The brief could not be read.';
		} finally {
			if (alive) opening = false;
		}
	}
	async function copyBrief() {
		try {
			await navigator.clipboard.writeText(briefText);
			notice = 'Agent brief copied.';
		} catch {
			error = 'Select the brief below and copy it.';
		}
	}
	async function reveal(path: string) {
		if (!guardNavigation()) return;
		try {
			await revealDesktop({ path });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'This workspace file could not be opened.';
		}
	}
	onMount(() => {
		alive = true;
		void refresh();
		const unsubscribe = workspaceService.subscribe(() => {
			void refresh();
		});
		const clearClose = homeDocument.setCloseGuard(guardNavigation);
		const clearPending = homeDocument.setPendingGuard((path) => {
			if (path === HOME_PROFILE_PATH && (preferencesDirty || (saving && pane === 'preferences')))
				return true;
			if (!skillDraft || (!skillDirty && !(saving && pane === 'toolbox'))) return false;
			return path === (skill?.path ?? `${HOME_SKILLS_ROOT}/${skillDraft.name}/SKILL.md`);
		});
		return () => {
			alive = false;
			refreshGeneration++;
			unsubscribe();
			clearClose();
			clearPending();
		};
	});
	onMount(() =>
		connectAppNavigation('home', {
			ready: () => !loading,
			read: () => ({ pane, skillPath: skill?.path ?? null, dirty, busy }),
			navigate: async ({ pane: nextPane, skillPath }) => {
				if (!guardNavigation()) throw new AppError('UNSAVED_EDITS', error);
				if (skillPath && nextPane && nextPane !== 'toolbox')
					throw new AppError('INVALID_INPUT', 'A skill opens in the toolbox pane.');
				if (skillPath) {
					const record = await homeService.readSkill(skillPath);
					if (!guardNavigation()) throw new AppError('UNSAVED_EDITS', error);
					setSkill(record);
				}
				choosePane(skillPath ? 'toolbox' : (nextPane ?? pane));
			},
		}),
	);
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || saving || packBusy) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>

<section class="home-shell" aria-label="Home">
	<header class="titlebar">
		<span class="traffic-space" aria-hidden="true"></span>
		<h1>Home</h1>
		<span class="save-status"
			>{saving ? 'Saving...' : dirty ? 'Unsaved changes' : 'Your working preferences'}</span
		>
	</header>
	<div class="home-layout">
		<aside aria-label="Home sections">
			<div class="home-mark">
				<HomeIcon width="30" height="30" aria-hidden="true" /><strong
					>{profile?.data.preferences.displayName || 'Your desktop'}</strong
				>
			</div>
			<button
				class={['nav-row', { selected: pane === 'preferences' }]}
				aria-pressed={pane === 'preferences'}
				onclick={() => choosePane('preferences')}
				disabled={busy}><HomeIcon width="18" height="18" aria-hidden="true" />Preferences</button
			>
			<button
				class={['nav-row', { selected: pane === 'toolbox' }]}
				aria-pressed={pane === 'toolbox'}
				onclick={() => choosePane('toolbox')}
				disabled={busy}><ToolsIcon width="18" height="18" aria-hidden="true" />Toolbox</button
			>
			<button
				class={['nav-row', { selected: pane === 'packs' }]}
				aria-pressed={pane === 'packs'}
				onclick={() => choosePane('packs')}
				disabled={busy}><PackIcon width="18" height="18" aria-hidden="true" />Workspace</button
			>
			<p class="sidebar-note">Save your preferences for the next agent session.</p>
		</aside>
		<main>
			{#if error}<p class="message error" role="alert">{error}</p>{/if}
			{#if notice}<p class="message notice" role="status">{notice}</p>{/if}
			{#if currentStale && pane !== 'packs'}<p class="message stale" role="status">
					This file changed while you were editing. Copy anything you want to keep, then discard and
					reload the saved version.
				</p>{/if}
			{#if loading}<p class="empty">Reading your workspace...</p>
			{:else if pane === 'preferences'}
				<div class="page-heading">
					<h2>Make yourself at home.</h2>
					<p>
						Save how you like reports written, which references to use, and where finished work
						belongs. Your agent can read these preferences before starting a task.
					</p>
				</div>
				{#if preferenceDraft}<form
						onsubmit={savePreferences}
						aria-label="Home preferences"
						aria-busy={saving}
					>
						<fieldset disabled={busy}>
							<label
								>Workspace name<input
									bind:value={preferenceDraft.displayName}
									placeholder="Your name or workspace name"
									maxlength="120"
									required
								/></label
							>
							<label
								>Working instructions<textarea
									bind:value={preferenceDraft.instructions}
									rows="5"
									maxlength="12000"
									placeholder="Use my client-update template. Start with decisions I need to make. Save editable source files alongside PDFs."
								></textarea></label
							>
							<div class="paired-fields">
								<label
									>Language<input
										bind:value={preferenceDraft.language}
										placeholder="English"
										maxlength="100"
									/></label
								><label
									>Time zone<input
										bind:value={preferenceDraft.timeZone}
										placeholder="Asia/Dhaka"
										spellcheck="false"
										maxlength="100"
									/></label
								>
							</div>
							<label
								>Output folder<input
									bind:value={preferenceDraft.outputFolder}
									placeholder="/Documents"
									spellcheck="false"
									maxlength="2048"
									required
								/></label
							>
							<label
								>Reference files<textarea
									bind:value={preferenceDraft.references}
									rows="3"
									placeholder="/Documents/Client update template.md"
									spellcheck="false"
									aria-describedby="home-references-hint"></textarea></label
							>
							<p id="home-references-hint" class="hint">
								One workspace file path per line. Include templates and examples you want agents to
								read.
							</p>
							<label
								>Preferred skills<textarea
									bind:value={preferenceDraft.preferredSkills}
									rows="2"
									placeholder="/Home/Skills/review-release/SKILL.md"
									spellcheck="false"
									aria-describedby="home-skills-hint"></textarea></label
							>
							<p id="home-skills-hint" class="hint">
								One SKILL.md path per line. Add reusable instructions in Toolbox.
							</p>
						</fieldset>
						<div class="form-actions">
							<span
								>{profile?.exists
									? 'Saved in this browser'
									: 'Save to create your Home profile'}</span
							><button
								type="button"
								onclick={discard}
								disabled={busy || (!preferencesDirty && !preferenceStale)}
								>{preferenceStale ? 'Discard and reload' : 'Discard changes'}</button
							><button
								class="primary"
								type="submit"
								disabled={busy || preferenceStale || (!preferencesDirty && profile?.exists)}
								>{saving ? 'Saving...' : 'Save preferences'}</button
							>
						</div>
					</form>{:else}<button
						onclick={() => {
							loading = true;
							void refresh();
						}}>Try again</button
					>{/if}
				<div class="file-actions">
					<button onclick={showBrief} disabled={busy || dirty}>View agent brief</button
					>{#if profile?.exists}<button
							onclick={() => reveal(HOME_PROFILE_PATH)}
							disabled={busy || dirty}>Open profile file</button
						>{/if}
				</div>
				{#if briefText}<section class="brief" aria-label="Agent brief">
						<div class="brief-heading">
							<h3>What your agent reads</h3>
							<button onclick={copyBrief}>Copy brief</button>
						</div>
						<pre>{briefText}</pre>
					</section>{/if}
			{:else if pane === 'toolbox'}
				<div class="page-heading toolbox-heading">
					<div>
						<h2>Toolbox</h2>
						<p>Reusable instructions your agents can read when they need them.</p>
					</div>
					<button onclick={newSkill} disabled={busy}
						><AddIcon width="15" height="15" aria-hidden="true" />Add skill</button
					>
				</div>
				<p class="capability-note">
					Each skill is a saved set of instructions for a task. Your connected agent reads and
					follows it with the tools it has available.
				</p>
				{#if skills.length}<div class="skill-list" aria-label="Saved skills">
						{#each skills as item (item.path)}<button
								class={['skill-row', { selected: skill?.path === item.path }]}
								aria-pressed={skill?.path === item.path}
								onclick={() => chooseSkill(item.path)}
								disabled={busy}
								><span><strong>{item.name}</strong><small>{item.description}</small></span><span
									class="skill-kind">Instructions</span
								></button
							>{/each}
					</div>{:else if !skillDraft}<div class="empty-state">
						<ToolsIcon width="34" height="34" aria-hidden="true" />
						<h3>Save instructions you use again.</h3>
						<p>
							Save the instructions for a release review, research brief, or another task you
							repeat.
						</p>
						<button onclick={newSkill}>Add your first skill</button>
					</div>{/if}
				{#if skillDraft}<form
						class="skill-editor"
						onsubmit={saveSkill}
						aria-label="Skill editor"
						aria-busy={saving}
					>
						<h3>{skill ? 'Edit skill' : 'New skill'}</h3>
						<fieldset disabled={busy}>
							<label
								>Skill name<input
									bind:value={skillDraft.name}
									readonly={!!skill}
									required
									pattern="[a-z0-9]+(-[a-z0-9]+)*"
									maxlength="64"
									placeholder="review-release"
									aria-describedby="skill-name-hint"
								/></label
							>
							<p id="skill-name-hint" class="hint">
								Use lowercase letters, numbers, and single hyphens. The name is also its folder
								name.
							</p>
							<label
								>Description<textarea
									bind:value={skillDraft.description}
									rows="2"
									maxlength="1024"
									required
									placeholder="When should an agent use this skill?"></textarea></label
							><label
								>Instructions<textarea
									class="instructions"
									bind:value={skillDraft.instructions}
									rows="9"
									maxlength="40000"
									required
									spellcheck="false"
									aria-describedby="skill-instructions-hint"
									placeholder="Describe the procedure and the result to leave behind."
								></textarea></label
							>
							<p id="skill-instructions-hint" class="hint">
								Include links to any supporting files or sources.
							</p>
						</fieldset>
						<div class="form-actions">
							<span>{skill ? 'Saved as SKILL.md' : 'Creates a folder in /Home/Skills'}</span><button
								type="button"
								onclick={discard}
								disabled={busy}
								>{skillStale
									? 'Discard and reload'
									: skillDirty
										? 'Discard changes'
										: 'Close editor'}</button
							><button
								class="primary"
								type="submit"
								disabled={busy || skillStale || (!skillDirty && !!skill)}
								>{saving ? 'Saving...' : 'Save skill'}</button
							>
						</div>
						{#if skill}<button
								class="path-link"
								type="button"
								onclick={() => reveal(skill!.path)}
								disabled={busy || dirty}>{skill.path}</button
							>{/if}
					</form>{/if}
				{#if warnings.length}<details class="warnings">
						<summary>{warnings.length} skill files need attention</summary
						>{#each warnings as warning (warning.path)}<p>
								<strong>{warning.path}</strong><br />{warning.message}
							</p>{/each}
					</details>{/if}
				{#if truncated}<p class="hint">
						The skill list has reached its display limit. Open additional skill files from Finder.
					</p>{/if}
			{:else}<WorkspacePacks onBusyChange={(value) => (packBusy = value)} />{/if}
		</main>
	</div>
</section>

<style>
	.home-shell {
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		border-radius: inherit;
		container-type: inline-size;
		color: var(--app-text);
		background: var(--app-surface);
		font-size: 13px;
	}
	.titlebar {
		height: var(--app-titlebar-height);
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 16px;
		background: var(--app-chrome);
		border-bottom: 1px solid var(--app-border);
	}
	.traffic-space {
		flex: 0 0 72px;
	}
	h1 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}
	.save-status {
		margin-left: auto;
		color: var(--app-text-secondary);
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.home-layout {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 170px minmax(0, 1fr);
	}
	aside {
		padding: 18px 10px;
		background: var(--app-sidebar);
		border-right: 1px solid var(--app-border);
		overflow: auto;
	}
	.home-mark {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 4px 9px 23px;
		color: var(--app-text-secondary);
	}
	.home-mark strong {
		color: var(--app-text);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	button,
	input,
	textarea {
		font: inherit;
	}
	button {
		cursor: pointer;
		min-height: var(--app-control-height);
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		padding: 5px 10px;
		color: var(--app-text);
		background: var(--app-control);
	}
	button:hover:not(:disabled) {
		background: var(--app-hover);
	}
	button:disabled {
		opacity: 0.48;
		cursor: default;
	}
	button:focus-visible,
	input:focus-visible,
	textarea:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--app-focus);
		outline-offset: 2px;
	}
	.nav-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
		padding: 8px;
		border-color: transparent;
		background: transparent;
		text-align: left;
		font-size: 12px;
	}
	.nav-row.selected {
		background: var(--app-selection);
	}
	.sidebar-note {
		margin: 24px 9px 0;
		font-size: 11px;
		color: var(--app-text-secondary);
		line-height: 1.6;
	}
	main {
		min-width: 0;
		min-height: 0;
		padding: 25px 26px;
		overflow: auto;
	}
	.page-heading {
		margin-bottom: 22px;
	}
	h2 {
		margin: 0 0 7px;
		font-size: 21px;
		font-weight: 650;
		letter-spacing: -0.45px;
	}
	.page-heading p {
		margin: 0;
		max-width: 470px;
		color: var(--app-text-secondary);
		font-size: 12px;
		line-height: 1.55;
	}
	h3 {
		margin: 0 0 14px;
		font-size: 13px;
		font-weight: 600;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-bottom: 15px;
		font-size: 12px;
	}
	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 8px 9px;
		border: 1px solid var(--app-control-border);
		border-radius: var(--app-control-radius);
		color: var(--app-text);
		background: var(--app-field);
		font-size: 12px;
		line-height: 1.45;
	}
	textarea {
		resize: vertical;
		min-height: 55px;
	}
	input[readonly] {
		color: var(--app-text-secondary);
		background: var(--app-surface-secondary);
	}
	.paired-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.hint {
		margin: -8px 0 18px;
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.5;
	}
	.form-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 14px 0;
		border-top: 1px solid var(--app-border);
	}
	.form-actions span {
		flex: 1;
		min-width: 125px;
		color: var(--app-text-secondary);
		font-size: 10px;
	}
	.form-actions button {
		font-size: 11px;
	}
	button.primary {
		color: var(--app-accent-text);
		background: var(--app-accent);
		border-color: transparent;
	}
	button.primary:hover:not(:disabled) {
		filter: brightness(1.08);
		background: var(--app-accent);
	}
	.message {
		margin: 0 0 16px;
		padding: 10px 12px;
		border-radius: var(--app-control-radius);
		font-size: 12px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--app-danger);
		background: var(--app-danger-bg);
	}
	.notice {
		color: var(--app-success);
		background: var(--app-surface-secondary);
	}
	.stale {
		color: var(--app-warning);
		background: var(--app-warning-bg);
	}
	.file-actions {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 12px;
	}
	.file-actions button,
	.path-link {
		min-height: 22px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--app-accent);
		font-size: 11px;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.brief {
		margin-top: 20px;
		border-top: 1px solid var(--app-border);
		padding-top: 18px;
	}
	.brief-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.brief-heading h3 {
		margin: 0;
	}
	.brief-heading button {
		font-size: 11px;
	}
	pre {
		margin: 0;
		font-family: inherit;
		font-size: 12px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
	.toolbox-heading {
		display: flex;
		align-items: start;
		gap: 14px;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.toolbox-heading > button {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: none;
		font-size: 11px;
	}
	.capability-note {
		margin: 0 0 19px;
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.5;
	}
	.skill-list {
		margin: 0 0 20px;
		border-top: 1px solid var(--app-border);
	}
	.skill-row {
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--app-border);
		border-radius: 0;
		padding: 13px 9px;
		display: flex;
		align-items: center;
		gap: 12px;
		text-align: left;
		background: transparent;
	}
	.skill-row.selected {
		background: var(--app-selection);
	}
	.skill-row > span:first-child {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.skill-row strong {
		font-size: 12px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.skill-row small {
		color: var(--app-text-secondary);
		font-size: 11px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.skill-kind {
		color: var(--app-text-secondary);
		font-size: 10px;
		flex: none;
	}
	.skill-editor {
		margin-top: 24px;
	}
	.instructions {
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.empty {
		color: var(--app-text-secondary);
		font-size: 12px;
	}
	.empty-state {
		padding: 32px 12px;
		text-align: center;
		color: var(--app-text-secondary);
	}
	.empty-state h3 {
		color: var(--app-text);
		margin: 15px 0 8px;
	}
	.empty-state p {
		max-width: 290px;
		margin: 0 auto 18px;
		font-size: 12px;
		line-height: 1.6;
	}
	.warnings {
		margin: 20px 0;
		color: var(--app-warning);
		font-size: 11px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.warnings summary {
		cursor: pointer;
	}
	@container (max-width: 620px) {
		.home-layout {
			grid-template-columns: 142px minmax(0, 1fr);
		}
		main {
			padding: 20px 18px;
		}
		.form-actions > span {
			flex-basis: 100%;
		}
		.skill-kind {
			display: none;
		}
	}
	@container (max-width: 480px) {
		.home-layout {
			display: flex;
			flex-direction: column;
		}
		aside {
			display: flex;
			flex: none;
			gap: 5px;
			padding: 8px;
			border-right: 0;
			border-bottom: 1px solid var(--app-border);
		}
		.home-mark,
		.sidebar-note {
			display: none;
		}
		.nav-row {
			width: auto;
			margin: 0;
			justify-content: center;
			font-size: 11px;
		}
		main {
			flex: 1;
			padding: 18px 15px;
		}
		.paired-fields {
			grid-template-columns: 1fr;
			gap: 0;
		}
		.toolbox-heading {
			flex-wrap: wrap;
		}
		.save-status {
			font-size: 10px;
		}
		h2 {
			font-size: 19px;
		}
	}
</style>
