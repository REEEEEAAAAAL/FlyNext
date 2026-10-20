import { NextRequest } from "next/server";
import { handleBooking } from "@/utils/booking-service";
export const GET = (request: NextRequest) => handleBooking(request, "retrieve");
