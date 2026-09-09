export const MAX_SUMMARY_CLAIM_LENGTH = 1200;

/** Only selections wholly inside the enhanced document may become a claim. */
export function selectedSummaryClaim(selection: Selection | null, document: HTMLElement): string {
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return '';
  if (!document.contains(selection.anchorNode) || !document.contains(selection.focusNode)) return '';
  return selection.toString().trim();
}

export function summaryClaimQuestion(claim: string): string {
  const text = claim.trim();
  if (!text || text.length > MAX_SUMMARY_CLAIM_LENGTH) throw new Error('Select a statement of up to 1,200 characters.');
  return `Check this quoted statement against the original notes and transcript. Do not assume it is true:\n\n${text.split('\n').map(line => `> ${line}`).join('\n')}\n\nCite the evidence. Flag incorrect owners, deadlines, or approval status, and say when the sources are insufficient.`;
}
