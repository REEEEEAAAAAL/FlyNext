import { NextRequest } from "next/server";
import { handleBooking } from "@/utils/booking-service";
export const POST = (request: NextRequest) => handleBooking(request, "create");
