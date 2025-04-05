import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { NextRequest } from "next/server";
import { JwtPayload } from 'jsonwebtoken';

export async function POST(req: NextRequest) {
  try {
    // Authenticate the user using verifyToken (it returns the payload on success)
    const userPayload = await verifyToken(req) as JwtPayload | null;
    if (!userPayload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Extract the user id from the payload (supporting both property names)
    const userId = userPayload.userId || userPayload.id;
    if (!userId) {
      return NextResponse.json({ error: 'Invalid user identifier' }, { status: 400 });
    }

    // Parse JSON body from the request and validate required fields
    const { itineraryId, cardNumber, cardExpiry } = await req.json();
    if (!itineraryId || !cardNumber || !cardExpiry) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Basic card validation: ensure the card number has at least 4 characters
    if (cardNumber.length < 4) {
      return NextResponse.json({ error: 'Invalid card number' }, { status: 400 });
    }

    // Store only the last 4 digits of the card number
    const last4Digits = cardNumber.slice(-4);

    // Verify that the itinerary exists and belongs to the current user
    const itinerary = await prisma.itinerary.findFirst({
      where: { id: Number(itineraryId), userId: userId },
    });
    if (!itinerary) {
      return NextResponse.json(
        { error: 'Itinerary not found or access denied' },
        { status: 404 }
      );
    }

    // Update the itinerary in the database with payment info and mark as CONFIRMED
    const updatedItinerary = await prisma.itinerary.update({
      where: { id: Number(itineraryId) },
      data: {
        cardNumber: last4Digits,
        cardExpiry: cardExpiry,
        status: 'CONFIRMED'
      }
    });

    // Return a successful response with the updated itinerary details
    return NextResponse.json({
      message: 'Checkout successful',
      itinerary: updatedItinerary
    }, { status: 200 });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
        {
            error:
                (error as Error).message ||
                "Checkout failed, please try again later.",
        },
        { status: 500 }
    );
  }
}
