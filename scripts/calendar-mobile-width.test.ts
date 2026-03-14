import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cssPath = path.resolve("src/app/calendar/calendar.css");
const css = fs.readFileSync(cssPath, "utf8");

test("iPhone calendar keeps a wider horizontally scrollable grid", () => {
  const mobileBlockStart = css.indexOf("@media (max-width: 480px)");
  assert.notEqual(mobileBlockStart, -1, "expected <=480px media block to exist");

  const mobileBlock = css.slice(mobileBlockStart, mobileBlockStart + 500);

  assert.match(mobileBlock, /min-width:\s*532px;/);
  assert.match(mobileBlock, /grid-template-columns:\s*repeat\(7,\s*minmax\(72px,\s*1fr\)\);/);
});
