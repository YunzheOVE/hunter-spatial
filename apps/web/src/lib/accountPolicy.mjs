export const REVIEWER_EMAIL = "reviewer@login.cuny.edu";

export function isCampusEmail(email) {
  return typeof email === "string" && email.length <= 100 && /^[^\s@]+@login\.cuny\.edu$/i.test(email);
}
