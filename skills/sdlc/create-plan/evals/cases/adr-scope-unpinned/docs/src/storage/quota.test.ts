import { quotaOf } from "./quota"

test("test_StoreIsObjectOnly", () => { expect(quotaOf("ws")).toBe(0) })
