import "../tests/setup/load-env";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyTestDatabase } from "../tests/support/safety";

test("large synthetic hotel catalogue renders all supported stays",async ({page})=>{
  const fixture=JSON.parse(readFileSync("test-results/fixture.json","utf8")) as {hotelId:number;checkIn:string;checkOut:string};
  const prisma=new PrismaClient();
  try {
    await verifyTestDatabase(prisma);
    const owner=await prisma.hotel.findUniqueOrThrow({where:{id:fixture.hotelId},select:{ownerId:true}});
    const names=Array.from({length:50},(_,index)=>`Synthetic Catalogue ${String(index+1).padStart(2,"0")}`);
    await prisma.$transaction(async tx=>{
      await tx.hotel.createMany({data:names.map(name=>({name,ownerId:owner.ownerId,address:"Synthetic Demo Street",location:"Toronto, Canada",starRating:3,logo:"/hotel-logo-default.svg",images:[]}))});
      const hotels=await tx.hotel.findMany({where:{name:{in:names}},select:{id:true}});
      await tx.roomType.createMany({data:hotels.map(hotel=>({hotelId:hotel.id,name:"Synthetic Catalogue Room",images:[],pricePerNight:100,currentAvailability:2}))});
      const rooms=await tx.roomType.findMany({where:{hotelId:{in:hotels.map(hotel=>hotel.id)}},select:{id:true}});
      const firstNight=new Date(`${fixture.checkIn}T00:00:00Z`).getTime();
      await tx.roomAvailabilityRecord.createMany({data:rooms.flatMap(room=>[0,1].map(offset=>({roomTypeId:room.id,date:new Date(firstNight+offset*86400000),availability:2})))});
    },{timeout:120_000});
  } finally {await prisma.$disconnect();}
  await page.setViewportSize({width:1440,height:1000});
  const started=performance.now();
  const results=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==="/api/hotels" && url.searchParams.get("checkIn")===fixture.checkIn;
  });
  await page.goto(`/hotels?checkIn=${fixture.checkIn}&checkOut=${fixture.checkOut}`);
  await expect(page.getByRole("heading",{name:/^Synthetic Catalogue \d+$/})).toHaveCount(50);
  const elapsedMs=Math.round(performance.now()-started);
  const response=await results;
  expect(response.status()).toBe(200);
  const hotels=(await response.json()).hotels as {name:string}[];
  expect(hotels.filter(hotel=>hotel.name.startsWith("Synthetic Catalogue "))).toHaveLength(50);
  expect(elapsedMs).toBeLessThan(20_000);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("heading",{name:"Synthetic Catalogue 50",exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading",{name:"Synthetic Catalogue 50",exact:true})).toBeInViewport();
  writeFileSync("test-results/catalogue-performance.json",JSON.stringify({catalogueHotels:50,totalLoadedHotels:hotels.length,rooms:50,nightlyRecords:100,elapsedMs,budgetMs:20_000,scope:"local production build with enrolled remote synthetic database; not a production load test"}));
});
