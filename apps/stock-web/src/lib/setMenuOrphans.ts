/**
 * Which dishes stop being a question and start being an obligation.
 *
 * A set menu records the same dish twice, for two different jobs. Its
 * COMPONENTS are the costing — everything the menu contains, so the margin is
 * right. Its COURSES are the service — what the register asks the table.
 *
 * While a course exists it suppresses the matching component, so the dish is
 * chosen. Delete the course and nothing suppresses the component any more, so
 * the register puts the dish on every bill at $0 and fires it to the kitchen
 * without anybody having picked it.
 *
 * That is why "I removed the course and it still prints" is not a bug in the
 * removal — the removal worked. It is that removing a course silently converts
 * "ask the table" into "everyone gets one", and nothing in the editor said so.
 *
 * This works out what a given removal would strand, so the editor can say it.
 */

export type OrphanComponent = { subRecipeId: string; name: string };

type Course = { options: Array<{ recipeId: string }> };
type Component = {
  subRecipeId: string | null;
  ingredientName: string;
  subRecipe: { title: string } | null;
};

export function orphanedComponents(
  courses: Course[],
  removingIndex: number,
  components: Component[],
  alreadyDropping: string[] = []
): OrphanComponent[] {
  const removing = courses[removingIndex];
  if (!removing) return [];

  const leaving = new Set(removing.options.map((option) => option.recipeId));
  // A dish another course still serves is still a question after this removal,
  // so it is not stranded and must not be reported as one.
  const survives = new Set(
    courses.flatMap((course, index) => (index === removingIndex ? [] : course.options.map((option) => option.recipeId)))
  );
  const dropping = new Set(alreadyDropping);

  const seen = new Set<string>();
  const orphans: OrphanComponent[] = [];
  for (const line of components) {
    const id = line.subRecipeId;
    if (!id) continue; // a component that is only a name has no dish to strand
    if (!leaving.has(id) || survives.has(id) || dropping.has(id) || seen.has(id)) continue;
    seen.add(id);
    orphans.push({ subRecipeId: id, name: line.subRecipe?.title ?? line.ingredientName ?? 'this dish' });
  }
  return orphans;
}
