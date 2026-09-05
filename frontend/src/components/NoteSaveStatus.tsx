export function NoteSaveStatus({ saving, failed, onRetry }: {
  saving: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-stone-500">
      {failed ? 'Changes not saved' : saving ? 'Saving…' : 'Saved locally'}
      {failed && <button type="button" onClick={onRetry} className="font-medium text-red-700 underline">Retry</button>}
    </span>
  );
}
