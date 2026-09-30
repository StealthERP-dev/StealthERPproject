// Home's time-of-day greeting (HOME-01). Imports nothing so `node --test`
// loads it directly. Takes the hour as a parameter rather than reading the
// clock, so the boundaries are testable without freezing time — the caller
// passes the local hour.
//
// Boundaries (UI-SPEC "Screen Contracts" section 5, App.tsx:973-974):
// before 12 -> morning, 12 up to but not including 17 -> afternoon,
// 17 onward -> evening.

export function greetingFor(hour: number): string {
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}
