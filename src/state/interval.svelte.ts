export function create_interval(duration: number) {
	let time = $state(Date.now());

	$effect(() => {
		const interval = setInterval(() => (time = Date.now()), duration);
		return () => clearInterval(interval);
	});

	return {
		get value() {
			return time;
		},
	};
}
