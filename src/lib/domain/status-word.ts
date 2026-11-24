/**
 * A status code as a plain English word ("delivered_to_collector" -> "delivered to collector"),
 * for the English sentences of server messages and notices that embed a status. The visible
 * status labels are Spanish (see `$lib/components/ui/status.ts`); those sentences move to
 * Spanish with the copy tickets of Phase 15.
 */
export function statusWord(status: string): string {
	return status.replaceAll('_', ' ');
}
