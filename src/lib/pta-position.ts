/**
 * The "PTA Position" line of the reimbursement form, built from what the form
 * asks for. Teachers are asked for their grade and room and the line reads
 * "Teacher - 2nd - Room 106"; everyone else may type a position or leave it
 * blank, which reads "Volunteer". The log and the PDF only ever see the line.
 */

const ORDINALS: Record<string, string> = { TK: "TK", K: "K", "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "5": "5th" };

/** Suggestions for the grade box, youngest first. */
export const GRADE_LABELS = Object.values(ORDINALS);

/** "2" → "2nd", "K" → "K"; anything else as given. */
export function ordinalGrade(grade: string): string {
  return ORDINALS[grade] ?? grade;
}

/** The grades of a Users row as the form shows them: ["2"] → "2nd", ["1", "2"] → "1st/2nd", [] → "". */
export function gradeLabel(grades: string[]): string {
  return grades.map(ordinalGrade).join("/");
}

/** "2nd", "106" → "Teacher - 2nd - Room 106". A room typed as "Room 106" isn't doubled. */
export function teacherPosition(grade: string, room: string): string {
  return `Teacher - ${grade.trim()} - Room ${room.trim().replace(/^room\s*/i, "")}`;
}

/** The grade and room back out of a line `teacherPosition` built, or null for any other position. */
export function parseTeacherPosition(position: string): { grade: string; room: string } | null {
  const match = position.trim().match(/^Teacher - (.+?) - Room (.+)$/);
  return match ? { grade: match[1], room: match[2] } : null;
}

export const DEFAULT_POSITION = "Volunteer";

/** What a non-teacher typed, or "Volunteer" when they left it blank. */
export function otherPosition(typed: string): string {
  return typed.trim() || DEFAULT_POSITION;
}
