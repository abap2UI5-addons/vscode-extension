import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteOffers, relativeOffers, rowShapeFor } from "../bindingpaths";

/** A shape the way `prepareAbap( )` derives it: tables as one-row arrays,
 *  undeclared structures marked non-enumerably. */
const unknown = () =>
  Object.defineProperty({}, "__unknownShape", { value: true });

const SHAPE = {
  NAME: "",
  COUNT: 0,
  ADDRESS: { CITY: "", ZIP: "" },
  TRAVELS: [{ ID: "", STATUS: "", STOPS: [{ AIRPORT: "" }] }],
  DDIC: unknown(),
};

test("absolute offers walk the whole shape, tables marked as such", () => {
  const offers = absoluteOffers(SHAPE);
  const byPath = new Map(offers.map((o) => [o.path, o]));
  assert.ok(byPath.has("/NAME"));
  assert.ok(byPath.has("/ADDRESS/CITY"));
  assert.equal(byPath.get("/TRAVELS")?.table, true);
  // The gate resolves a path through a table via its row - so it is offered.
  assert.ok(byPath.has("/TRAVELS/STATUS"));
  assert.ok(byPath.has("/TRAVELS/STOPS/AIRPORT"));
});

test("an unknown shape is offered as itself, never guessed into", () => {
  const offers = absoluteOffers(SHAPE);
  assert.ok(offers.some((o) => o.path === "/DDIC"));
  assert.ok(!offers.some((o) => o.path.startsWith("/DDIC/")));
});

test("relative offers are the row's fields", () => {
  const row = rowShapeFor(SHAPE, ["/TRAVELS"]);
  const offers = relativeOffers(row);
  assert.ok(offers.some((o) => o.path === "STATUS"));
  assert.ok(offers.some((o) => o.path === "STOPS" && o.table));
  assert.ok(!offers.some((o) => o.path === "NAME"));
});

test("a nested aggregation resolves relative to the row above", () => {
  const row = rowShapeFor(SHAPE, ["/TRAVELS", "STOPS"]);
  assert.deepEqual(
    relativeOffers(row).map((o) => o.path),
    ["AIRPORT"]
  );
});

test("a path that cannot be followed offers nothing rather than guesses", () => {
  assert.equal(rowShapeFor(SHAPE, ["/NOPE"]), undefined);
  assert.equal(rowShapeFor(SHAPE, ["/NAME"]), undefined);
  assert.equal(rowShapeFor(SHAPE, ["/DDIC"]), undefined);
});

test("a self-referential shape stops at the depth cap instead of hanging", () => {
  const loop: Record<string, unknown> = {};
  loop.SELF = loop;
  const offers = absoluteOffers(loop);
  assert.ok(offers.length > 0);
  assert.ok(offers.length < 100);
});
