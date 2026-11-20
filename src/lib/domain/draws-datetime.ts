const buenosAiresDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'America/Argentina/Buenos_Aires',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** Convert a timestamptz instant (PostgREST normally returns UTC) to a Buenos Aires wall clock. */
export function buenosAiresDateTimeLocal(timestamp: string): string {
	const instant = new Date(timestamp);
	if (Number.isNaN(instant.getTime())) return '';
	const parts = Object.fromEntries(
		buenosAiresDateTimeFormatter
			.formatToParts(instant)
			.filter((part) => part.type !== 'literal')
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
