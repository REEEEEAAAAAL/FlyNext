"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface Flight {
  id?: string;
  flightNumber?: string;
  departureTime?: string;
  arrivalTime?: string;
  price?: number;
  duration?: number; // in minutes
  availableSeats?: number;
  airline?: {
    code: string;
    name: string;
  };
  // Additional fields as needed.
}

interface FlightContextProps {
  selectedFlights: Flight[];
  addFlight: (flight: Flight) => void;
  removeFlight: (flightId: string) => void;
}

const FlightContext = createContext<FlightContextProps | undefined>(undefined);

export const FlightProvider = ({ children }: { children: ReactNode }) => {
  const [selectedFlights, setSelectedFlights] = useState<Flight[]>([]);

  const addFlight = (flight: Flight) => {
    // Check if the flight is already added (using id)
    if (flight.id && !selectedFlights.find((f) => f.id === flight.id)) {
      setSelectedFlights((prev) => [...prev, flight]);
    }
  };

  const removeFlight = (flightId: string) => {
    setSelectedFlights((prev) => prev.filter((f) => f.id !== flightId));
  };

  return (
    <FlightContext.Provider value={{ selectedFlights, addFlight, removeFlight }}>
      {children}
    </FlightContext.Provider>
  );
};

export const useFlightContext = () => {
  const context = useContext(FlightContext);
  if (!context) {
    throw new Error("useFlightContext must be used within a FlightProvider");
  }
  return context;
};
