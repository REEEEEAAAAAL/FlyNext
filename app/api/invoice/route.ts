// app/api/invoice/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function GET(req: NextRequest) {
    try {
        const user = await verifyToken(req) as JwtPayload | null;
        if (!user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const itineraryId = searchParams.get("itineraryId");
        if (!itineraryId) {
            return NextResponse.json(
                { error: "Missing itineraryId" },
                { status: 400 }
            );
        }

        const itinerary = await prisma.itinerary.findUnique({
            where: { id: parseInt(itineraryId, 10) },
            include: { flight: true, hotel: true },
        });

        if (!itinerary) {
            return NextResponse.json(
                { error: "Itinerary not found" },
                { status: 404 }
            );
        }
        if (itinerary.userId !== user.userId) {
            return NextResponse.json(
                { error: "Unauthorized access" },
                { status: 403 }
            );
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
                const drawTextLine = (text: string, x = 50, isBold = false) => {
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
        drawTextLine(
            `Booking Date: ${new Date(itinerary.bookingDate).toLocaleString()}`
        );
        drawTextLine(`Status: ${itinerary.status}`, 50, true);
        drawTextLine(
            `Total Price: $${itinerary.totalPrice.toFixed(2)}`,
            50,
            true
        );
        drawTextLine("", 50); 

        drawTextLine("Payment Information:", 50, true);
        drawTextLine(
            `Card Ending: ${itinerary.cardNumber?.slice(-4) || "****"}`
        );
        drawTextLine(`Expiry: ${itinerary.cardExpiry || "**/**"}`);
        drawTextLine("", 50); 

        drawTextLine("Reservation Details:", 50, true);
        drawTextLine(`Flight: ${itinerary.flight ? "Yes" : "No"}`);
        drawTextLine(`Hotel: ${itinerary.hotel ? "Yes" : "No"}`);

        const pdfBytes = await pdfDoc.save();

        return new NextResponse(pdfBytes, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="invoice_${itineraryId}.pdf"`,
            },
        });
    } catch (error) {
        console.error("Invoice generation error:", error);
        return NextResponse.json(
            { error: "Invoice generation failed, please try again later." },
            { status: 500 }
        );
    }
}
