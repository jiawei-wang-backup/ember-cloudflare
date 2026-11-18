import {it, expect} from "vitest";
import {compactPulseNumber, parsePulseAdoption} from "./pulse";

it("abbreviates Token counts without losing integer precision or treating missing values as zero", () => {
  expect(compactPulseNumber(null)).toBe("未知");
  expect(compactPulseNumber("0")).toBe("0");
  expect(compactPulseNumber("1202229959")).toBe("12.02 亿");
  expect(compactPulseNumber("3804241")).toBe("380.42 万");
  expect(compactPulseNumber("10000")).toBe("1 万");
  expect(compactPulseNumber("9999")).toBe("9,999");
  expect(compactPulseNumber("9007199254740993123456789")).toBe("90071992547409931.23 亿");
});

it("bounds adoption inputs and rejects duplicate or malformed source identifiers", () => {
  const request = {messageIds: ["message1"], note: "  优先确认表单草稿  ", clientMessageId: "12345678-1234-1234-1234-123456789abc"};
  expect(parsePulseAdoption(request)?.note).toBe("优先确认表单草稿");
  expect(parsePulseAdoption({...request, messageIds: []})).toBeNull();
  expect(parsePulseAdoption({...request, messageIds: ["same", "same"]})).toBeNull();
  expect(parsePulseAdoption({...request, messageIds: Array.from({length: 21}, (_, i) => `m${i}`)})).toBeNull();
  expect(parsePulseAdoption({...request, messageIds: ["../other"]})).toBeNull();
  expect(parsePulseAdoption({...request, note: "长".repeat(1001)})).toBeNull();
});
