/**
 * Turn a set menu's existing components into placeholder courses.
 *
 * A set menu already lists what it contains, as RecipeLine components costed
 * per person (or shared, via perGuests). Those components ARE the courses —
 * recorded for costing rather than for service — so rather than retyping the
 * structure in the course editor, this lifts each component into a course of
 * its own with that dish as its single option, ready to be renamed, merged and
 * given alternates by hand.
 *
 * Only components that point at a real dish (subRecipeId) become courses: a
 * course with nothing to choose would leave the register's picker unable to
 * finish the table. Lines that are only a name are listed and skipped.
 *
 * Each course also gets the POS course it FIRES on, worked out by
 * src/lib/course-flow.ts: drinks and the dips-and-chips go on NOW, then the
 * rest flow through Course 1, 2, 3 ... with the mains and the sides together.
 * Without it the register falls back to the course's own name, and since these
 * courses are named after their dish, a banquet came out as a dozen one-dish
 * "courses" on the fire screen.
 *
 * Menus that already have courses are left alone — this seeds, it does not
 * overwrite hand-built work. There are TWO exceptions, both filling in a blank
 * a course seeded before the column existed could not have known:
 *
 *   perGuests — a course with no idea its dish is shared makes the register
 *   send one board of fries per head.
 *
 *   posCourse — a course with no firing order makes the register invent one
 *   from the dish name.
 *
 * Both are written only where they are still NULL. A course somebody has set
 * by hand is left exactly as it is, and nothing else about an existing course
 * is touched.
 *
 *   node --import tsx scripts/seed-set-menu-courses.ts
 *   node --import tsx scripts/seed-set-menu-courses.ts --apply
 */
import { prisma } from '@alma/db';
import { NOW, planCourseFlow, type CourseDish } from '../src/lib/course-flow.js';

async function main() {
  const apply = process.argv.includes('--apply');

  const menus = await prisma.recipe.findMany({
    where: { kind: 'SET_MENU', status: 'ACTIVE' },
    orderBy: { title: 'asc' },
    select: {
      id: true,
      title: true,
      venue: true,
      lines: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          ingredientName: true,
          perGuests: true,
          subRecipeId: true,
          subRecipe: { select: { id: true, title: true, kind: true, category: true } }
        }
      },
      _count: { select: { setMenuCourses: true } },
      setMenuCourses: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          posCourse: true,
          perGuests: true,
          options: {
            orderBy: { sortOrder: 'asc' },
            select: { recipeId: true, recipe: { select: { title: true, kind: true, category: true } } }
          }
        }
      }
    }
  });

  const skipped: string[] = [];
  const backfill: Array<{ id: string; perGuests: number; label: string }> = [];
  const firing: Array<{ id: string; posCourse: string; label: string }> = [];
  const nameOnly: string[] = [];
  const planned: Array<{
    menu: (typeof menus)[number];
    courses: Array<{ name: string; recipeId: string; shared: number | null; posCourse: string }>;
  }> = [];

  for (const menu of menus) {
    const label = `${menu.venue ?? 'shared'} · ${menu.title}`;
    if (menu._count.setMenuCourses > 0) {
      skipped.push(`${label} — already has ${menu._count.setMenuCourses} course(s)`);
      // Courses seeded before perGuests existed: match each back to the
      // component it came from, by the dish rather than by the name, since the
      // name is the first thing anyone renames.
      for (const course of menu.setMenuCourses) {
        if (course.perGuests) continue;
        const recipeIds = new Set(course.options.map((option) => option.recipeId));
        const component = menu.lines.find(
          (line) => line.subRecipeId && recipeIds.has(line.subRecipeId) && (line.perGuests ?? 0) > 1
        );
        if (!component?.perGuests) continue;
        backfill.push({ id: course.id, perGuests: component.perGuests, label: `${label} — ${course.name}` });
      }
      // Firing order is worked out across the WHOLE menu, not per course: the
      // numbering depends on which sittings the menu uses, so a course has to
      // be read next to its siblings even when only some of them need writing.
      const flow = planCourseFlow(
        menu.setMenuCourses.map((course): CourseDish => {
          const first = course.options[0]?.recipe;
          return first ? { title: first.title, kind: first.kind, category: first.category } : { title: course.name };
        })
      );
      menu.setMenuCourses.forEach((course, index) => {
        if (course.posCourse) return;
        firing.push({ id: course.id, posCourse: flow[index] ?? NOW, label: `${label} — ${course.name}` });
      });
      continue;
    }
    const dishes: CourseDish[] = [];
    const draft: Array<{ name: string; recipeId: string; shared: number | null }> = [];
    for (const line of menu.lines) {
      if (!line.subRecipe) {
        nameOnly.push(`${label} — "${line.ingredientName}" is a name with no dish behind it`);
        continue;
      }
      dishes.push({ title: line.subRecipe.title, kind: line.subRecipe.kind, category: line.subRecipe.category });
      draft.push({
        // The component's own name is what the kitchen calls it; the dish title
        // is the fallback when the line was never named.
        name: (line.ingredientName || line.subRecipe.title).slice(0, 60),
        recipeId: line.subRecipe.id,
        shared: line.perGuests
      });
    }
    if (draft.length === 0) {
      skipped.push(`${label} — no components with a dish behind them`);
      continue;
    }
    const flow = planCourseFlow(dishes);
    planned.push({
      menu,
      courses: draft.map((course, index) => ({ ...course, posCourse: flow[index] ?? NOW }))
    });
  }

  console.log(`${menus.length} active set menus.`);
  for (const { menu, courses } of planned) {
    console.log(`\n${menu.venue ?? 'shared'} · ${menu.title} — ${courses.length} course(s)`);
    for (const course of courses) {
      const shared = course.shared ? `  (was shared between ${course.shared})` : '';
      console.log(`   ${course.posCourse.padEnd(9)}  ${course.name}${shared}`);
    }
  }
  const report = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };
  report('Skipped', skipped);
  report(
    'Shared dishes to fill in on courses that already exist',
    backfill.map((row) => `${row.label} — shared between ${row.perGuests}`)
  );
  report(
    'Firing order to fill in on courses that already exist',
    firing.map((row) => `${row.posCourse.padEnd(9)}  ${row.label}`)
  );
  report('Components with no dish behind them — left for you to attach', nameOnly);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to create these courses.');
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const { menu, courses } of planned) {
    for (const [index, course] of courses.entries()) {
      await prisma.setMenuCourse.create({
        data: {
          setMenuRecipeId: menu.id,
          name: course.name,
          pick: 1,
          posCourse: course.posCourse,
          // Carried straight from the costing: a component shared between four
          // is a course shared between four, and the register divides by it.
          perGuests: course.shared && course.shared > 1 ? course.shared : null,
          sortOrder: index,
          options: { create: [{ recipeId: course.recipeId, sortOrder: 0 }] }
        }
      });
      created += 1;
    }
  }
  let filled = 0;
  for (const row of backfill) {
    await prisma.setMenuCourse.update({ where: { id: row.id }, data: { perGuests: row.perGuests } });
    filled += 1;
  }
  let fired = 0;
  for (const row of firing) {
    // Guarded at write time as well: a manager who set the firing order while
    // this was running keeps it.
    const result = await prisma.setMenuCourse.updateMany({
      where: { id: row.id, posCourse: null },
      data: { posCourse: row.posCourse }
    });
    fired += result.count;
  }
  console.log(`\nCreated ${created} placeholder courses across ${planned.length} menus.`);
  if (filled > 0) console.log(`Filled in "shared between" on ${filled} existing course(s).`);
  if (fired > 0) console.log(`Filled in the firing order on ${fired} existing course(s).`);
  if (fired !== firing.length) {
    console.log(`${firing.length - fired} had a firing order set by someone else while this ran, and were left alone.`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
