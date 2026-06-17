export type ActionNoteRow = {
  noteText: string;
  visibilityClass: string;
  noteType?: string;
};

/** Doc 07 SC-011 / doc 08 visibility — protected notes hidden from owner view. */
export function filterNotesForView<T extends ActionNoteRow>(
  notes: T[],
  viewAs: "management" | "owner"
): T[] {
  if (viewAs === "management") return notes;
  return notes.filter((n) => n.visibilityClass !== "Management-Only Protected");
}

/** Doc 07 SC-012 — ordinary exports must not include protected note content. */
export function exportContainsProtectedContent(csv: string, protectedNotes: string[]): boolean {
  const lower = csv.toLowerCase();
  return protectedNotes.some((text) => text.trim().length > 0 && lower.includes(text.toLowerCase()));
}
