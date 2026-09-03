<script lang="ts">
	import { apps_config, type AppID } from '🍎/configs/apps/apps-config';

	const { app_id }: { app_id: AppID } = $props();
</script>

{#await apps_config[app_id].load() then { default: App }}
	<App />
{/await}
