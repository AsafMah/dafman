/// Extract a human-readable message from an unknown error value.
/// Used across every catch block to normalize error display.
export function toErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
