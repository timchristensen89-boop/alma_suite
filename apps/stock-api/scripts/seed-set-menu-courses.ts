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
 * overwrite hand-built work.
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
      _count: { select: { setMenuCourses: true } }
    }
  });

  const skipped: string[] = [];
  const nameOnly: string[] = [];
  const planned: Array<{ menu: (typeof menus)[number]; courses: Array<{ name: string; recipeId: string; shared: number | null }> }> = [];

  for (const menu of menus) {
    const label = `${menu.venue ?? 'shared'} · ${menu.title}`;
    if (menu._count.setMenuCourses > 0) {
      skipped.push(`${label} — already has ${menu._count.setMenuCourses} course(s)`);
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
          sortOrder: index,
          options: { create: [{ recipeId: course.recipeId, sortOrder: 0 }] }
        }
      });
      created += 1;
    }
  }
  console.log(`\nCreated ${created} placeholder courses across ${planned.length} menus.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
