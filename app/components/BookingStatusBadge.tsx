import type { CSSProperties } from "react";
import { bookingStatusColors } from "@/lib/booking-status-colors";

/** Displays the reservation's stored label. Unrecognized statuses use the neutral palette. */
export default function BookingStatusBadge({ status }: { status: string }) {
  const { light, dark } = bookingStatusColors(status);
  const style: CSSProperties & Record<"--status-light" | "--status-dark", string> = {
    "--status-light": light,
    "--status-dark": dark,
  };
  return <span className="booking-status" data-status={status} style={style}>{status}</span>;
}
