"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface Flight {
  id: string;
  flightNumber?: string;
  departureTime?: string;
  arrivalTime?: string;
  price: number;
  airline?: { code: string; name: string };
}

interface Hotel {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  price: number;
}

interface BookingContextProps {
  flights: Flight[];
  hotels: Hotel[];
  addFlight: (flight: Flight) => void;
  removeFlight: (flightId: string) => void;
  clearBucket: () => void;
}

const BookingContext = createContext<BookingContextProps | undefined>(undefined);

export const BookingProvider = ({ children }: { children: ReactNode }) => {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]); // manage hotels similarly later if needed

  const addFlight = (flight: Flight) => {
    if (!flights.some((f) => f.id === flight.id)) {
      setFlights((prev) => [...prev, flight]);
    }
  };

  const removeFlight = (flightId: string) => {
    setFlights((prev) => prev.filter((f) => f.id !== flightId));
  };

  const clearBucket = () => {
    setFlights([]);
    setHotels([]);
  };

  return (
    <BookingContext.Provider value={{ flights, hotels, addFlight, removeFlight, clearBucket }}>
      {children}
    </BookingContext.Provider>
  );
};

export const useBookingBucket = () => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBookingBucket must be used within a BookingProvider");
  }
  return context;
};
