import type { Adapters } from "@/server/adapters/types";
import { categoryChoices } from "@/server/ap/dashboard";

/**
 * AP gives a request its budget category from the dashboard: the only thing
 * Phase 2a writes. Only the `budget_category` cell is written, and nothing
 * else in the app writes that cell after the row is made, so it needs no row
 * lock: a chair signing or a new version at the same moment keeps it. Each
 * change is recorded in the Actions tab.
 */

export type CategoryProblem = "not-found" | "unknown";

export class CategoryError extends Error {
  constructor(readonly problem: CategoryProblem) {
    super(problem === "not-found" ? "No such request" : "Not one of the categories");
  }
}

export async function setCategory(
  input: { requestId: string; category: string; by: string; now?: Date },
  adapters: Pick<Adapters, "log" | "categories" | "actions">,
): Promise<"saved" | "unchanged"> {
  const { log, categories, actions } = adapters;
  const row = await log.get(input.requestId);
  if (!row) throw new CategoryError("not-found");
  const category = input.category.trim();
  // A blank clears it. Otherwise it must be in the dropdown as the page showed it, which keeps a category the request already has after it's made inactive.
  if (category && !categoryChoices(await categories.list(), row).options.includes(category)) throw new CategoryError("unknown");
  if (category === String(row.budget_category ?? "").trim()) return "unchanged";

  await log.update(row.request_id, { budget_category: category });
  try {
    await actions.append({ request_id: row.request_id, action: "category", by: input.by, at: (input.now ?? new Date()).toISOString(), note: category });
  } catch (error) {
    // The category is saved; only its line in the history is missing.
    console.error(`[ap category] ${row.request_id} is now "${category}", but the Actions tab didn't take the record:`, error);
  }
  return "saved";
}
