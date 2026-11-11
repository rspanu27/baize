import type { BallSetSpec, ClothSpec, PocketSpec, TableSpec } from "@baize/tables";
import { expectTypeOf, test } from "vitest";
import type { ClothInput, PocketInput, TableInput } from "../src/index";

// The physics package declares its own minimal input types so it has no dependencies.
// These checks prove the richer @baize/tables specs can be passed to it unchanged.
test("tables specs are structural supersets of the physics inputs", () => {
  expectTypeOf<TableSpec>().toExtend<TableInput>();
  expectTypeOf<PocketSpec>().toExtend<PocketInput>();
  expectTypeOf<ClothSpec>().toExtend<ClothInput>();
  expectTypeOf<BallSetSpec["restitution"]>().toEqualTypeOf<number>();
});
