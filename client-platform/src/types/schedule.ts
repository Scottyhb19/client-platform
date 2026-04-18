export type ScheduleViewMode = 1 | 5 | 7;

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export interface ScheduleBooking {
  id: string;
  clientId: string;
  practitionerId: string;
  client: { firstName: string; lastName: string };
  startTimeIso: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  type: string | null;
  status: BookingStatus;
  cancelled: boolean;
  notes: string | null;
}

export interface ScheduleState {
  focus: Date;
  today: Date;
  view: ScheduleViewMode;
  searchTerm: string;
}

export interface ScheduleSettings {
  workingHoursStart: string;
  workingHoursEnd: string;
  defaultDurationMinutes: number;
  slotGranularityMinutes: 15 | 30 | 60;
}
