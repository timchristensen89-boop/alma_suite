// What a set menu still puts on a bill by itself, once it has courses. Pure so
// the rule can be tested without a database. Covered by set-menu-plan.test.ts.
//
// A set menu holds the same dishes in two places, for two different reasons.
// Its COMPONENTS are the costing: everything it contains, per person or
// shared, recorded so the margin is right. Its COURSES are the service: what
// the picker asks the table, in what order they fire, how many serves the
// kitchen plates.
//
// Those used to be separate lists. Then the seeder built the courses OUT of
// the components, and the register — which adds every component AND every
// course — started ringing each banquet dish twice: once at $0 on NOW from the
// component, and again from its course.
//
// Courses win. A course carries the sharing, the firing order and whatever
// alternates a manager has since added; the component behind it knows none of
// that. A component whose dish no course can serve is untouched: the bread and
// butter nobody is asked about still belongs on the bill.
//
// That left two lives for a component, and a menu needs three:
//
//   served by a course   costed, asked about, printed when chosen
//   fixed component      costed, not asked, printed on every bill
//   costingOnly          costed, not asked, NEVER printed
//
// The third is the drinks allowance. A banquet price has to carry what the
// table drinks on average, and the kitchen cannot plate an average — so those
// lines are counted by the costing and stop here.

export function courseDishIds(courses: Array<{ options: Array<{ recipeId: string }> }>): Set<string> {
  // Every dish these courses COULD put on a bill, whether or not the picker
  // ends up asking — a one-option course fills itself in without a question.
  return new Set(courses.flatMap((course) => course.options.map((option) => option.recipeId)));
}

export function stillFixed<T extends { subRecipeId: string | null; costingOnly?: boolean }>(
  components: T[],
  coursed: Set<string>
): T[] {
  return components.filter((line) => {
    // Costed, never served. A banquet's price carries the allowance for what
    // the table drinks, and the kitchen cannot plate an average — so these are
    // counted by the costing and never reach a bill or a docket.
    if (line.costingOnly) return false;
    // A component that is only a name has no dish to double up on, so it stays.
    return !(line.subRecipeId && coursed.has(line.subRecipeId));
  });
}
