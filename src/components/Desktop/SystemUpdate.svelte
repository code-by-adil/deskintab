<script lang="ts">
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import SystemDialog from '../SystemUI/SystemDialog.svelte';

	let system_update_dialog = $state<SystemDialog>();

	const { needRefresh, updateServiceWorker } = useRegisterSW({
		onRegistered(swr) {
			console.log(`SW registered: ${swr}`);
		},
		onRegisterError(error) {
			console.log('SW registration error', error);
		},
	});

	$effect(() => {
		if ($needRefresh) {
			system_update_dialog?.open();
		}
	});

	function close() {
		system_update_dialog.close();
		needRefresh.set(false);
	}

	async function handle_update_app() {
		updateServiceWorker();
	}
</script>

<SystemDialog bind:this={system_update_dialog}>
	<section class="system-update-section">
		<img
			width="128"
			height="128"
			src="/app-icons/system-preferences/256.webp"
			alt=""
			draggable="false"
		/>

		<h3 id="info-title">An update is ready</h3>
		<p id="info-description">Save your work, then reload to use the latest version.</p>

		<div class="buttons">
			<button onclick={close}>Later</button>
			<button class="confirm" onclick={handle_update_app}>Reload</button>
		</div>
	</section>
</SystemDialog>

<style>
	.system-update-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;

		padding: 1rem 0 0;

		width: 20rem;

		color: var(--system-color-dark);

		h3,
		p {
			text-align: center;
		}

		h3 {
			font-size: 1.2rem;
			font-weight: 500;
		}

		p {
			font-size: 0.9rem;
		}

		.buttons {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;

			width: 100%;

			button {
				width: 100%;
				height: 2rem;

				font-weight: 500;

				border-radius: 0.5rem;

				background-color: hsla(var(--system-color-dark-hsl), 0.2);

				&:hover {
					background-color: hsla(var(--system-color-dark-hsl), 0.3);
				}

				&.confirm {
					background-color: var(--system-color-primary);

					color: var(--system-color-primary-contrast);

					&:hover {
						background-color: hsla(var(--system-color-primary-hsl), 0.8);
					}
				}
			}
		}
	}
</style>
