import {afterEach,it,expect,vi} from "vitest";
import {clientId} from "./client-id";
afterEach(()=>vi.unstubAllGlobals());
it("uses the native UUID API when available",()=>{
  vi.stubGlobal("crypto",{randomUUID:()=>"native-uuid"});
  expect(clientId()).toBe("native-uuid");
});
it("creates secure version-4 UUIDs on a LAN HTTP origin",()=>{
  const random=vi.fn((bytes:Uint8Array)=>bytes.fill(255));
  vi.stubGlobal("crypto",{getRandomValues:random});
  expect(clientId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(random).toHaveBeenCalledOnce();
});
