<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppID } from '🍎/state/apps.svelte';
	import { markAppMounted } from '🍎/lib/desktop/navigation';
	const { app_id }: { app_id: AppID } = $props();
	onMount(() => markAppMounted(app_id));
</script>
