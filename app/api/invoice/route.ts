/**
 * `GET /api/invoice?itineraryId=` — renders the itinerary as a PDF.
 *
 * Response contract, relied on by `app/checkout/page.tsx` and
 * `app/invoice/page.tsx`:
 * - success must set `Content-Type: application/pdf` (the checkout page
 *   inspects the header and throws if it is missing);
 * - failures must be JSON `{ error: string }`, because `app/invoice/page.tsx`
 *   reads `data.error` on `!res.ok`.
 *
 * `itineraryId` is validated as a positive integer and the ownership check is
 * part of the same query that loads the row, so a caller cannot tell "no such
 * itinerary" apart from "somebody else's itinerary": both are `404`.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { badRequest, notFound } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

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
		include: { flight: true, hotel: true },
	});
	if (itinerary === null) {
		throw notFound("Itinerary not found");
	}

	const pdfDoc = await PDFDocument.create();
	const page = pdfDoc.addPage([550, 750]);

	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	page.drawText("Invoice", {
		x: 250,
		y: 700,
		size: 24,
		font: boldFont,
		color: rgb(0, 0, 0),
	});

	let yPosition = 650;
	const drawTextLine = (text: string, x = 50, isBold = false): void => {
		page.drawText(text, {
			x,
			y: yPosition,
			size: 12,
			font: isBold ? boldFont : font,
			color: rgb(0, 0, 0),
		});
		yPosition -= 20;
	};

	drawTextLine(`Invoice #: ${itinerary.id}`);
	drawTextLine(`Booking Date: ${itinerary.bookingDate.toLocaleString()}`);
	drawTextLine(`Status: ${itinerary.status}`, 50, true);
	drawTextLine(`Total Price: $${itinerary.totalPrice.toFixed(2)}`, 50, true);
	drawTextLine("", 50);

	drawTextLine("Payment Information:", 50, true);
	drawTextLine(`Card Ending: ${itinerary.cardNumber.slice(-4) || "****"}`);
	drawTextLine(`Expiry: ${itinerary.cardExpiry || "**/**"}`);
	drawTextLine("", 50);

	drawTextLine("Reservation Details:", 50, true);
	drawTextLine(`Flight: ${itinerary.flight ? "Yes" : "No"}`);
	drawTextLine(`Hotel: ${itinerary.hotel ? "Yes" : "No"}`);

	const pdfBytes = await pdfDoc.save();

	return new Response(Buffer.from(pdfBytes), {
		status: 200,
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="invoice_${itineraryId}.pdf"`,
		},
	});
});
