-- AlterTable
ALTER TABLE "Gift" ADD COLUMN     "staffNotifiedAt" TIMESTAMP(3);


-- Принятый или выданный подарок: известен способ получения и код выдачи;
-- «Пусть принесут» — только с номером столика (его вводит сам получатель).
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_accepted_has_delivery" CHECK (
  "status" NOT IN ('accepted', 'redeemed') OR ("delivery" IS NOT NULL AND "pickupCode" IS NOT NULL)
);
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_table_has_number" CHECK (
  "delivery" IS DISTINCT FROM 'table' OR "tableNumber" IS NOT NULL
);
