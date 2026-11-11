import { test } from "vitest";

test("placeholder", async ({ bench }) => {
  await bench("sum 1000 integers", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += i;
    if (sum < 0) throw new Error("unreachable");
  }).run();
});
