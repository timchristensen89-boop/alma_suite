-- Set menus that ask a question.
--
-- A set menu is already a Recipe (kind = 'SET_MENU') whose RecipeLine rows are
-- its fixed components. What was missing is the part somebody has to choose:
-- "one entree each, from these three", where the three change through the week.
-- That can't be a RecipeLine, because a pick-one-of-three has no single cost to
-- sum into the recipe's estimate — what a banquet actually costs depends on
-- what the tables picked, which is recorded per sale on PosOrderLine.

CREATE TABLE "SetMenuCourse" (
    "id" TEXT NOT NULL,
    "setMenuRecipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Matches PosOrderLine.course so banquet dishes group with everything else
    -- on the fire screen. NULL = let the register default it.
    "posCourse" TEXT,
    -- Choices each guest makes here. covers * pick = what the table owes.
    "pick" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetMenuCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SetMenuOption" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    -- Charged on top of the package price, per guest who picks it. 0 = incl.
    "supplementCents" INTEGER NOT NULL DEFAULT 0,
    -- Tonight's menu. Off = not offered; history is unaffected.
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetMenuOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SetMenuCourse_setMenuRecipeId_sortOrder_idx" ON "SetMenuCourse"("setMenuRecipeId", "sortOrder");
CREATE UNIQUE INDEX "SetMenuOption_courseId_recipeId_key" ON "SetMenuOption"("courseId", "recipeId");
CREATE INDEX "SetMenuOption_recipeId_idx" ON "SetMenuOption"("recipeId");

ALTER TABLE "SetMenuCourse" ADD CONSTRAINT "SetMenuCourse_setMenuRecipeId_fkey"
    FOREIGN KEY ("setMenuRecipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetMenuOption" ADD CONSTRAINT "SetMenuOption_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "SetMenuCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetMenuOption" ADD CONSTRAINT "SetMenuOption_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which package paid for this line. Set on the $0 dish lines a banquet rings,
-- NULL on everything sold on its own. Stamped rather than inferred from a $0
-- price, so the report can tell an included dish from a comped one.
ALTER TABLE "PosOrderLine" ADD COLUMN "packagedBy" TEXT;
CREATE INDEX "PosOrderLine_packagedBy_idx" ON "PosOrderLine"("packagedBy");
