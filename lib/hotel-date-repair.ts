export function repairDate(value: string, sourceZone: string): string {
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) throw new Error("日期无效，不能自动转换。");
 if (date.toISOString().slice(11) === "00:00:00.000Z") return date.toISOString();
 const parts = new Intl.DateTimeFormat("en-GB", {timeZone:sourceZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const part = (key: string) => parts.find(p => p.type === key)?.value;
 if (part("hour") !== "00" || part("minute") !== "00" || part("second") !== "00" || date.getUTCMilliseconds()) throw new Error("不是来源时区零点，必须人工核对。");
 return `${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`;
}

export interface DateSnapshot {
 rooms: {id:number; hotelId:number; currentAvailability:number; pricePerNight:number}[];
 inventory: {id:number;roomTypeId:number;date:string;availability:number}[];
 stays: {id:number;roomTypeId:number|null;hotelId:number|null;userId:number;itineraryId:number|null;checkIn:string;checkOut:string;price:number;status:string}[];
}

export function repairSnapshot(before: DateSnapshot, zone: string, reconcileInventory = false): DateSnapshot {
 const after: DateSnapshot = {
  rooms: before.rooms.map(row => ({...row})),
  inventory: before.inventory.map(row => ({...row,date:repairDate(row.date,zone)})),
  stays: before.stays.map(row => ({...row,checkIn:repairDate(row.checkIn,zone),checkOut:repairDate(row.checkOut,zone)})),
 };
 const keys = new Set<string>();
 for (const row of after.stays) {
  if (row.checkOut <= row.checkIn || !Number.isFinite(row.price) || row.price < 0) throw new Error("预订日期或价格无效，停止整批修复。");
  if(row.roomTypeId!==null) {
   const room=after.rooms.find(r=>r.id===row.roomTypeId);
   if(!room||row.hotelId!==room.hotelId) throw new Error("预订房型与酒店关联无效。");
   const occupied=after.stays.filter(stay=>stay.roomTypeId===row.roomTypeId&&stay.status!=="CANCELLED"&&stay.checkIn<=row.checkIn&&stay.checkOut>row.checkIn).length;
   if(row.status!=="CANCELLED"&&occupied>room.currentAvailability) throw new Error("历史预订超过容量，必须人工核对，禁止自动清理。");
  }
  if ((Date.parse(row.checkOut)-Date.parse(row.checkIn)) !== (Date.parse(before.stays.find(x=>x.id===row.id)!.checkOut)-Date.parse(before.stays.find(x=>x.id===row.id)!.checkIn))) {
   // DST changes can alter elapsed hours; the operator must review these stays separately.
   throw new Error("转换改变了住宿时长，需单独审查夏令时或混合来源记录。");
  }
 }
 for (const row of after.inventory) {
  const key = `${row.roomTypeId}/${row.date}`;
  if (keys.has(key)) throw new Error("日期转换导致库存键冲突，禁止自动合并。");
  keys.add(key);
  const room = after.rooms.find(r => r.id === row.roomTypeId);
  if (!room || !Number.isInteger(row.availability) || row.availability < 0 || row.availability > room.currentAvailability) throw new Error("库存超过容量或关联无效，需先核对。");
  const occupied=after.stays.filter(stay=>stay.roomTypeId===room.id&&stay.status!=="CANCELLED"&&stay.checkIn<=row.date&&stay.checkOut>row.date).length;
  if(occupied>room.currentAvailability) throw new Error("历史预订超过容量，必须人工核对，禁止自动清理。");
  if(reconcileInventory) row.availability=Math.min(row.availability,room.currentAvailability-occupied);
 }
 for (const row of after.rooms) if (!Number.isInteger(row.currentAvailability) || row.currentAvailability < 0 || !Number.isFinite(row.pricePerNight) || row.pricePerNight < 0) throw new Error("房型容量或价格无效。");
 return after;
}
