-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('MILK', 'EGGS', 'FISH', 'SHELLFISH', 'TREE_NUTS', 'PEANUTS', 'WHEAT_GLUTEN', 'SOY', 'SESAME', 'MUSTARD', 'CELERY', 'SULPHITES');

-- AlterTable
ALTER TABLE "meals" ADD COLUMN     "allergens" "Allergen"[] DEFAULT ARRAY[]::"Allergen"[],
ADD COLUMN     "carbsG" DECIMAL(6,2),
ADD COLUMN     "fatG" DECIMAL(6,2),
ADD COLUMN     "fibreG" DECIMAL(6,2),
ADD COLUMN     "ingredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxDailyQuantity" INTEGER,
ADD COLUMN     "mealPeriods" "MealPeriod"[] DEFAULT ARRAY[]::"MealPeriod"[],
ADD COLUMN     "proteinG" DECIMAL(6,2);

-- CreateIndex
CREATE INDEX "meals_isActive_mealPeriods_idx" ON "meals"("isActive", "mealPeriods");
