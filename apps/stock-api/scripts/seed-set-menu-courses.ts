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
 * Menus that already have courses are left alone — this seeds, it does not
 * overwrite hand-built work. The ONE exception is `perGuests`: a course seeded
 * before that column existed has no idea its dish is shared, so the register
 * would send one board of fries per head. Where a course still has no
 * perGuests and its component says the dish is shared, the number is filled in.
 * Nothing else about an existing course is touched, and a course whose
 * perGuests has already been set by hand is left exactly as it is.
 *
 *   node --import tsx scripts/seed-set-menu-courses.ts
 *   node --import tsx scripts/seed-set-menu-courses.ts --apply
 */
import { prisma } from '@alma/db';

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
          subRecipe: { select: { id: true, title: true } }
        }
      },
      _count: { select: { setMenuCourses: true } },
      setMenuCourses: {
        select: { id: true, name: true, perGuests: true, options: { select: { recipeId: true } } }
      }
    }
  });

  const skipped: string[] = [];
  const backfill: Array<{ id: string; perGuests: number; label: string }> = [];
  const nameOnly: string[] = [];
  const planned: Array<{ menu: (typeof menus)[number]; courses: Array<{ name: string; recipeId: string; shared: number | null }> }> = [];

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
      continue;
    }
    const courses = [];
    for (const line of menu.lines) {
      if (!line.subRecipe) {
        nameOnly.push(`${label} — "${line.ingredientName}" is a name with no dish behind it`);
        continue;
      }
      courses.push({
        // The component's own name is what the kitchen calls it; the dish title
        // is the fallback when the line was never named.
        name: (line.ingredientName || line.subRecipe.title).slice(0, 60),
        recipeId: line.subRecipe.id,
        shared: line.perGuests
      });
    }
    if (courses.length === 0) {
      skipped.push(`${label} — no components with a dish behind them`);
      continue;
    }
    planned.push({ menu, courses });
  }

  console.log(`${menus.length} active set menus.`);
  for (const { menu, courses } of planned) {
    console.log(`\n${menu.venue ?? 'shared'} · ${menu.title} — ${courses.length} course(s)`);
    for (const course of courses) {
      console.log(`   ${course.name}${course.shared ? `  (was shared between ${course.shared})` : ''}`);
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
  console.log(`\nCreated ${created} placeholder courses across ${planned.length} menus.`);
  if (filled > 0) console.log(`Filled in "shared between" on ${filled} existing course(s).`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
