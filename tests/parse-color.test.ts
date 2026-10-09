import { expect, test } from "bun:test"
import { parseColor } from "../lib/colors"
import type { Color } from "../lib/types"

test("normalizes CSS colors to RGBA and preserves unsupported-color diagnostics", () => {
  const cases: [string, Color][] = [
    ["white", [1, 1, 1, 1]],
    [" WhItE ", [1, 1, 1, 1]],
    ["rebeccapurple", [102 / 255, 51 / 255, 153 / 255, 1]],
    ["transparent", [0, 0, 0, 0]],
    ["#f008", [1, 0, 0, 136 / 255]],
    ["rgba(255, 0, 0, 0.5)", [1, 0, 0, 0.5]],
  ]
  for (const [value, expected] of cases)
    expect(parseColor(value)).toEqual(expected)
  expect(() => parseColor("not-a-color")).toThrow(
    "Unsupported color: not-a-color",
  )
})
