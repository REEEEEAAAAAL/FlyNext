import { describe, expect, it } from "vitest";
import { repairDate, repairSnapshot, type DateSnapshot } from "@/lib/hotel-date-repair";

describe("历史酒店日期修复",()=>{
 it.each(["UTC","Asia/Shanghai","America/Toronto"])("进程时区 %s 不改变已知上海零点的转换",zone=>{
  const previous=process.env.TZ;process.env.TZ=zone;
  try {expect(repairDate("2026-10-17T16:00:00.000Z","Asia/Shanghai")).toBe("2026-10-18T00:00:00.000Z");}
  finally {if(previous===undefined) delete process.env.TZ;else process.env.TZ=previous;}
 });
 it("兼容 UTC 新记录并可重复执行",()=>{
  const date=repairDate("2026-10-17T16:00:00.000Z","Asia/Shanghai");
  expect(repairDate(date,"Asia/Shanghai")).toBe(date);
  expect(repairDate("2026-10-18T04:00:00.000Z","America/Toronto")).toBe("2026-10-18T00:00:00.000Z");
 });
 it("拒绝无法解释的时刻和毫秒",()=>{
  expect(()=>repairDate("2026-10-17T15:00:00.000Z","Asia/Shanghai")).toThrow();
  expect(()=>repairDate("2026-10-17T16:00:00.001Z","Asia/Shanghai")).toThrow();
  expect(()=>repairDate("invalid","Asia/Shanghai")).toThrow();
 });
 const fixture=():DateSnapshot=>({rooms:[{id:1,hotelId:1,currentAvailability:2,pricePerNight:100}],inventory:[{id:1,roomTypeId:1,date:"2026-10-17T16:00:00.000Z",availability:1}],stays:[{id:1,roomTypeId:1,hotelId:1,userId:1,itineraryId:null,checkIn:"2026-10-17T16:00:00.000Z",checkOut:"2026-10-19T16:00:00.000Z",price:200,status:"CONFIRMED"}]});
 it("保持库存金额状态和关系，幂等且不修改输入",()=>{
  const before=fixture();const after=repairSnapshot(before,"Asia/Shanghai");
  expect(before.inventory[0].date).toContain("T16:");
  expect(after.stays[0]).toEqual({...before.stays[0],checkIn:"2026-10-18T00:00:00.000Z",checkOut:"2026-10-20T00:00:00.000Z"});
  expect(repairSnapshot(after,"Asia/Shanghai")).toEqual(after);
 });
 it("日期键冲突和超容量库存必须人工处理",()=>{
  const before=fixture();before.inventory.push({...before.inventory[0],id:2,date:"2026-10-18T00:00:00.000Z"});
  expect(()=>repairSnapshot(before,"Asia/Shanghai")).toThrow("冲突");
  const invalid=fixture();invalid.inventory[0].availability=3;
  expect(()=>repairSnapshot(invalid,"Asia/Shanghai")).toThrow("容量");
 });
 it("拒绝混合来源或夏令时导致时长变化的预订",()=>{
  const before=fixture();before.stays[0].checkOut="2026-10-20T00:00:00.000Z";
  expect(()=>repairSnapshot(before,"Asia/Shanghai")).toThrow("时长");
 });
 it("库存核对只减少高估值，保留保守留房且可重跑",()=>{
  const before=fixture();before.inventory[0].availability=2;
  const after=repairSnapshot(before,"Asia/Shanghai",true);
  expect(after.inventory[0].availability).toBe(1);
  expect(repairSnapshot(after,"Asia/Shanghai",true)).toEqual(after);
  before.inventory[0].availability=0;
  expect(repairSnapshot(before,"Asia/Shanghai",true).inventory[0].availability).toBe(0);
 });
 it("缺失库存行也不能掩盖历史超售",()=>{
  const before=fixture();before.inventory=[];before.rooms[0].currentAvailability=1;
  before.stays.push({...before.stays[0],id:2});
  expect(()=>repairSnapshot(before,"Asia/Shanghai",true)).toThrow("超过容量");
 });
});
