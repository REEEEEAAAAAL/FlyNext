/*
 * GET /api/invoice renders an itinerary confirmation as a PDF.
 * The endpoint returns PDF bytes on success and the standard JSON error shape
 * on failure for the checkout and invoice pages.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { badRequest, notFound } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

const colors = {
	ink: rgb(0.08, 0.16, 0.25),
	muted: rgb(0.36, 0.43, 0.51),
	accent: rgb(0.04, 0.42, 0.55),
	accentPale: rgb(0.91, 0.96, 0.97),
	line: rgb(0.86, 0.89, 0.92),
	panel: rgb(0.97, 0.98, 0.99),
	white: rgb(1, 1, 1),
};

function getValue(record: unknown, key: string): unknown {
	if (typeof record !== "object" || record === null || Array.isArray(record) || !(key in record)) {
		return undefined;
	}
	return Reflect.get(record, key);
}

function readString(record: unknown, key: string): string | null {
	const value = getValue(record, key);
	return typeof value === "string" && value.trim().length > 0 && value.trim() !== " "
		? value.trim()
		: null;
}

function readNumber(record: unknown, key: string): number | null {
	const value = getValue(record, key);
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function formatDate(value: Date | string | null | undefined): string {
	if (value === null || value === undefined) return "Not available";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "Not available";
	return `${new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date)} UTC`;
}

function formatCalendarDate(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(value);
}

function money(value: number, currency = "USD"): string {
	try {
		return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
	} catch {
		return `${value.toFixed(2)} ${currency}`;
	}
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
	if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
	let result = text;
	while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) {
		result = result.slice(0, -1);
	}
	return `${result}...`;
}

function drawText(
	page: PDFPage,
	text: string,
	x: number,
	y: number,
	font: PDFFont,
	size: number,
	color = colors.ink,
	maxWidth = 500,
): void {
	page.drawText(fitText(text, font, size, maxWidth), { x, y, font, size, color });
}

function drawRightText(
	page: PDFPage,
	text: string,
	rightX: number,
	y: number,
	font: PDFFont,
	size: number,
	color = colors.ink,
	maxWidth = 500,
): void {
	const fittedText = fitText(text, font, size, maxWidth);
	const width = font.widthOfTextAtSize(fittedText, size);
	page.drawText(fittedText, { x: rightX - width, y, font, size, color });
}

function drawField(
	page: PDFPage,
	label: string,
	value: string,
	x: number,
	y: number,
	regular: PDFFont,
	bold: PDFFont,
	width: number,
): void {
	drawText(page, label.toUpperCase(), x, y, bold, 7.5, colors.muted, width);
	drawText(page, value, x, y - 16, regular, 10, colors.ink, width);
}

function drawPageHeader(
	page: PDFPage,
	regular: PDFFont,
	bold: PDFFont,
	continuation: boolean,
): void {
	page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: colors.white });
	page.drawRectangle({ x: 0, y: 770, width: 612, height: 22, color: colors.ink });
	drawText(page, "FLYNEXT  /  TRAVEL", 48, 739, bold, 9, colors.accent, 220);
	drawRightText(page, "BOOKING CONFIRMATION", 564, 739, bold, 8, colors.muted, 260);
	const title = continuation ? "DEMO RECEIPT - CONTINUED" : "DEMO RECEIPT";
	page.drawText(title, {
		x: (612 - bold.widthOfTextAtSize(title, 22)) / 2,
		y: 698,
		font: bold,
		size: 22,
		color: colors.ink,
	});
	if (!continuation) {
		const subtitle = "Your itinerary and simulated payment confirmation";
		page.drawText(subtitle, {
			x: (612 - regular.widthOfTextAtSize(subtitle, 10)) / 2,
			y: 678,
			font: regular,
			size: 10,
			color: colors.muted,
		});
	}
}

function location(record: unknown, prefix: "origin" | "destination"): string {
	const city = readString(record, `${prefix}City`);
	const country = readString(record, `${prefix}Country`);
	const name = readString(record, `${prefix}Name`);
	return [city, country, name].filter((part): part is string => part !== null).join(", ");
}

function directionSegments(
	departure: unknown,
	arrival: unknown,
	key: "goLegs" | "returnLegs",
	dateKey: "goDate" | "returnDate",
	airportKey: "goAirport" | "returnAirport",
): unknown[] {
	const saved = readArray(getValue(departure, key));
	if (saved.length > 0) return saved;
	const start = readString(departure, airportKey);
	const end = readString(arrival, airportKey);
	const startDate = readString(departure, dateKey);
	const endDate = readString(arrival, dateKey);
	if (start === null && end === null && startDate === null && endDate === null) return [];
	return [{ from: start, to: end, departDate: startDate, arriveDate: endDate }];
}

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	const { searchParams } = new URL(request.url);
	const rawId = searchParams.get("itineraryId");
	if (rawId === null || rawId.trim().length === 0) {
		throw badRequest("Missing itineraryId");
	}
	const itineraryId = parseRouteId(rawId, "itineraryId");

	const itinerary = await prisma.itinerary.findFirst({
		where: { id: itineraryId, userId },
		include: {
			flight: true,
			hotel: { include: { hotel: true, roomType: true } },
		},
	});
	if (itinerary === null) throw notFound("Itinerary not found");

	const pdfDoc = await PDFDocument.create();
	const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const pages: PDFPage[] = [];
	let page = pdfDoc.addPage([612, 792]);
	pages.push(page);
	drawPageHeader(page, regular, bold, false);

	page.drawRectangle({ x: 48, y: 585, width: 516, height: 68, color: colors.accentPale });
	drawField(page, "Receipt reference", `FN-${String(itinerary.id).padStart(6, "0")}`, 64, 630, regular, bold, 145);
	drawField(page, "Booking date", formatCalendarDate(itinerary.bookingDate), 236, 630, regular, bold, 145);
	drawField(page, "Booking status", itinerary.status, 410, 630, regular, bold, 138);

	let y = 558;
	const startContinuationPage = (): void => {
		page = pdfDoc.addPage([612, 792]);
		pages.push(page);
		drawPageHeader(page, regular, bold, true);
		y = 660;
	};
	const ensureSpace = (height: number): void => {
		if (y - height < 112) startContinuationPage();
	};
	const sectionHeading = (title: string): void => {
		ensureSpace(34);
		drawText(page, title.toUpperCase(), 48, y - 12, bold, 9, colors.accent, 400);
		page.drawLine({ start: { x: 48, y: y - 21 }, end: { x: 564, y: y - 21 }, thickness: 1, color: colors.line });
		y -= 34;
	};

	sectionHeading("Reservation details");
	if (itinerary.flight !== null) {
		ensureSpace(42);
		drawText(page, "FLIGHT RESERVATION", 48, y - 4, bold, 9, colors.ink, 250);
		drawRightText(page, itinerary.flight.status, 564, y - 4, bold, 9, colors.accent, 180);
		drawText(page, `Reference ${itinerary.flight.afsBookingId.toUpperCase()}`, 48, y - 19, regular, 8, colors.ink, 516);
		drawRightText(page, `Total ${money(itinerary.flight.price)}`, 564, y - 34, regular, 8, colors.muted, 180);
		y -= 40;

		const departure = itinerary.flight.departure;
		const arrival = itinerary.flight.arrival;
		const directions = [
			{ label: "Outbound", legs: directionSegments(departure, arrival, "goLegs", "goDate", "goAirport") },
			{ label: "Return", legs: directionSegments(departure, arrival, "returnLegs", "returnDate", "returnAirport") },
		].filter((direction) => direction.legs.length > 0);

		for (const direction of directions) {
			ensureSpace(22);
			drawText(page, direction.label, 48, y - 12, bold, 10, colors.ink, 200);
			y -= 23;
			for (const [index, segment] of direction.legs.entries()) {
				ensureSpace(102);
				const top = y;
				page.drawRectangle({ x: 48, y: top - 91, width: 516, height: 91, color: colors.panel, borderColor: colors.line, borderWidth: 1 });
				const from = readString(segment, "from") ?? "Origin unavailable";
				const to = readString(segment, "to") ?? "Destination unavailable";
				const fromPlace = location(segment, "origin");
				const toPlace = location(segment, "destination");
				const flightNumber = readString(segment, "flightNumber");
				const airlineCode = readString(segment, "airlineCode");
				const airlineName = readString(segment, "airlineName");
				const carrier = [airlineName, airlineCode ? `(${airlineCode})` : null, flightNumber ? `Flight ${flightNumber}` : null]
					.filter((part): part is string => part !== null)
					.join("  ");
				const duration = readNumber(segment, "durationMinutes");
				const durationLabel = duration === null ? null : `${Math.floor(duration / 60)}h ${duration % 60}m`;
				const status = readString(segment, "status");
				const segmentPrice = readNumber(segment, "price");
				const currency = readString(segment, "currency") ?? "USD";
				const meta = [carrier || "Carrier details unavailable", durationLabel, status, segmentPrice === null ? null : money(segmentPrice, currency)]
					.filter((part): part is string => part !== null)
					.join("  |  ");

				drawText(page, `${direction.label.toUpperCase()}  /  LEG ${index + 1} OF ${direction.legs.length}`, 64, top - 15, bold, 7.5, colors.accent, 300);
			drawText(page, `${from}  >  ${to}`, 64, top - 34, bold, 13, colors.ink, 470);
			drawText(page, `${fromPlace || from}  >  ${toPlace || to}`, 64, top - 49, regular, 8, colors.muted, 470);
			drawText(page, meta, 64, top - 64, regular, 8, colors.ink, 470);
			drawText(page, `Depart: ${formatDate(readString(segment, "departDate"))}`, 64, top - 80, regular, 8, colors.muted, 230);
			drawText(page, `Arrive: ${formatDate(readString(segment, "arriveDate"))}`, 316, top - 80, regular, 8, colors.muted, 232);
				y -= 101;
			}
		}
	} else {
		ensureSpace(40);
		page.drawRectangle({ x: 48, y: y - 36, width: 516, height: 36, color: colors.panel, borderColor: colors.line, borderWidth: 1 });
		drawText(page, "No flight reservation included", 64, y - 23, regular, 9, colors.muted, 470);
		y -= 48;
	}

	if (itinerary.hotel !== null) {
		sectionHeading("Hotel reservation");
		ensureSpace(94);
		const hotel = itinerary.hotel;
		const nights = Math.max(0, Math.round((hotel.checkOut.getTime() - hotel.checkIn.getTime()) / 86_400_000));
		page.drawRectangle({ x: 48, y: y - 82, width: 516, height: 82, color: colors.panel, borderColor: colors.line, borderWidth: 1 });
		drawText(page, hotel.hotel?.name ?? "Hotel details unavailable", 64, y - 19, bold, 12, colors.ink, 470);
		drawText(page, `${hotel.roomType?.name ?? "Room details unavailable"}  |  ${hotel.hotel?.location ?? "Location unavailable"}`, 64, y - 37, regular, 8.5, colors.muted, 470);
		drawText(page, `Check-in: ${formatCalendarDate(hotel.checkIn)}  |  Check-out: ${formatCalendarDate(hotel.checkOut)}  |  ${nights} ${nights === 1 ? "night" : "nights"}`, 64, y - 57, regular, 8.5, colors.ink, 470);
		drawText(page, `Hotel reservation total: ${money(hotel.price)}`, 64, y - 73, bold, 8.5, colors.accent, 470);
		y -= 94;
	} else {
		sectionHeading("Hotel reservation");
		ensureSpace(40);
		page.drawRectangle({ x: 48, y: y - 36, width: 516, height: 36, color: colors.panel, borderColor: colors.line, borderWidth: 1 });
		drawText(page, "No hotel reservation included", 64, y - 23, regular, 9, colors.muted, 470);
		y -= 48;
	}

	ensureSpace(112);
	const confirmationTotal = itinerary.confirmationTotal ?? itinerary.totalPrice;
	page.drawRectangle({ x: 48, y: y - 99, width: 516, height: 99, color: colors.white, borderColor: colors.line, borderWidth: 1 });
	drawText(page, "PRICE SUMMARY", 64, y - 18, bold, 8, colors.accent, 180);
	drawText(page, "Flight reservation", 64, y - 39, regular, 9, colors.muted, 290);
	drawText(page, money(itinerary.flight?.price ?? 0), 440, y - 39, regular, 9, colors.ink, 108);
	drawText(page, "Hotel reservation", 64, y - 57, regular, 9, colors.muted, 290);
	drawText(page, money(itinerary.hotel?.price ?? 0), 440, y - 57, regular, 9, colors.ink, 108);
	page.drawLine({ start: { x: 64, y: y - 66 }, end: { x: 548, y: y - 66 }, thickness: 1, color: colors.line });
	drawText(page, "CONFIRMATION TOTAL", 64, y - 86, bold, 9, colors.ink, 290);
	drawText(page, money(confirmationTotal), 424, y - 86, bold, 13, colors.accent, 124);
	y -= 111;

	ensureSpace(58);
	page.drawRectangle({ x: 48, y: y - 48, width: 516, height: 48, color: colors.accentPale });
	drawText(page, "DEMO PAYMENT - NO MONEY WAS CHARGED", 64, y - 19, bold, 9, colors.ink, 480);
	drawText(page, `Method: ${itinerary.paymentMethod ?? "Legacy demo record"}. Demo booking confirmation only.`, 64, y - 36, regular, 8, colors.muted, 480);

	for (const [index, currentPage] of pages.entries()) {
		currentPage.drawLine({ start: { x: 48, y: 98 }, end: { x: 564, y: 98 }, thickness: 1, color: colors.line });
		drawText(currentPage, index === 0 ? "Keep this receipt with your travel records." : "Flight and reservation details continued.", 48, 79, regular, 8, colors.muted, 320);
		drawRightText(currentPage, `Issued ${formatCalendarDate(new Date())}  |  Page ${index + 1} of ${pages.length}`, 564, 79, regular, 8, colors.muted, 290);
		drawText(currentPage, "FLYNEXT  |  DEMO CONFIRMATION  |  NOT PROOF OF REAL PAYMENT", 48, 52, bold, 7, colors.muted, 516);
	}

	const pdfBytes = await pdfDoc.save();
	return new Response(Buffer.from(pdfBytes), {
		status: 200,
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="invoice_${itineraryId}.pdf"`,
		},
	});
});
